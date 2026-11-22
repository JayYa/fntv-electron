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
