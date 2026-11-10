const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    SAVED_CREDENTIALS,
    assertCredentialsRestored,
    legacyEncrypt,
    seedLoggedInConfig,
    setupConfig,
    simulateLinux,
    syncFormatCiphertext,
} = require('./helpers/credentialConfig.cjs');

test('credentials saved by the synchronous safeStorage API are read back through the async API', async (t) => {
    const { loadConfig, configPath } = setupConfig(t);
    const original = JSON.stringify({
        account: 'user',
        domain: 'https://nas.example',
        token: syncFormatCiphertext('saved-token'),
        accessCode: syncFormatCiphertext('saved-access-code'),
        history: [{
            domain: 'nas.example',
            account: 'user',
            password: syncFormatCiphertext('saved-password'),
            accessCode: syncFormatCiphertext('saved-history-access-code'),
        }],
    });
    fs.writeFileSync(configPath, original);

    const config = loadConfig();
    const loaded = await config.readConfig();
    assert.equal(loaded.token, 'saved-token');
    assert.equal(loaded.accessCode, 'saved-access-code');
    assert.deepEqual(await config.getHistoryCredentials({ domain: 'nas.example', account: 'user' }), {
        password: 'saved-password',
        accessCode: 'saved-history-access-code',
    });
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
});

test('migrates legacy credentials to OS-protected storage without changing returned values', async (t) => {
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
    assert.equal((await config.readConfig()).token, 'legacy-token');
    assert.equal((await config.readConfig()).accessCode, 'legacy-access-code');
    assert.equal((await config.getHistory())[0].password, 'legacy-password');
    assert.equal((await config.getHistory())[0].accessCode, 'legacy-history-access-code');

    const stored = fs.readFileSync(configPath, 'utf8');
    assert.doesNotMatch(stored, /legacy-token|legacy-password|legacy-access-code|legacy-history-access-code/);
    assert.match(stored, /safe-storage:v1:/);
});

test('re-encrypts a credential when safeStorage asks for it after a key change', async (t) => {
    const { loadConfig, reEncrypt, encryptCount } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);

    const beforeRead = encryptCount();
    assert.equal((await config.readConfig()).token, 'saved-token');
    assert.equal(encryptCount(), beforeRead, '密钥没变时读取不应重新加密');

    reEncrypt.add('saved-token');
    assert.equal((await config.readConfig()).token, 'saved-token');
    assert.ok(encryptCount() > beforeRead, '密钥轮换后应重新加密');
});

test('saving the same credentials again is still refused once the secure storage becomes unavailable', async (t) => {
    const { loadConfig, configPath, setEncryptionAvailable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);
    const before = fs.readFileSync(configPath, 'utf8');

    setEncryptionAvailable(false);
    await assert.rejects(
        config.saveConfig({ account: 'user', domain: 'https://nas.example', token: 'saved-token', accessCode: 'saved-access-code', useHttps: true }),
        /操作系统安全存储不可用，无法保存登录凭据/,
    );
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('a legacy value equal to a protected one is still migrated', async (t) => {
    const { loadConfig, configPath } = setupConfig(t);
    fs.writeFileSync(configPath, JSON.stringify({
        token: syncFormatCiphertext('same-code'),
        accessCode: 'same-code',
    }));

    assert.equal((await loadConfig().readConfig()).accessCode, 'same-code');
    assert.doesNotMatch(fs.readFileSync(configPath, 'utf8'), /"accessCode": "same-code"/);
});

test('refuses to save credentials when the OS secure storage is unavailable', async (t) => {
    const { loadConfig, configPath } = setupConfig(t, { encryptionAvailable: false });

    await assert.rejects(
        loadConfig().saveConfig({ account: 'user', domain: 'https://nas.example', token: 'plain-token' }),
        /操作系统安全存储不可用，无法保存登录凭据/,
    );
    assert.equal(fs.existsSync(configPath), false);
});

test('Linux refuses to save credentials when safeStorage falls back to basic_text', async (t) => {
    simulateLinux(t);
    const { loadConfig, configPath } = setupConfig(t, { storageBackend: 'basic_text' });

    await assert.rejects(
        loadConfig().saveConfig({ account: 'user', domain: 'https://nas.example', token: 'plain-token' }),
        /拒绝以明文方式保存登录凭据/,
    );
    assert.equal(fs.existsSync(configPath), false);
});

test('Linux saves credentials encrypted when safeStorage uses a real keyring', async (t) => {
    simulateLinux(t);
    const { loadConfig, configPath } = setupConfig(t);

    await loadConfig().saveConfig({ account: 'user', domain: 'https://nas.example', token: 'plain-token' });

    const stored = fs.readFileSync(configPath, 'utf8');
    assert.doesNotMatch(stored, /plain-token/);
    assert.match(stored, /safe-storage:v1:/);
});

test('changing a setting leaves stored credentials byte-for-byte unchanged, even undecryptable ones', async (t) => {
    const { loadConfig, configPath, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);
    const before = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    SAVED_CREDENTIALS.forEach((value) => undecryptable.add(value));

    config.setMpvVolume(80);
    config.setExitMode('minimize');

    const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(after, { ...before, mpvVolume: 80, exitMode: 'minimize' });
    assert.equal(config.getMpvVolume(), 80);
});

test('a setting written while a login save is encrypting survives the save', async (t) => {
    const { loadConfig, configPath, holdEncryption } = setupConfig(t);
    const config = loadConfig();
    const release = holdEncryption();

    const saving = config.saveConfig({ account: 'user', domain: 'https://nas.example', token: 'new-token', accessCode: 'new-code' });
    await new Promise((resolve) => setImmediate(resolve));
    config.setMpvVolume(33);
    release();
    await saving;

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(stored.mpvVolume, 33);
    assert.equal((await config.readConfig()).token, 'new-token');
});

test('the legacy migration write keeps ciphertext it cannot decrypt', async (t) => {
    const { loadConfig, configPath, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);
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
    assert.equal((await config.getHistory())[0].password, 'legacy-password');

    const migrated = fs.readFileSync(configPath, 'utf8');
    assert.equal(migrated.includes(legacyEncrypt('legacy-password')), false);
    assert.equal(JSON.parse(migrated).history[1].password, 'not-legacy-ciphertext');

    undecryptable.clear();
    await assertCredentialsRestored(config);
    assert.equal((await config.getHistory())[0].password, 'legacy-password');
});

test('a failed migration write does not stop an undecryptable config from being read', async (t) => {
    simulateLinux(t);
    const { loadConfig, configPath, logPath } = setupConfig(t, { storageBackend: 'basic_text' });
    const original = JSON.stringify({
        domain: 'https://nas.example',
        token: 'safe-storage:v1:not-decryptable',
        accessCode: 'legacy-access-code',
    });
    fs.writeFileSync(configPath, original);

    assert.equal((await loadConfig().readConfig()).domain, 'https://nas.example');
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    assert.match(fs.readFileSync(logPath, 'utf8'), /迁移旧版凭据失败/);
});
