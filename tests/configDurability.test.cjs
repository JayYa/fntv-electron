const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function setupConfig(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-config-durability-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
        },
        safeStorage: {
            isEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            encryptString(value) { return Buffer.from(`protected:${value}`, 'utf8'); },
            decryptString(value) { return value.toString('utf8').slice('protected:'.length); },
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
    const userData = paths.userData;
    return {
        config: require('../dest/modules/fn_config/config.js'),
        configPath: path.join(userData, 'config.json'),
        userData,
        backups: () => fs.readdirSync(userData).filter((name) => name.startsWith('config.json.corrupt-')).sort(),
        readBackup: (name) => fs.readFileSync(path.join(userData, name), 'utf8'),
        logText: () => {
            const logPath = path.join(testRoot, 'log', 'app.log');
            return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
        },
    };
}

const CORRUPT = '{"account":"user","token":"safe-storage:v1:c2VjcmV0","mpvVolume":33,';

test('a setter after a corrupt config keeps the damaged content in a backup', (t) => {
    const { config, configPath, backups, readBackup } = setupConfig(t);
    fs.writeFileSync(configPath, CORRUPT);

    assert.equal(config.readConfig(), null);
    config.setNasProxyEnabled(true);

    assert.equal(backups().length, 1);
    assert.equal(readBackup(backups()[0]), CORRUPT);
    assert.equal(config.getNasProxyEnabled(), true);
});

test('the backup limit drops the oldest damaged copies', (t) => {
    const { config, configPath, backups, readBackup } = setupConfig(t);

    for (const round of [1, 2, 3, 4, 5]) {
        fs.writeFileSync(configPath, `{"round":${round},`);
        config.setNasProxyEnabled(true);
    }

    assert.deepEqual(backups().map(readBackup), ['{"round":3,', '{"round":4,', '{"round":5,']);
});

test('a failed backup leaves the damaged config untouched', (t) => {
    const { config, configPath, backups } = setupConfig(t);
    fs.writeFileSync(configPath, CORRUPT);
    t.mock.method(fs, 'copyFileSync', () => { throw new Error('disk full'); });

    assert.throws(() => config.setNasProxyEnabled(true), /disk full/);

    assert.equal(fs.readFileSync(configPath, 'utf8'), CORRUPT);
    assert.deepEqual(backups(), []);
});

test('a write interrupted before the swap keeps the previous config', (t) => {
    const { config, configPath, userData } = setupConfig(t);
    config.setMpvVolume(33);
    const before = fs.readFileSync(configPath, 'utf8');
    t.mock.method(fs, 'renameSync', () => { throw new Error('rename failed'); });

    assert.throws(() => config.setMpvVolume(80), /rename failed/);

    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(userData), ['config.json']);
});

test('a failed write does not spend a backup slot on the same damaged file', (t) => {
    const { config, configPath, backups } = setupConfig(t);
    fs.writeFileSync(configPath, CORRUPT);
    t.mock.method(fs, 'fsyncSync', () => { throw new Error('disk full'); });

    assert.throws(() => config.setNasProxyEnabled(true), /disk full/);

    assert.deepEqual(backups(), []);
    assert.equal(fs.readFileSync(configPath, 'utf8'), CORRUPT);
});

test('healthy writes keep the file format and leave no extra files', (t) => {
    const { config, configPath, userData } = setupConfig(t);

    config.setMpvVolume(33);
    config.setMpvVolume(44);

    assert.equal(fs.readFileSync(configPath, 'utf8'), JSON.stringify({ mpvVolume: 44, token: '', accessCode: '' }, null, 2));
    assert.deepEqual(fs.readdirSync(userData), ['config.json']);
});

// Windows 没有 POSIX 权限位，chmod 只能切换只读，statSync 的 mode 不反映 0o600。
test('rewriting the config keeps its file permissions', { skip: process.platform === 'win32' }, (t) => {
    const { config, configPath } = setupConfig(t);
    config.setMpvVolume(33);
    fs.chmodSync(configPath, 0o600);

    config.setMpvVolume(44);

    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
});

test('the backup is logged by file name without its content', (t) => {
    const { config, configPath, backups, logText } = setupConfig(t);
    fs.writeFileSync(configPath, CORRUPT);

    config.setNasProxyEnabled(true);

    assert.match(logText(), new RegExp(backups()[0]));
    assert.doesNotMatch(logText(), /c2VjcmV0/);
});

for (const [label, history] of [
    ['an object', { domain: 'nas.example' }],
    ['a string', 'safe-storage:v1:c2VjcmV0'],
    ['a number', 5],
]) {
    test(`a history that is ${label} reads as an empty list`, (t) => {
        const { config, configPath } = setupConfig(t);
        const original = JSON.stringify({ domain: 'https://nas.example', history });
        fs.writeFileSync(configPath, original);

        assert.deepEqual(config.readConfig().history, []);
        assert.deepEqual(config.getHistory(), []);
        assert.equal(config.readConfig().domain, 'https://nas.example');
        assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    });
}

