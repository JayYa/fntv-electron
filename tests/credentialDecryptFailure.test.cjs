const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    seedLoggedInConfig,
    setupConfig,
} = require('./helpers/credentialConfig.cjs');

test('an undecryptable token reads as logged out while other settings stay readable', async (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);

    undecryptable.add('saved-token');

    const loaded = (await config.readConfig());
    assert.equal(loaded.token, '');
    assert.equal(loaded.domain, 'https://nas.example');
    assert.equal(loaded.account, 'user');
    assert.equal(loaded.useHttps, true);
    assert.equal(config.getMpvVolume(), 42);
    assert.equal((await config.getHistory())[0].password, 'saved-password');
});

test('an undecryptable history password blanks only that credential', async (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);

    undecryptable.add('saved-password');

    assert.deepEqual((await config.getHistory()), [{
        domain: 'nas.example',
        account: 'user',
        password: '',
        accessCode: 'saved-history-access-code',
        useHttps: true,
    }]);
    assert.equal((await config.readConfig()).token, 'saved-token');
});

test('an undecryptable history access code blanks only that credential', async (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);

    undecryptable.add('saved-history-access-code');

    assert.equal((await config.getHistory())[0].accessCode, '');
    assert.equal((await config.getHistory())[0].password, 'saved-password');
});

test('an undecryptable access code alone reads as logged out so the gateway is not skipped', async (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);

    undecryptable.add('saved-access-code');

    const loaded = (await config.readConfig());
    assert.equal(loaded.accessCode, '');
    assert.equal(loaded.token, '');
    assert.equal(loaded.domain, 'https://nas.example');
});

test('a legacy history password that cannot be decrypted reads as empty', async (t) => {
    const { loadConfig, configPath } = setupConfig(t);
    fs.writeFileSync(configPath, JSON.stringify({
        domain: 'https://nas.example',
        history: [{ domain: 'nas.example', account: 'user', password: 'not-legacy-ciphertext' }],
    }));

    assert.equal((await loadConfig().getHistory())[0].password, '');
});

test('decryption failures are logged by field without ciphertext or plaintext', async (t) => {
    const { loadConfig, configPath, logPath, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await seedLoggedInConfig(config);
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    ['saved-token', 'saved-access-code', 'saved-password', 'saved-history-access-code']
        .forEach((value) => undecryptable.add(value));
    (await config.readConfig());
    (await config.readConfig());

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
