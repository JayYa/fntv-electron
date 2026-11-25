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

test('startup getters keep working when every credential is undecryptable', async (t) => {
    const { loadStores, undecryptable } = setupConfig(t);
    const config = loadStores();
    await seedLoggedInConfig(config);
    config.set('userMpvPath', '/usr/bin/mpv');

    SAVED_CREDENTIALS.forEach((value) => undecryptable.add(value));

    assert.equal(config.get('userMpvPath'), '/usr/bin/mpv');
    assert.equal(config.get('appDownloadProxy').enabled, false);
    assert.equal(config.get('mpvPlayback'), true);
    assert.equal(config.get('nasLocalProxy'), false);
});

for (const failing of ['saved-token', 'saved-access-code']) {
    test(`startup goes to the login page without a dialog when ${failing} is undecryptable`, async (t) => {
        const { loadStores, loadCurrentLogin, dialogs, undecryptable } = setupConfig(t);
        await seedLoggedInConfig(loadStores());
        undecryptable.add(failing);

        const window = fakeMainWindow();
        await loadCurrentLogin().restoreAtStartup(window);

        assertLandedOnLoginPage(window);
        assert.deepEqual(dialogs, []);
    });
}

test('startup does not blame the keyring when the config file itself cannot be read', async (t) => {
    const { loadCurrentLogin, configPath, dialogs } = setupConfig(t);
    fs.mkdirSync(configPath);

    const window = fakeMainWindow();
    await loadCurrentLogin().restoreAtStartup(window);

    assertLandedOnLoginPage(window);
    assert.equal(dialogs.length, 1);
    assert.doesNotMatch(JSON.stringify(dialogs[0]), /密钥环|安全存储/);
});
