const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    logInWithHistory,
    legacyEncrypt,
    readHistoryWithCredentials,
    seedLoggedInConfig,
    setupConfig,
} = require('./helpers/credentialConfig.cjs');

const SECURE_STORAGE_ERROR = /安全存储|密钥环/;

const WRITES = {
    'saving a new login': (config) => config.saveNewLogin(
        { account: 'new', domain: 'https://new.example', token: 'new-token', accessCode: 'new-code', useHttps: true },
        { domain: 'new.example', account: 'new', password: 'new-password', accessCode: 'new-code', useHttps: true },
    ),
    'clearing the token': (config) => config.clearToken(),
    'removing a history entry': (config) => config.removeHistory({ domain: 'other.example', account: 'other' }),
    'clearing the history': (config) => config.clearHistory(),
};

const STATES = [false, true].flatMap((undecryptable) => [false, true].flatMap((legacy) => [true, false].map(
    (encryptionAvailable) => ({ undecryptable, legacy, encryptionAvailable }),
)));

const describe = ({ undecryptable, legacy, encryptionAvailable }) => [
    undecryptable && 'an undecryptable entry',
    legacy && 'a legacy entry',
    !encryptionAvailable && 'no secure storage',
].filter(Boolean).join(', ') || 'only readable credentials';

for (const state of STATES) {
    for (const [name, write] of Object.entries(WRITES)) {
        test(`${name} with ${describe(state)} either succeeds or fails on secure storage, keeping what it cannot decrypt`, async (t) => {
            const { loadStores, configPath, undecryptable, setEncryptionAvailable } = setupConfig(t);
            const config = loadStores();
            await seedLoggedInConfig(config);
            await logInWithHistory(config, { domain: 'other.example', account: 'other', password: 'other-password' });
            await config.saveCurrentLogin({ account: 'user', domain: 'https://nas.example', token: 'saved-token', accessCode: 'saved-access-code', useHttps: true });
            if (state.legacy) {
                const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                stored.history.push({ domain: 'old.example', account: 'old', password: legacyEncrypt('old-password') });
                fs.writeFileSync(configPath, JSON.stringify(stored));
            }
            if (state.undecryptable) {
                undecryptable.add('saved-password');
                undecryptable.add('saved-token');
            }
            setEncryptionAvailable(state.encryptionAvailable);
            const before = fs.readFileSync(configPath, 'utf8');
            const keptCiphertext = JSON.parse(before).history.find((item) => item.domain === 'nas.example').password;
            const tokenCiphertext = JSON.parse(before).token;

            const outcome = await write(config).then(() => 'ok', (error) => error);

            const after = fs.readFileSync(configPath, 'utf8');
            if (outcome !== 'ok') {
                assert.match(outcome.message, SECURE_STORAGE_ERROR);
                assert.equal(after, before);
                return;
            }
            if (name !== 'clearing the history') {
                assert.equal(JSON.parse(after).history.find((item) => item.domain === 'nas.example').password, keptCiphertext);
            }
            if (state.undecryptable && name !== 'saving a new login') {
                assert.equal(JSON.parse(after).token, tokenCiphertext);
            }
        });
    }
}

test('a first login writes the config keys in the order earlier versions wrote them', async (t) => {
    const { loadStores, configPath } = setupConfig(t);
    const config = loadStores();

    await seedLoggedInConfig(config);

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(Object.keys(stored), ['account', 'domain', 'token', 'accessCode', 'useHttps', 'history', 'mpvVolume']);
    assert.deepEqual(Object.keys(stored.history[0]), ['domain', 'account', 'password', 'accessCode', 'useHttps']);
});

test('saving a current login without a token is refused so undecryptable credentials are not dropped', async (t) => {
    const { loadStores, configPath } = setupConfig(t);
    const config = loadStores();
    await seedLoggedInConfig(config);
    const before = fs.readFileSync(configPath, 'utf8');

    await assert.rejects(
        config.saveCurrentLogin({ account: 'user', domain: 'https://nas.example', token: '', accessCode: '', useHttps: true }),
        /clearToken/,
    );
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('a new login that cannot be saved does not reach the history either', async (t) => {
    const { loadStores, setEncryptionAvailable } = setupConfig(t);
    const config = loadStores();
    await seedLoggedInConfig(config);

    setEncryptionAvailable(false);
    await assert.rejects(logInWithHistory(config, { domain: 'new.example', account: 'new', password: 'new-password' }), SECURE_STORAGE_ERROR);

    setEncryptionAvailable(true);
    assert.deepEqual(config.listHistory().map((item) => item.account), ['user']);
    assert.equal((await config.readCurrentLogin()).token, 'saved-token');
});

test('logging out while the access code is undecryptable still clears the readable token', async (t) => {
    const { loadStores, undecryptable } = setupConfig(t);
    const config = loadStores();
    await seedLoggedInConfig(config);

    undecryptable.add('saved-access-code');
    assert.equal(await config.clearToken(), true);

    undecryptable.clear();
    const loaded = await config.readCurrentLogin();
    assert.equal(loaded.token, '');
    assert.equal(loaded.accessCode, 'saved-access-code');
});

test('listing, removing and clearing the history do not touch the secure storage', async (t) => {
    const { loadStores, encryptCount, decryptCount } = setupConfig(t);
    const config = loadStores();
    await seedLoggedInConfig(config);
    await logInWithHistory(config, { domain: 'other.example', account: 'other', password: 'other-password', useHttps: true });
    const calls = () => encryptCount() + decryptCount();
    const before = calls();

    assert.deepEqual(config.listHistory(), [
        { domain: 'other.example', account: 'other', useHttps: true },
        { domain: 'nas.example', account: 'user', useHttps: true },
    ]);
    assert.equal(await config.removeHistory({ domain: 'other.example', account: 'other' }), true);
    assert.equal(calls(), before);
    assert.deepEqual((await readHistoryWithCredentials(config)).map((item) => item.password), ['saved-password']);

    const beforeClear = calls();
    await config.clearHistory();
    assert.equal(calls(), beforeClear);
    assert.deepEqual(config.listHistory(), []);
    assert.equal((await config.readCurrentLogin()).token, 'other-token');
});
