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
    // 放进这个集合的明文解密时抛错，模拟密钥环锁定或换了机器；清空即密钥恢复。
    const undecryptable = new Set();
    const dialogs = [];
    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
        },
        dialog: {
            async showMessageBox(window, options) { dialogs.push(options); return { response: 0 }; },
        },
        net: {
            request() { throw new Error('startup must not reach the access code gateway'); },
        },
        session: {
            fromPartition() { throw new Error('startup must not touch the session'); },
        },
        safeStorage: {
            isEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return storageBackend; },
            encryptString(value) { return Buffer.from(`protected:${value}`, 'utf8'); },
            decryptString(value) {
                const decoded = value.toString('utf8');
                assert.match(decoded, /^protected:/);
                const plaintext = decoded.slice('protected:'.length);
                if (undecryptable.has(plaintext)) {
                    throw new Error(`cannot decrypt ${value.toString('base64')} (${plaintext})`);
                }
                return plaintext;
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
        loadConfig: () => require('../../dest/modules/fn_config/config.js'),
        loadWinctrl: () => require('../../dest/main/common/winctrl.js'),
        dialogs,
        configPath: path.join(paths.userData, 'config.json'),
        logPath: path.join(testRoot, 'log', 'app.log'),
        undecryptable,
    };
}

function seedLoggedInConfig(config) {
    config.saveConfig({
        account: 'user',
        domain: 'https://nas.example',
        token: 'saved-token',
        accessCode: 'saved-access-code',
        useHttps: true,
    });
    config.addHistory({
        domain: 'nas.example',
        account: 'user',
        password: 'saved-password',
        accessCode: 'saved-history-access-code',
        useHttps: true,
    });
    config.setMpvVolume(42);
}

function fakeMainWindow() {
    const loaded = { files: [], urls: [] };
    return {
        loaded,
        loadFile(file) { loaded.files.push(file); },
        loadURL(url) { loaded.urls.push(url); },
    };
}

function assertLandedOnLoginPage(window) {
    assert.equal(window.loaded.urls.length, 0);
    assert.equal(window.loaded.files.length, 1);
    assert.equal(path.relative(path.resolve(__dirname, '..', '..'), window.loaded.files[0]), path.join('resource', 'login', 'index.html'));
}

function simulateLinux(t) {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
    t.after(() => Object.defineProperty(process, 'platform', originalPlatform));
}

function assertCredentialsRestored(config) {
    const loaded = config.readConfig();
    assert.equal(loaded.token, 'saved-token');
    assert.equal(loaded.accessCode, 'saved-access-code');
    assert.equal(config.getHistory().at(-1).password, 'saved-password');
    assert.equal(config.getHistory().at(-1).accessCode, 'saved-history-access-code');
}

const SAVED_CREDENTIALS = ['saved-token', 'saved-access-code', 'saved-password', 'saved-history-access-code'];

module.exports = {
    SAVED_CREDENTIALS,
    assertCredentialsRestored,
    assertLandedOnLoginPage,
    fakeMainWindow,
    legacyEncrypt,
    seedLoggedInConfig,
    setupConfig,
    simulateLinux,
};