test('writing over a non-array history keeps the original file in a backup', (t) => {
    const { config, configPath, backups, readBackup, logText } = setupConfig(t);
    const original = JSON.stringify({ mpvVolume: 33, history: { password: 'c2VjcmV0' } });
    fs.writeFileSync(configPath, original);

    config.addHistory({ domain: 'nas.example', account: 'user', password: 'new-password' });

    assert.equal(backups().length, 1);
    assert.equal(readBackup(backups()[0]), original);
    assert.equal(config.getHistory()[0].account, 'user');
    assert.equal(config.getMpvVolume(), 33);
    assert.doesNotMatch(logText(), /c2VjcmV0/);

    config.setMpvVolume(44);
    assert.equal(backups().length, 1);
});

for (const [label, content] of [
    ['null', 'null'],
    ['an array', '[{"account":"user"}]'],
    ['a number', '5'],
    ['a string', '"safe-storage:v1:c2VjcmV0"'],
]) {
    test(`a config that is ${label} reads as missing and stays on disk`, (t) => {
        const { config, configPath, backups } = setupConfig(t);
        fs.writeFileSync(configPath, content);

        assert.equal(config.readConfig(), null);
        assert.deepEqual(config.getHistory(), []);
        assert.equal(fs.readFileSync(configPath, 'utf8'), content);
        assert.deepEqual(backups(), []);
    });

    test(`a setter after a config that is ${label} keeps it in a backup`, (t) => {
        const { config, configPath, backups, readBackup } = setupConfig(t);
        fs.writeFileSync(configPath, content);

        config.setNasProxyEnabled(true);

        assert.equal(backups().length, 1);
        assert.equal(readBackup(backups()[0]), content);
        assert.equal(config.getNasProxyEnabled(), true);
    });
}

const SAVED_ENTRY = {
    domain: 'nas.example',
    account: 'user',
    password: `safe-storage:v1:${Buffer.from('protected:saved-password').toString('base64')}`,
};

for (const [label, entry] of [
    ['null', null],
    ['a string', 'x'],
    ['a number', 5],
    ['an array', ['nas.example', 'user']],
    ['an object without an account', { domain: 'nas.example' }],
    ['an object without a domain', { account: 'user' }],
    ['an object with a non-string domain', { domain: 5, account: 'user' }],
    ['an object with a non-string account', { domain: 'nas.example', account: null }],
]) {
    test(`a history entry that is ${label} is left out on read and stays on disk`, (t) => {
        const { config, configPath, backups } = setupConfig(t);
        const original = JSON.stringify({ mpvVolume: 33, history: [entry, SAVED_ENTRY] });
        fs.writeFileSync(configPath, original);

        assert.equal(config.readConfig().history.length, 1);
        assert.deepEqual(config.getHistory(), [{
            domain: 'nas.example',
            account: 'user',
            password: 'saved-password',
            accessCode: '',
            useHttps: false,
        }]);
        assert.equal(fs.readFileSync(configPath, 'utf8'), original);
        assert.deepEqual(backups(), []);
    });
}

test('writing over a history with unusable entries keeps the original file in a backup', (t) => {
    const { config, configPath, backups, readBackup, logText } = setupConfig(t);
    const original = JSON.stringify({ mpvVolume: 33, history: [null, 'c2VjcmV0', SAVED_ENTRY] });
    fs.writeFileSync(configPath, original);

    config.setMpvVolume(44);

    assert.equal(backups().length, 1);
    assert.equal(readBackup(backups()[0]), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).history.map((item) => item.account), ['user']);
    assert.doesNotMatch(logText(), /c2VjcmV0/);

    config.setMpvVolume(55);
    assert.equal(backups().length, 1);
});

test('migrating legacy credentials on read keeps the unusable history entries in a backup', (t) => {
    const { config, configPath, backups, readBackup } = setupConfig(t);
    const original = JSON.stringify({ token: 'legacy-token', history: [null, SAVED_ENTRY] });
    fs.writeFileSync(configPath, original);

    assert.equal(config.readConfig().token, 'legacy-token');

    assert.equal(backups().length, 1);
    assert.equal(readBackup(backups()[0]), original);
});

test('a retained credential survives the rewrite that drops an unusable entry', (t) => {
    const { config, configPath } = setupConfig(t);
    const undecryptable = { domain: 'nas.example', account: 'user', password: 'not-legacy-ciphertext' };
    fs.writeFileSync(configPath, JSON.stringify({ history: [null, undecryptable] }));

    config.setMpvVolume(44);

    const { history } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(history.length, 1);
    assert.equal(history[0].password, 'not-legacy-ciphertext');
});

test('a config without history still has no history after a write', (t) => {
    const { config, configPath } = setupConfig(t);
    fs.writeFileSync(configPath, JSON.stringify({ history: null, mpvVolume: 33 }));

    config.setMpvVolume(44);

    assert.equal('history' in JSON.parse(fs.readFileSync(configPath, 'utf8')), false);
});
