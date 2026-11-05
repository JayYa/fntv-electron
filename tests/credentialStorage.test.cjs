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
        loadConfig: () => require('../dest/modules/fn_config/config.js'),
        loadWinctrl: () => require('../dest/main/common/winctrl.js'),
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
    assert.equal(path.relative(path.resolve(__dirname, '..'), window.loaded.files[0]), path.join('resource', 'login', 'index.html'));
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

test('an undecryptable token reads as logged out while other settings stay readable', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    undecryptable.add('saved-token');

    const loaded = config.readConfig();
    assert.equal(loaded.token, '');
    assert.equal(loaded.domain, 'https://nas.example');
    assert.equal(loaded.account, 'user');
    assert.equal(loaded.useHttps, true);
    assert.equal(config.getMpvVolume(), 42);
    assert.equal(config.getHistory()[0].password, 'saved-password');
});

test('an undecryptable history password blanks only that credential', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    undecryptable.add('saved-password');

    assert.deepEqual(config.getHistory(), [{
        domain: 'nas.example',
        account: 'user',
        password: '',
        accessCode: 'saved-history-access-code',
        useHttps: true,
    }]);
    assert.equal(config.readConfig().token, 'saved-token');
});

test('an undecryptable history access code blanks only that credential', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    undecryptable.add('saved-history-access-code');

    assert.equal(config.getHistory()[0].accessCode, '');
    assert.equal(config.getHistory()[0].password, 'saved-password');
});

test('an undecryptable access code alone reads as logged out so the gateway is not skipped', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    undecryptable.add('saved-access-code');

    const loaded = config.readConfig();
    assert.equal(loaded.accessCode, '');
    assert.equal(loaded.token, '');
    assert.equal(loaded.domain, 'https://nas.example');
});

test('a legacy history password that cannot be decrypted reads as empty', (t) => {
    const { loadConfig, configPath } = setupConfig(t);
    fs.writeFileSync(configPath, JSON.stringify({
        domain: 'https://nas.example',
        history: [{ domain: 'nas.example', account: 'user', password: 'not-legacy-ciphertext' }],
    }));

    assert.equal(loadConfig().getHistory()[0].password, '');
});

test('decryption failures are logged by field without ciphertext or plaintext', (t) => {
    const { loadConfig, configPath, logPath, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    ['saved-token', 'saved-access-code', 'saved-password', 'saved-history-access-code']
        .forEach((value) => undecryptable.add(value));
    config.readConfig();
    config.readConfig();

    const logged = fs.readFileSync(logPath, 'utf8');
    assert.equal(logged.match(/解密失败/g).length, 4);
    for (const secret of [
        stored.token.replace('safe-storage:v1:', ''),
        stored.accessCode.replace('safe-storage:v1:', ''),
        stored.history[0].password.replace('safe-storage:v1:', ''),
        stored.history[0].accessCode.replace('safe-storage:v1:', ''),
        'saved-',
    ]) {
        assert.equal(logged.includes(secret), false);
    }
});

function assertCredentialsRestored(config) {
    const loaded = config.readConfig();
    assert.equal(loaded.token, 'saved-token');
    assert.equal(loaded.accessCode, 'saved-access-code');
    assert.equal(config.getHistory().at(-1).password, 'saved-password');
    assert.equal(config.getHistory().at(-1).accessCode, 'saved-history-access-code');
}

const SAVED_CREDENTIALS = ['saved-token', 'saved-access-code', 'saved-password', 'saved-history-access-code'];

const SETTERS = {
    setDownloadProxyConfig: (config) => config.setDownloadProxyConfig({ enabled: false, proxyUrl: 'https://proxy.example' }),
    setDownloadProxyUrl: (config) => config.setDownloadProxyUrl('https://proxy.example'),
    setHideOriginalPlayButton: (config) => config.setHideOriginalPlayButton(false),
    setNasProxyEnabled: (config) => config.setNasProxyEnabled(true),
    setMacCloseAction: (config) => config.setMacCloseAction('quit'),
    setTrayNotificationShown: (config) => config.setTrayNotificationShown(true),
    setMpvPlayerPath: (config) => config.setMpvPlayerPath('/usr/bin/mpv'),
    setMpvVolume: (config) => config.setMpvVolume(10),
    setExitMode: (config) => config.setExitMode('direct'),
};

for (const [name, write] of Object.entries(SETTERS)) {
    test(`${name} keeps undecryptable ciphertext so it decrypts once the key recovers`, (t) => {
        const { loadConfig, undecryptable } = setupConfig(t);
        const config = loadConfig();
        seedLoggedInConfig(config);

        SAVED_CREDENTIALS.forEach((value) => undecryptable.add(value));
        assert.equal(config.readConfig().token, '');
        write(config);

        undecryptable.clear();
        assertCredentialsRestored(config);
    });
}

for (const failing of SAVED_CREDENTIALS) {
    test(`writing another field keeps ${failing} and the readable credentials intact`, (t) => {
        const { loadConfig, undecryptable } = setupConfig(t);
        const config = loadConfig();
        seedLoggedInConfig(config);

        undecryptable.add(failing);
        config.setMpvVolume(10);

        undecryptable.clear();
        assertCredentialsRestored(config);
        assert.equal(config.getMpvVolume(), 10);
    });
}

test('adding another history entry keeps the undecryptable entries', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    undecryptable.add('saved-password');
    undecryptable.add('saved-history-access-code');
    config.addHistory({ domain: 'other.example', account: 'other', password: 'other-password' });

    undecryptable.clear();
    assert.deepEqual(config.getHistory().map((item) => item.password), ['other-password', 'saved-password']);
    assert.equal(config.getHistory()[1].accessCode, 'saved-history-access-code');
});

