const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./fakeElectron.cjs');

function legacyEncrypt(value) {
    const key = Buffer.from('U2XDcFsV6rdTE9wB5ZHvy6BW9hBTKJ1H');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16, 0));
    return cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
}

// Electron 45 写入的格式：safeStorage.encryptString 的结果，base64 后加前缀。
function syncFormatCiphertext(plaintext) {
    return `safe-storage:v1:${Buffer.from(`protected:${plaintext}`, 'utf8').toString('base64')}`;
}

function removedSyncApi(name) {
    return () => { throw new Error(`safeStorage.${name} 在 Electron 46 中已删除`); };
}

function setupConfig(t, { storageBackend = 'gnome_libsecret', encryptionAvailable = true } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-credentials-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    // 放进这个集合的明文解密时抛错，模拟密钥环锁定或换了机器；清空即密钥恢复。
    const undecryptable = new Set();
    // 放进这个集合的明文解密时要求重新加密，模拟密钥轮换。
    const reEncrypt = new Set();
    // 非空时加密要等它 resolve，用来在加密途中插入别的操作。
    let encryptionGate = null;
    const holdEncryption = () => {
        let release;
        encryptionGate = new Promise((resolve) => { release = resolve; });
        return () => { encryptionGate = null; release(); };
    };
    let encryptCount = 0;
    const dialogs = [];
    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
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
            isEncryptionAvailable: removedSyncApi('isEncryptionAvailable'),
            encryptString: removedSyncApi('encryptString'),
            decryptString: removedSyncApi('decryptString'),
            async isAsyncEncryptionAvailable() { return encryptionAvailable; },
            getSelectedStorageBackend() { return storageBackend; },
            async encryptStringAsync(value) {
                if (encryptionGate) await encryptionGate;
                encryptCount++;
                return Buffer.from(`protected:${value}`, 'utf8');
            },
            async decryptStringAsync(value) {
                const decoded = value.toString('utf8');
                assert.match(decoded, /^protected:/);
                const plaintext = decoded.slice('protected:'.length);
                if (undecryptable.has(plaintext)) {
                    throw new Error(`cannot decrypt ${value.toString('base64')} (${plaintext})`);
                }
                return { result: plaintext, shouldReEncrypt: reEncrypt.has(plaintext) };
            },
        },
    };

    useFakeElectron(t, electronMock);
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    fs.mkdirSync(paths.userData, { recursive: true });
    return {
        loadConfig: () => require('../../dest/modules/fn_config/config.js'),
        loadWinctrl: () => require('../../dest/main/common/winctrl.js'),
        dialogs,
        configPath: path.join(paths.userData, 'config.json'),
        logPath: path.join(testRoot, 'log', 'app.log'),
        undecryptable,
        reEncrypt,
        holdEncryption,
        encryptCount: () => encryptCount,
        setEncryptionAvailable(value) { encryptionAvailable = value; },
    };
}

async function seedLoggedInConfig(config) {
    await config.saveConfig({
        account: 'user',
        domain: 'https://nas.example',
        token: 'saved-token',
        accessCode: 'saved-access-code',
        useHttps: true,
    });
    await config.addHistory({
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

async function assertCredentialsRestored(config) {
    const loaded = await config.readConfig();
    assert.equal(loaded.token, 'saved-token');
    assert.equal(loaded.accessCode, 'saved-access-code');
    const history = await config.getHistory();
    assert.equal(history.at(-1).password, 'saved-password');
    assert.equal(history.at(-1).accessCode, 'saved-history-access-code');
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
    syncFormatCiphertext,
};
