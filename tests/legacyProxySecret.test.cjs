const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removeLegacyProxySecret } = require('../dest/main/common/legacyProxySecret.js');

function userDataDir(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-legacy-secret-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test('startup deletes the proxy secret file left by the Go Proxy and keeps the rest of userData', (t) => {
    const directory = userDataDir(t);
    fs.writeFileSync(path.join(directory, 'proxy-secret'), 'a'.repeat(64), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'config.json'), '{}');

    removeLegacyProxySecret(directory, silentLog());

    assert.deepEqual(fs.readdirSync(directory), ['config.json']);
});

test('startup without a legacy proxy secret file does nothing', (t) => {
    const directory = userDataDir(t);

    removeLegacyProxySecret(directory, silentLog());

    assert.deepEqual(fs.readdirSync(directory), []);
});

test('a legacy proxy secret that cannot be deleted is logged and startup continues', (t) => {
    const directory = userDataDir(t);
    fs.mkdirSync(path.join(directory, 'proxy-secret'));
    fs.writeFileSync(path.join(directory, 'proxy-secret', 'locked'), '');
    const warnings = [];

    assert.doesNotThrow(() => removeLegacyProxySecret(directory, { warn: (...args) => warnings.push(args) }));

    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /proxy-secret/);
});

function silentLog() {
    return { warn: () => {} };
}
