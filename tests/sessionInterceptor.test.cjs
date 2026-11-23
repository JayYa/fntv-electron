const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

function setup(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-interceptor-'));
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    const attached = [];
    const webRequest = {
        onBeforeRequest(filter, listener) { attached.push({ filter, listener }); },
    };
    useFakeElectron(t, {
        app: { getPath: () => testRoot, getAppPath: () => testRoot, isPackaged: false },
        session: { fromPartition: () => ({ webRequest }) },
    });
    const { interceptor } = require('../dest/main/handlers/core/interceptor.js');
    interceptor.init('persist:fntv');
    return { interceptor, attached };
}

test('a registered before-request handler is attached to the session with its filter once the manager runs', (t) => {
    const { interceptor, attached } = setup(t);
    const seen = [];
    interceptor.registerBeforeRequest({ urls: ['https://*/v/login'] }, (details, callback) => {
        seen.push(details.url);
        callback({ cancel: true });
    }, 'login');

    assert.equal(attached.length, 0);
    interceptor.run();

    assert.equal(attached.length, 1);
    assert.deepEqual(attached[0].filter, { urls: ['https://*/v/login'] });
    const responses = [];
    attached[0].listener({ url: 'https://nas/v/login' }, (response) => responses.push(response));
    assert.deepEqual(seen, ['https://nas/v/login']);
    assert.deepEqual(responses, [{ cancel: true }]);
});

test('a before-request handler that throws lets the request continue', (t) => {
    const { interceptor, attached } = setup(t);
    const logged = [];
    t.mock.method(require('../dest/modules/logger/index.js'), 'error', (message) => logged.push(message));
    interceptor.registerBeforeRequest({ urls: ['https://*/v/login'] }, () => { throw new Error('boom'); }, 'broken');
    interceptor.run();

    const responses = [];
    attached[0].listener({ url: 'https://nas/v/login' }, (response) => responses.push(response));

    assert.deepEqual(responses, [{}]);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /broken/);
});
