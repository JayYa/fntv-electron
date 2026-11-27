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

test('once the web UI session starts, opening the login, welcome or logout address of a NAS is cancelled and reported as leaving', (t) => {
    const { webUiSession, attached, partitions, deliver } = setup(t);
    let left = 0;

    webUiSession.start(() => { left += 1; });

    assert.equal(attached.length, 1);
    assert.deepEqual([...new Set(partitions)], [webUiSession.WEB_UI_SESSION_PARTITION]);
    assert.deepEqual([...attached[0].filter.urls].sort(), [
        'http://*/v/api/v1/user/logout',
        'http://*/v/login',
        'http://*/v/welcome',
        'https://*/v/api/v1/user/logout',
        'https://*/v/login',
        'https://*/v/welcome',
    ]);
    assert.deepEqual(deliver('http://192.168.1.10:5666/v/login'), [{ cancel: true }]);
    assert.equal(left, 1);
});

test('the web UI session clears its cache at start and every six hours once it grows past 100 MB', async (t) => {
    const { webUiSession, cache } = setup(t, { cacheSize: 101 * MB });

    webUiSession.start(() => {});
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
