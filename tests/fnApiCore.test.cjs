const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { withoutElectron } = require('./helpers/fakeElectron.cjs');

const CORE_DIR = path.join(__dirname, '..', 'dest', 'modules', 'fn_api', 'core');

test('the fn_api core layer loads in a plain Node process without requiring electron', (t) => {
    const requested = withoutElectron(t);

    const files = fs.readdirSync(CORE_DIR).filter((file) => file.endsWith('.js'));
    assert.ok(files.length > 0);
    for (const file of files) require(path.join(CORE_DIR, file));

    assert.deepEqual(requested, []);
});

test('the core request sends the access grant cookie it is given', async (t) => {
    withoutElectron(t);
    const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));

    const received = [];
    const server = http.createServer((req, res) => {
        received.push(req.headers);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: { ok: true } }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const context = {
        accessCookie: (origin) => (origin === baseUrl ? 'gateway=granted; mode=web' : ''),
        skipVerify: () => false,
        log: { warn() {}, error() {} },
    };
    const result = await request(context, baseUrl, '/v/api/v1/user/info', HttpMethod.GET, 'token-1');

    assert.deepEqual(result, { success: true, data: { ok: true } });
    assert.equal(received.length, 1);
    assert.equal(received[0].authorization, 'token-1');
    assert.equal(received[0].cookie, 'gateway=granted; mode=relay');
});

test('a failed cached call is not cached, so an immediate retry asks the NAS again and only the success is reused', async (t) => {
    withoutElectron(t);
    const { FnApiClient } = require(path.join(CORE_DIR, 'apiClient.js'));
    const { TtlCache } = require(path.join(CORE_DIR, 'ttlCache.js'));

    let requests = 0;
    const server = http.createServer((req, res) => {
        requests += 1;
        res.setHeader('Content-Type', 'application/json');
        const body = requests === 1
            ? { code: 1001, msg: 'item not ready', data: null }
            : { code: 0, msg: '', data: { list: ['video'] } };
        res.end(JSON.stringify(body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const context = { accessCookie: () => '', skipVerify: () => false, log: { warn() {}, error() {} } };
    const api = new FnApiClient(context, baseUrl, 'token-1', new TtlCache());

    const failed = await api.getStreamListCached('item-1');
    assert.equal(failed.success, false);
    assert.equal(requests, 1);

    const succeeded = await api.getStreamListCached('item-1');
    assert.deepEqual(succeeded, { success: true, data: { list: ['video'] } });
    assert.equal(requests, 2);

    const cached = await api.getStreamListCached('item-1');
    assert.deepEqual(cached, succeeded);
    assert.equal(requests, 2);
});

// 常驻的 Proxy 每次 NAS 调用都新建 keepAlive 连接池会让空闲连接越积越多：同样的 TLS 设置共用一个连接池。
test('requests to an HTTPS NAS with the same TLS settings reuse one connection', async (t) => {
    withoutElectron(t);
    const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));
    const tlsDir = path.join(__dirname, 'fixtures', 'tls');
    const server = https.createServer({
        key: fs.readFileSync(path.join(tlsDir, 'nas-key.pem')),
        cert: fs.readFileSync(path.join(tlsDir, 'nas.pem')),
    }, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: null }));
    });
    let connections = 0;
    server.on('secureConnection', () => { connections += 1; });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    }));
    const baseUrl = `https://127.0.0.1:${server.address().port}`;
    const ca = [fs.readFileSync(path.join(tlsDir, 'ca.pem'), 'utf8')];
    const context = (skipVerify) => ({ accessCookie: () => '', skipVerify: () => skipVerify, ca, log: { warn() {}, error() {} } });

    for (let i = 0; i < 3; i++) {
        assert.equal((await request(context(true), baseUrl, '/v/api/v1/user/info', HttpMethod.GET, 'token-1')).success, true);
    }
    assert.equal(connections, 1);

    // 校验证书的请求不能用跳过校验时建立的连接。
    await request(context(false), baseUrl, '/v/api/v1/user/info', HttpMethod.GET, 'token-1');
    assert.equal(connections, 2);
});

async function redirectingNas(t, hops, finalResponses = [{ code: 0, msg: '', data: { ok: true } }]) {
    const hits = { redirects: 0, final: 0 };
    const server = http.createServer((req, res) => {
        const left = Number(req.url.split('/').pop());
        if (left > 0) {
            hits.redirects += 1;
            res.statusCode = 302;
            res.setHeader('Location', `/hop/${left - 1}`);
            res.end();
            return;
        }
        const body = finalResponses[Math.min(hits.final, finalResponses.length - 1)];
        hits.final += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const context = { accessCookie: () => '', skipVerify: () => false, log: { warn() {}, error() {} } };
    const call = (tryTimes) => {
        const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));
        return request(context, baseUrl, `/hop/${hops}`, HttpMethod.GET, 'token-1', undefined, undefined, undefined, 5000, tryTimes);
    };
    return { baseUrl, hits, call };
}

