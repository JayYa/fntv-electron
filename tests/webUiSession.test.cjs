const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

const MB = 1024 * 1024;

function setup(t, { cacheSize = 0 } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-web-ui-session-'));
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    t.mock.timers.enable({ apis: ['setInterval'] });
    const attached = [];
    const partitions = [];
    const cache = { size: cacheSize, cleared: 0 };
    const webUi = {
        webRequest: { onBeforeRequest(filter, listener) { attached.push({ filter, listener }); } },
        async getCacheSize() { return cache.size; },
        async clearCache() { cache.cleared += 1; cache.size = 0; },
    };
    useFakeElectron(t, {
        app: { getPath: () => testRoot, getAppPath: () => testRoot, isPackaged: false, setPath() {}, commandLine: { getSwitchValue: () => '' } },
        session: { fromPartition(partition) { partitions.push(partition); return webUi; } },
    });
    const webUiSession = require('../dest/main/common/webUiSession.js');
    const deliver = (url) => {
        const responses = [];
        attached[0].listener({ url }, (response) => responses.push(response));
        return responses;
    };
    return { webUiSession, attached, partitions, cache, deliver };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('once the web UI session starts, opening the login, welcome or logout address of a NAS ends the current login', (t) => {
    const { webUiSession, attached, partitions, deliver } = setup(t);
    const mainWindow = {};
    const ended = [];
    t.mock.method(require('../dest/main/common/mainWindow.js').mainWindow, 'window', () => mainWindow);
    t.mock.method(require('../dest/main/common/currentLogin.js'), 'endCurrentLogin', async (win) => ended.push(win));
    require('../dest/main/handlers/plugins/login.js').init();

    webUiSession.start();

    assert.equal(attached.length, 1);
    assert.deepEqual([...new Set(partitions)], [webUiSession.WEB_UI_SESSION_PARTITION]);
    const leaving = [
        'http://192.168.1.10:5666/v/login',
        'https://demo.fnos.net/v/welcome',
        'http://[fd00::10]:5666/v/api/v1/user/logout',
    ];
    for (const url of leaving) {
        assert.deepEqual(deliver(url), [{ cancel: true }], url);
    }
    for (const url of ['http://192.168.1.10:5666/v/login?redirect=%2Fv', 'http://192.168.1.10:5666/v/library']) {
        assert.deepEqual(deliver(url), [{}], url);
    }
    assert.deepEqual(ended, leaving.map(() => mainWindow));
});

test('registering a request interceptor after the web UI session started fails at once', (t) => {
    const { webUiSession } = setup(t);
    const { interceptor } = require('../dest/main/handlers/core/interceptor.js');
    webUiSession.start();

    assert.throws(() => interceptor.registerBeforeRequest({ urls: ['https://*/v/login'] }, () => {}, 'late'), /late/);
});

test('the web UI session clears its cache at start and every six hours once it grows past 100 MB', async (t) => {
    const { webUiSession, cache } = setup(t, { cacheSize: 101 * MB });

    webUiSession.start();
    await settle();
    assert.equal(cache.cleared, 1);

    cache.size = 100 * MB;
    t.mock.timers.tick(6 * 60 * 60 * 1000);
    await settle();
    assert.equal(cache.cleared, 1);

    cache.size = 150 * MB;
    t.mock.timers.tick(6 * 60 * 60 * 1000);
    await settle();
    assert.equal(cache.cleared, 2);
});
