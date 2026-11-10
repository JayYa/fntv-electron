const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { startProxy, get } = require('./helpers/proxyService.cjs');

test('unknown paths and wrong methods get a JSON 404', async (t) => {
    const { service } = await startProxy(t);
    for (const [method, requestPath] of [
        ['GET', '/nope'],
        ['GET', '/health'],
        ['POST', '/api/v1/session'],
        ['POST', '/api/v1/playvideo/item-1'],
        ['HEAD', '/api/v1/playvideo/item-1'],
        ['GET', '/api/v1/playvideo/'],
        ['GET', '/api/v1/playvideo/item-1/extra'],
    ]) {
        const response = await get(service, requestPath, {}, method);
        assert.equal(response.status, 404, `${method} ${requestPath}`);
        if (method !== 'HEAD') assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Not Found' });
    }
});

test('a trailing slash on a known route redirects to the path without it', async (t) => {
    const { service } = await startProxy(t);

    const response = await get(service, '/api/v1/playvideo/item-1/?session=abc');

    assert.equal(response.status, 301);
    assert.equal(response.headers.location, '/api/v1/playvideo/item-1?session=abc');
});

test('the proxy service loads in a plain Node process without requiring electron', (t) => {
    const requested = [];
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') {
            requested.push(parent && parent.filename);
            throw new Error('electron is not available');
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    t.after(() => { Module._load = originalLoad; });
    const serviceDir = path.join(__dirname, '..', 'dest', 'modules', 'proxy_service');
    Object.keys(require.cache)
        .filter((id) => id.includes(`${path.sep}dest${path.sep}`))
        .forEach((id) => delete require.cache[id]);

    require(serviceDir);

    assert.deepEqual(requested, []);
});