test('the legacy migration write keeps ciphertext it cannot decrypt', (t) => {
    const { loadConfig, configPath, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    fs.writeFileSync(configPath, JSON.stringify({
        ...stored,
        history: [
            { domain: 'old.example', account: 'old', password: legacyEncrypt('legacy-password') },
            { domain: 'bad.example', account: 'bad', password: 'not-legacy-ciphertext' },
            ...stored.history,
        ],
    }));

    SAVED_CREDENTIALS.forEach((value) => undecryptable.add(value));
    assert.equal(config.getHistory()[0].password, 'legacy-password');

    const migrated = fs.readFileSync(configPath, 'utf8');
    assert.equal(migrated.includes(legacyEncrypt('legacy-password')), false);
    assert.equal(JSON.parse(migrated).history[1].password, 'not-legacy-ciphertext');

    undecryptable.clear();
    assertCredentialsRestored(config);
    assert.equal(config.getHistory()[0].password, 'legacy-password');
});

test('a failed migration write does not stop an undecryptable config from being read', (t) => {
    simulateLinux(t);
    const { loadConfig, configPath } = setupConfig(t, { storageBackend: 'basic_text' });
    const original = JSON.stringify({
        domain: 'https://nas.example',
        token: 'safe-storage:v1:not-decryptable',
        accessCode: 'legacy-access-code',
    });
    fs.writeFileSync(configPath, original);

    assert.equal(loadConfig().readConfig().domain, 'https://nas.example');
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
});

test('logging out while the token is undecryptable does not erase its ciphertext', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    undecryptable.add('saved-token');
    config.saveConfig({ account: 'user', domain: 'https://nas.example', token: '', useHttps: true });

    undecryptable.clear();
    assertCredentialsRestored(config);
});

test('logging in again replaces undecryptable credentials with the new values', (t) => {
    const { loadConfig, configPath, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    SAVED_CREDENTIALS.forEach((value) => undecryptable.add(value));
    config.saveConfig({
        account: 'user',
        domain: 'https://nas.example',
        token: 'new-token',
        accessCode: 'new-access-code',
        useHttps: true,
    });
    config.addHistory({
        domain: 'nas.example',
        account: 'user',
        password: 'new-password',
        accessCode: 'new-history-access-code',
        useHttps: true,
    });

    assert.equal(config.readConfig().token, 'new-token');
    assert.equal(config.readConfig().accessCode, 'new-access-code');
    assert.equal(config.getHistory().length, 1);
    assert.equal(config.getHistory()[0].password, 'new-password');
    assert.equal(config.getHistory()[0].accessCode, 'new-history-access-code');
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(Buffer.from(stored.token.replace('safe-storage:v1:', ''), 'base64').toString(), 'protected:new-token');
});

test('logging in without an access code clears the undecryptable one so startup can restore the session', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);

    undecryptable.add('saved-access-code');
    config.saveConfig({
        account: 'user',
        domain: 'https://nas.example',
        token: 'new-token',
        accessCode: '',
        useHttps: true,
    });

    assert.equal(config.readConfig().token, 'new-token');
    assert.equal(config.readConfig().accessCode, '');
});

test('deleting history removes undecryptable entries on request', (t) => {
    const { loadConfig, configPath, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);
    config.addHistory({ domain: 'other.example', account: 'other', password: 'other-password' });

    undecryptable.add('saved-password');
    assert.equal(config.deleteHistoryItem({ domain: 'nas.example', account: 'user' }), true);
    assert.deepEqual(config.getHistory().map((item) => item.domain), ['other.example']);

    undecryptable.add('other-password');
    config.clearHistory();
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).history, []);
});

test('startup getters keep working when every credential is undecryptable', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);
    config.setMpvPlayerPath('/usr/bin/mpv');

    SAVED_CREDENTIALS.forEach((value) => undecryptable.add(value));

    assert.equal(config.getMpvPlayerPath(), '/usr/bin/mpv');
    assert.equal(config.getDownloadProxyConfig().enabled, true);
    assert.equal(config.getHideOriginalPlayButton(), true);
    assert.equal(config.getNasProxyEnabled(), false);
});

for (const failing of ['saved-token', 'saved-access-code']) {
    test(`startup goes to the login page without a dialog when ${failing} is undecryptable`, async (t) => {
        const { loadConfig, loadWinctrl, dialogs, undecryptable } = setupConfig(t);
        seedLoggedInConfig(loadConfig());
        undecryptable.add(failing);

        const window = fakeMainWindow();
        await loadWinctrl().setupCookieRestore(window);

        assertLandedOnLoginPage(window);
        assert.deepEqual(dialogs, []);
    });
}

test('startup does not blame the keyring when the config file itself cannot be read', async (t) => {
    const { loadWinctrl, configPath, dialogs } = setupConfig(t);
    fs.mkdirSync(configPath);

    const window = fakeMainWindow();
    await loadWinctrl().setupCookieRestore(window);

    assertLandedOnLoginPage(window);
    assert.equal(dialogs.length, 1);
    assert.doesNotMatch(JSON.stringify(dialogs[0]), /密钥环|安全存储/);
});
