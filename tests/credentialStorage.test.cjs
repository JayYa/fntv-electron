const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function legacyEncrypt(value) {
    const key = Buffer.from('U2XDcFsV6rdTE9wB5ZHvy6BW9hBTKJ1H');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16, 0));
    return cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
}

function setupConfig(t, { storageBackend = 'gnome_libsecret' } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-credentials-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const electronMock = {
        app: {
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
        },
        safeStorage: {
            isEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return storageBackend; },
            encryptString(value) { return Buffer.from(`protected:${value}`, 'utf8'); },
            decryptString(value) {
                const decoded = value.toString('utf8');
                assert.match(decoded, /^protected:/);
                return decoded.slice('protected:'.length);
            },
        },
    };

    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return electronMock;
        return originalLoad.call(this, request, parent, isMain);
    };

    const clearCompiledModules = () => Object.keys(require.cache)
        .filter((id) => id.includes(`${path.sep}dest${path.sep}`))
        .forEach((id) => delete require.cache[id]);

    t.after(() => {
        Module._load = originalLoad;
        clearCompiledModules();
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    fs.mkdirSync(paths.userData, { recursive: true });
    clearCompiledModules();
    return {
        loadConfig: () => require('../dest/modules/fn_config/config.js'),
        configPath: path.join(paths.userData, 'config.json'),
    };
}

function simulateLinux(t) {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
    t.after(() => Object.defineProperty(process, 'platform', originalPlatform));
}

test('migrates legacy credentials to OS-protected storage without changing returned values', (t) => {
    const { loadConfig, configPath } = setupConfig(t);
    fs.writeFileSync(configPath, JSON.stringify({
        account: 'user',
        domain: 'https://nas.example',
        token: 'legacy-token',
        accessCode: 'legacy-access-code',
        history: [{
            domain: 'nas.example',
            account: 'user',
            password: legacyEncrypt('legacy-password'),
            accessCode: 'legacy-history-access-code',
        }],
    }));

    const config = loadConfig();
    assert.equal(config.readConfig().token, 'legacy-token');
    assert.equal(config.readConfig().accessCode, 'legacy-access-code');
    assert.equal(config.getHistory()[0].password, 'legacy-password');
    assert.equal(config.getHistory()[0].accessCode, 'legacy-history-access-code');

    const stored = fs.readFileSync(configPath, 'utf8');
    assert.doesNotMatch(stored, /legacy-token|legacy-password|legacy-access-code|legacy-history-access-code/);
    assert.match(stored, /safe-storage:v1:/);
});

test('Linux refuses to save credentials when safeStorage falls back to basic_text', (t) => {
    simulateLinux(t);
    const { loadConfig, configPath } = setupConfig(t, { storageBackend: 'basic_text' });

    assert.throws(
        () => loadConfig().saveConfig({ account: 'user', domain: 'https://nas.example', token: 'plain-token' }),
        /拒绝以明文方式保存登录凭据/,
    );
    assert.equal(fs.existsSync(configPath), false);
});

test('Linux saves credentials encrypted when safeStorage uses a real keyring', (t) => {
    simulateLinux(t);
    const { loadConfig, configPath } = setupConfig(t);

    loadConfig().saveConfig({ account: 'user', domain: 'https://nas.example', token: 'plain-token' });

    const stored = fs.readFileSync(configPath, 'utf8');
    assert.doesNotMatch(stored, /plain-token/);
    assert.match(stored, /safe-storage:v1:/);
});
