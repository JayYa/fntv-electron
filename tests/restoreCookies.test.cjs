const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

const NAS = 'https://nas.example:5667';

function cookieStore(initial) {
    let stored = [...initial];
    return {
        stored: () => stored,
        cookies: {
            async get({ name }) { return stored.filter((cookie) => cookie.name === name); },
            async remove(url, name) { stored = stored.filter((cookie) => !(cookie.url === url && cookie.name === name)); },
            async set(cookie) {
                stored = stored.filter((existing) => !(existing.url === cookie.url && existing.name === cookie.name && existing.path === cookie.path));
                stored.push(cookie);
            },
        },
    };
}

test('restoring cookies replaces the saved token without waiting on a timer', async (t) => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-restore-cookies-'));
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    const store = cookieStore([{ url: NAS, name: 'Trim-MC-token', value: 'old-token', path: '/' }]);
    useFakeElectron(t, {
        app: { getPath: () => testRoot, getAppPath: () => testRoot, isPackaged: false },
        session: { fromPartition: () => ({ cookies: store.cookies }) },
    });
    const { restoreCookies } = require('../dest/modules/fn_config/cookie.js');
    t.mock.timers.enable({ apis: ['setTimeout'] });

    assert.equal(await restoreCookies(NAS, 'new-token', true), true);

    const tokens = store.stored().filter((cookie) => cookie.name === 'Trim-MC-token');
    assert.deepEqual(tokens.map((cookie) => cookie.value), ['new-token']);
});
