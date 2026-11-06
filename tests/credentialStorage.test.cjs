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
} = require('./helpers/credentialConfig.cjs');

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
