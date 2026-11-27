const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { withoutElectron } = require('./helpers/fakeElectron.cjs');

const CORE_DIR = path.join(__dirname, '..', 'dest', 'modules', 'fn_api', 'core');

async function listen(t, server) {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    }));
    return server.address().port;
}

function nasContext(overrides = {}) {
    const logged = [];
    const record = (...args) => logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    return { accessCookie: () => '', skipVerify: () => false, log: { warn: record, error: record }, logged, ...overrides };
}

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
    const baseUrl = `http://127.0.0.1:${await listen(t, server)}`;

    const context = nasContext({ accessCookie: (origin) => (origin === baseUrl ? 'gateway=granted; mode=web' : '') });
    const result = await request(context, { baseUrl, path: '/v/api/v1/user/info', method: HttpMethod.GET, token: 'token-1' });

    assert.deepEqual(result, { ok: true, data: { ok: true } });
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
    const baseUrl = `http://127.0.0.1:${await listen(t, server)}`;

    const api = new FnApiClient(nasContext(), baseUrl, 'token-1', new TtlCache());

    const failed = await api.getStreamListCached('item-1');
    assert.equal(failed.ok, false);
    assert.equal(requests, 1);

    const succeeded = await api.getStreamListCached('item-1');
    assert.deepEqual(succeeded, { ok: true, data: { list: ['video'] } });
    assert.equal(requests, 2);

    const cached = await api.getStreamListCached('item-1');
    assert.deepEqual(cached, succeeded);
    assert.equal(requests, 2);
});

test('a cached call still in flight after 30 seconds is reused instead of asking the NAS again', async (t) => {
    withoutElectron(t);
    const { FnApiClient } = require(path.join(CORE_DIR, 'apiClient.js'));
    const { TtlCache } = require(path.join(CORE_DIR, 'ttlCache.js'));

    let now = 1_000_000;
    let requests = 0;
    let releaseFirst;
    let firstArrived;
    const arrival = new Promise((resolve) => { firstArrived = resolve; });
    const answer = (res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: { list: ['video'] } }));
    };
    const server = http.createServer((req, res) => {
        requests += 1;
        if (requests > 1) return answer(res);
        releaseFirst = () => answer(res);
        firstArrived();
    });
    const baseUrl = `http://127.0.0.1:${await listen(t, server)}`;
    const api = new FnApiClient(nasContext(), baseUrl, 'token-1', new TtlCache({ now: () => now }));

    const first = api.getStreamListCached('item-1');
    await arrival;
    now += 31_000;
    const second = api.getStreamListCached('item-1');
    releaseFirst();
    const results = await Promise.all([first, second]);

    assert.equal(requests, 1);
    assert.deepEqual(results[1], results[0]);
});

test('clients sharing one cache reuse a cached call another client has in flight', async (t) => {
    withoutElectron(t);
    const { FnApiClient } = require(path.join(CORE_DIR, 'apiClient.js'));
    const { TtlCache } = require(path.join(CORE_DIR, 'ttlCache.js'));

    let requests = 0;
    const server = http.createServer((req, res) => {
        requests += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: { list: ['video'] } }));
    });
    const baseUrl = `http://127.0.0.1:${await listen(t, server)}`;
    const cache = new TtlCache();
    const client = () => new FnApiClient(nasContext(), baseUrl, 'token-1', cache);

    const [first, second] = await Promise.all([client().getStreamListCached('item-1'), client().getStreamListCached('item-1')]);

    assert.equal(requests, 1);
    assert.deepEqual(second, first);
});

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
    const baseUrl = `https://127.0.0.1:${await listen(t, server)}`;
    const ca = [fs.readFileSync(path.join(tlsDir, 'ca.pem'), 'utf8')];
    const context = (skipVerify) => nasContext({ skipVerify: () => skipVerify, ca });

    for (let i = 0; i < 3; i++) {
        assert.equal((await request(context(true), { baseUrl, path: '/v/api/v1/user/info', method: HttpMethod.GET, token: 'token-1' })).ok, true);
    }
    assert.equal(connections, 1);

    await request(context(false), { baseUrl, path: '/v/api/v1/user/info', method: HttpMethod.GET, token: 'token-1' });
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
    const baseUrl = `http://127.0.0.1:${await listen(t, server)}`;
    const context = nasContext();
    const call = (retries) => {
        const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));
        return request(context, { baseUrl, path: `/hop/${hops}`, method: HttpMethod.GET, token: 'token-1', timeout: 5000, retries });
    };
    return { baseUrl, hits, call };
}

