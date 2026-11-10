// 从 Go 版升级的用户目录里留有 proxy-secret，启动时删掉（ADR-0004）。
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

// Windows 上文件被占用时删除会失败（EPERM、EBUSY），启动不能因此中断。
test('a legacy proxy secret that cannot be deleted is logged and startup continues', (t) => {
    const directory = userDataDir(t);
    // 同名的非空目录让删除必然失败。
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