test('a request that must not be retried still follows a redirect to the NAS', async (t) => {
    withoutElectron(t);
    const nas = await redirectingNas(t, 1);

    const result = await nas.call(0);

    assert.deepEqual(result, { success: true, data: { ok: true }, moveUrl: nas.baseUrl });
    assert.equal(nas.hits.final, 1);
});

test('a request follows up to 5 redirects and reports too many redirects beyond that', async (t) => {
    withoutElectron(t);
    const withinLimit = await redirectingNas(t, 5);
    assert.equal((await withinLimit.call(5)).success, true);

    const beyondLimit = await redirectingNas(t, 6);
    const result = await beyondLimit.call(5);

    assert.equal(result.success, false);
    assert.match(result.message, /重定向次数过多/);
    assert.equal(beyondLimit.hits.redirects, 6);
    assert.equal(beyondLimit.hits.final, 0);
});

test('a redirect does not use up the retries for an invalid signature at the target', async (t) => {
    withoutElectron(t);
    const nas = await redirectingNas(t, 5, [
        { code: 5000, msg: 'invalid sign', data: null },
        { code: 0, msg: '', data: { ok: true } },
    ]);

    const result = await nas.call(1);

    assert.equal(result.success, true);
    assert.equal(nas.hits.final, 2);
});

const GATEWAY_ERROR_PAGE = '<html><body>502 Bad Gateway from the reverse proxy</body></html>';

async function nasAnswering(t, contentType, body) {
    const server = http.createServer((req, res) => {
        if (contentType) res.setHeader('Content-Type', contentType);
        res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const logged = [];
    const record = (...args) => logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    const context = { accessCookie: () => '', skipVerify: () => false, log: { warn: record, error: record } };
    const call = (expect) => {
        const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));
        return request(context, baseUrl, '/v/api/v1/user/info', HttpMethod.GET, 'token-1', undefined, undefined, undefined, 5000, 0, expect);
    };
    return { logged, call };
}

test('a request expecting JSON reports an HTML page as a failure with its status and content type', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, 'text/html', GATEWAY_ERROR_PAGE);

    const result = await nas.call();

    assert.equal(result.success, false);
    assert.match(result.message, /200/);
    assert.match(result.message, /text\/html/);
    assert.doesNotMatch(result.message, /Bad Gateway/);
    assert.ok(nas.logged.every((line) => !line.includes('Bad Gateway')));
});

test('a request expecting JSON reports a response without a content type as a failure', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, undefined, GATEWAY_ERROR_PAGE);

    const result = await nas.call();

    assert.equal(result.success, false);
    assert.match(result.message, /200/);
    assert.match(result.message, /Content-Type: 缺失/);
    assert.ok(nas.logged.every((line) => !line.includes('Bad Gateway')));
});

test('a request expecting raw data returns the body whatever its content type', async (t) => {
    withoutElectron(t);
    const subtitle = '1\n00:00:01,000 --> 00:00:02,000\n你好\n';

    for (const contentType of ['text/plain; charset=utf-8', undefined]) {
        const nas = await nasAnswering(t, contentType, subtitle);
        assert.deepEqual(await nas.call('raw'), { success: true, data: subtitle });
    }
});

test('a request expecting raw data keeps a body that happens to parse as JSON as text', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, 'text/plain', '{"cues":[]}');

    assert.deepEqual(await nas.call('raw'), { success: true, data: '{"cues":[]}' });
});

test('a request expecting raw data still reports an fnAPI error answered as JSON', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, 'application/json', JSON.stringify({ code: 401, msg: 'token expired', data: null }));

    assert.deepEqual(await nas.call('raw'), { success: false, message: 'token expired' });
});

test('following a redirect to another NAS address logs neither its host nor its port', async (t) => {
    withoutElectron(t);
    const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));
    const listen = async (handler) => {
        const server = http.createServer(handler);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        t.after(() => new Promise((resolve) => server.close(resolve)));
        return server.address().port;
    };
    const targetPort = await listen((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: { ok: true } }));
    });
    const target = `http://localhost:${targetPort}`;
    const sourcePort = await listen((req, res) => {
        res.statusCode = 302;
        res.setHeader('Location', `${target}/v/api/v1/user/info?from=moved`);
        res.end();
    });
    const logged = [];
    const record = (...args) => logged.push(args.map(String).join(' '));
    const context = { accessCookie: () => '', skipVerify: () => false, log: { warn: record, error: record } };

    const result = await request(context, `http://127.0.0.1:${sourcePort}`, '/v/api/v1/user/info', HttpMethod.GET, 'token-1');

    assert.deepEqual(result, { success: true, data: { ok: true }, moveUrl: target });
    assert.ok(logged.length > 0, 'the redirect was not logged');
    for (const line of logged) {
        assert.doesNotMatch(line, /localhost/);
        assert.doesNotMatch(line, new RegExp(String(targetPort)));
        assert.doesNotMatch(line, /from=moved/);
    }
});