test('a request that must not be retried still follows a redirect to the NAS', async (t) => {
    withoutElectron(t);
    const nas = await redirectingNas(t, 1);

    const result = await nas.call(0);

    assert.deepEqual(result, { ok: true, data: { ok: true } });
    assert.equal(nas.hits.final, 1);
});

test('a request follows up to 5 redirects and reports too many redirects beyond that', async (t) => {
    withoutElectron(t);
    const withinLimit = await redirectingNas(t, 5);
    assert.equal((await withinLimit.call(5)).ok, true);

    const beyondLimit = await redirectingNas(t, 6);
    const result = await beyondLimit.call(5);

    assert.equal(result.ok, false);
    assert.match(result.failure.message, /重定向次数过多/);
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

    assert.equal(result.ok, true);
    assert.equal(nas.hits.final, 2);
});

const GATEWAY_ERROR_PAGE = '<html><body>502 Bad Gateway from the reverse proxy</body></html>';

async function nasAnswering(t, contentType, body) {
    const server = http.createServer((req, res) => {
        if (contentType) res.setHeader('Content-Type', contentType);
        res.end(body);
    });
    const baseUrl = `http://127.0.0.1:${await listen(t, server)}`;
    const context = nasContext();
    const call = (expect) => {
        const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));
        return request(context, { baseUrl, path: '/v/api/v1/user/info', method: HttpMethod.GET, token: 'token-1', timeout: 5000, retries: 0, expect });
    };
    return { baseUrl, logged: context.logged, call };
}

test('a request expecting JSON reports an HTML page as a failure with its status and content type', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, 'text/html', GATEWAY_ERROR_PAGE);

    const result = await nas.call();

    assert.equal(result.ok, false);
    assert.match(result.failure.message, /200/);
    assert.match(result.failure.message, /text\/html/);
    assert.doesNotMatch(result.failure.message, /Bad Gateway/);
    assert.ok(nas.logged.every((line) => !line.includes('Bad Gateway')));
});

test('a request expecting JSON reports a response without a content type as a failure', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, undefined, GATEWAY_ERROR_PAGE);

    const result = await nas.call();

    assert.equal(result.ok, false);
    assert.match(result.failure.message, /200/);
    assert.match(result.failure.message, /Content-Type: 缺失/);
    assert.ok(nas.logged.every((line) => !line.includes('Bad Gateway')));
});

test('a request expecting raw data returns the body whatever its content type', async (t) => {
    withoutElectron(t);
    const subtitle = '1\n00:00:01,000 --> 00:00:02,000\n你好\n';

    for (const contentType of ['text/plain; charset=utf-8', undefined]) {
        const nas = await nasAnswering(t, contentType, subtitle);
        assert.deepEqual(await nas.call('raw'), { ok: true, data: subtitle });
    }
});

test('a request expecting raw data keeps a body that happens to parse as JSON as text', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, 'text/plain', '{"cues":[]}');

    assert.deepEqual(await nas.call('raw'), { ok: true, data: '{"cues":[]}' });
});

test('a request expecting raw data still reports an fnAPI error answered as JSON', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, 'application/json', JSON.stringify({ code: 401, msg: 'token expired', data: null }));

    assert.deepEqual(await nas.call('raw'), { ok: false, failure: { kind: 'failed', message: 'token expired' } });
});

test('following a redirect to another NAS address logs neither its host nor its port', async (t) => {
    withoutElectron(t);
    const { request, HttpMethod } = require(path.join(CORE_DIR, 'request.js'));
    const targetPort = await listen(t, http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: { ok: true } }));
    }));
    const target = `http://localhost:${targetPort}`;
    const sourcePort = await listen(t, http.createServer((req, res) => {
        res.statusCode = 302;
        res.setHeader('Location', `${target}/v/api/v1/user/info?from=moved`);
        res.end();
    }));
    const context = nasContext();

    const result = await request(context, { baseUrl: `http://127.0.0.1:${sourcePort}`, path: '/v/api/v1/user/info', method: HttpMethod.GET, token: 'token-1' });

    assert.deepEqual(result, { ok: true, data: { ok: true }, movedTo: target });
    assert.ok(context.logged.length > 0, 'the redirect was not logged');
    for (const line of context.logged) {
        assert.doesNotMatch(line, /localhost/);
        assert.doesNotMatch(line, new RegExp(String(targetPort)));
        assert.doesNotMatch(line, /from=moved/);
    }
});

