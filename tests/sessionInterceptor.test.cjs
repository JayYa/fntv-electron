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
        app: { getPath: () => testRoot, getAppPath: () => testRoot, isPackaged: false, setPath() {}, commandLine: { getSwitchValue: () => '' } },
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

function deliver(attached, url) {
    const responses = [];
    attached[0].listener({ url }, (response) => responses.push(response));
    return responses;
}

test('every registered before-request handler runs through a single session listener', (t) => {
    const { interceptor, attached } = setup(t);
    const seen = [];
    interceptor.registerBeforeRequest({ urls: ['https://*/v/login'] }, (details, callback) => {
        seen.push(`login ${details.url}`);
        callback({ cancel: true });
    }, 'login');
    interceptor.registerBeforeRequest({ urls: ['http://*/v/api/v1/user/logout'] }, (details, callback) => {
        seen.push(`logout ${details.url}`);
        callback({ cancel: true });
    }, 'logout');
    interceptor.run();

    assert.equal(attached.length, 1);
    assert.deepEqual(attached[0].filter, { urls: ['https://*/v/login', 'http://*/v/api/v1/user/logout'] });
    assert.deepEqual(deliver(attached, 'https://nas/v/login'), [{ cancel: true }]);
    assert.deepEqual(deliver(attached, 'http://nas/v/api/v1/user/logout'), [{ cancel: true }]);
    assert.deepEqual(seen, ['login https://nas/v/login', 'logout http://nas/v/api/v1/user/logout']);
});

test('a request no registered filter matches continues untouched', (t) => {
    const { interceptor, attached } = setup(t);
    const seen = [];
    interceptor.registerBeforeRequest({ urls: ['https://*/v/login'] }, (details) => seen.push(details.url), 'login');
    interceptor.run();

    assert.deepEqual(deliver(attached, 'http://nas/v/login'), [{}]);
    assert.deepEqual(deliver(attached, 'https://nas/v/login/x'), [{}]);
    assert.deepEqual(seen, []);
});

test('the login plugin ends the login when the web app opens the login, welcome or logout address of a NAS with a port', (t) => {
    const { interceptor, attached } = setup(t);
    const mainWindow = {};
    const ended = [];
    t.mock.method(require('../dest/main/common/mainWindow.js').mainWindow, 'window', () => mainWindow);
    t.mock.method(require('../dest/main/common/currentLogin.js'), 'endCurrentLogin', async (win) => ended.push(win));
    require('../dest/main/handlers/plugins/login.js').init();
    interceptor.run();

    const leaving = [
        'http://192.168.1.10:5666/v/login',
        'https://demo.fnos.net/v/welcome',
        'http://[fd00::10]:5666/v/api/v1/user/logout',
    ];
    for (const url of leaving) {
        assert.deepEqual(deliver(attached, url), [{ cancel: true }], url);
    }
    for (const url of ['http://192.168.1.10:5666/v/login?redirect=%2Fv', 'http://192.168.1.10:5666/v/library']) {
        assert.deepEqual(deliver(attached, url), [{}], url);
    }
    assert.deepEqual(ended, leaving.map(() => mainWindow));
});

test('registering a URL pattern the manager cannot match fails at once', (t) => {
    const { interceptor } = setup(t);
    assert.throws(() => interceptor.registerBeforeRequest({ urls: ['<all_urls>'] }, () => {}, 'all'), /<all_urls>/);
});
