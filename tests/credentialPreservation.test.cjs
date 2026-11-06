const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    SAVED_CREDENTIALS,
    assertCredentialsRestored,
    seedLoggedInConfig,
    setupConfig,
} = require('./helpers/credentialConfig.cjs');

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