function nasClient(t, context, baseUrl) {
    const { FnApiClient } = require(path.join(CORE_DIR, 'apiClient.js'));
    const { TtlCache } = require(path.join(CORE_DIR, 'ttlCache.js'));
    return new FnApiClient(context, baseUrl, 'token-1', new TtlCache());
}

test('a NAS whose certificate is not trusted is reported as a certificate failure', async (t) => {
    withoutElectron(t);
    const tlsDir = path.join(__dirname, 'fixtures', 'tls');
    const server = https.createServer({
        key: fs.readFileSync(path.join(tlsDir, 'nas-key.pem')),
        cert: fs.readFileSync(path.join(tlsDir, 'nas.pem')),
    }, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: {} }));
    });
    const baseUrl = `https://127.0.0.1:${await listen(t, server)}`;

    const result = await nasClient(t, nasContext(), baseUrl).getPlayInfo('item-1');

    assert.equal(result.ok, false);
    assert.equal(result.failure.kind, 'certificate');
    assert.ok(result.failure.message.length > 0);
});

test('asking an HTTP port over HTTPS is reported as an HTTPS port mismatch without retrying', async (t) => {
    withoutElectron(t);
    let connections = 0;
    const server = http.createServer(() => {});
    server.on('connection', () => { connections += 1; });
    const port = await listen(t, server);

    const result = await nasClient(t, nasContext(), `https://127.0.0.1:${port}`).getPlayInfo('item-1');

    assert.equal(result.ok, false);
    assert.equal(result.failure.kind, 'https-port-mismatch');
    assert.equal(connections, 1);
});

test('an fnAPI error is reported as a plain failure carrying the NAS message', async (t) => {
    withoutElectron(t);
    const nas = await nasAnswering(t, 'application/json', JSON.stringify({ code: 1001, msg: 'item not found', data: null }));
    const baseUrl = nas.baseUrl;

    const result = await nasClient(t, nasContext(), baseUrl).getPlayInfo('item-1');

    assert.deepEqual(result, { ok: false, failure: { kind: 'failed', message: 'item not found' } });
});

test('a call redirected to another NAS address reports where it ended up, a redirect within the same address does not', async (t) => {
    withoutElectron(t);
    const targetPort = await listen(t, http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, msg: '', data: { guid: 'item-1' } }));
    }));
    const target = `http://localhost:${targetPort}`;
    const moved = await listen(t, http.createServer((req, res) => {
        res.statusCode = 302;
        res.setHeader('Location', `${target}${req.url}`);
        res.end();
    }));
    const sameAddress = await redirectingNas(t, 2);

    const movedResult = await nasClient(t, nasContext(), `http://127.0.0.1:${moved}`).getPlayInfo('item-1');
    const sameResult = await nasClient(t, nasContext(), sameAddress.baseUrl).getEpisodeList('hop/2');

    assert.deepEqual(movedResult, { ok: true, data: { guid: 'item-1' }, movedTo: target });
    assert.equal(sameResult.ok, true);
    assert.equal('movedTo' in sameResult, false);
});

test('a token check asks the NAS once and reports whether the token was accepted', async (t) => {
    withoutElectron(t);
    const answers = [];
    const server = http.createServer((req, res) => {
        answers.push(req.headers.authorization);
        res.setHeader('Content-Type', 'application/json');
        const accepted = req.headers.authorization === 'token-1';
        res.end(JSON.stringify(accepted ? { code: 0, msg: '', data: {} } : { code: 5000, msg: 'invalid sign', data: null }));
    });
    const baseUrl = `http://127.0.0.1:${await listen(t, server)}`;
    const { FnApiClient } = require(path.join(CORE_DIR, 'apiClient.js'));
    const { TtlCache } = require(path.join(CORE_DIR, 'ttlCache.js'));
    const client = (token) => new FnApiClient(nasContext(), baseUrl, token, new TtlCache());

    assert.equal(await client('token-1').tokenAccepted(), true);
    assert.equal(await client('stale-token').tokenAccepted(), false);
    assert.deepEqual(answers, ['token-1', 'stale-token']);
});
