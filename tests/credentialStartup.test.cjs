const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    SAVED_CREDENTIALS,
    assertLandedOnLoginPage,
    fakeMainWindow,
    seedLoggedInConfig,
    setupConfig,
} = require('./helpers/credentialConfig.cjs');

test('startup getters keep working when every credential is undecryptable', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    seedLoggedInConfig(config);
    config.setMpvPlayerPath('/usr/bin/mpv');

    SAVED_CREDENTIALS.forEach((value) => undecryptable.add(value));

    assert.equal(config.getMpvPlayerPath(), '/usr/bin/mpv');
    assert.equal(config.getDownloadProxyConfig().enabled, false);
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
