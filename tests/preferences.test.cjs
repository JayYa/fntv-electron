const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

function setup(t, { storedConfig, platform = 'win32' } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-preferences-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    useFakeElectron(t, {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        safeStorage: {},
    }, { platform });
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    fs.mkdirSync(paths.userData, { recursive: true });
    const configPath = path.join(paths.userData, 'config.json');
    if (storedConfig !== undefined) fs.writeFileSync(configPath, JSON.stringify(storedConfig));
    const preferences = require('../dest/modules/fn_config/preferences.js');
    const changes = [];
    preferences.onChange((name) => changes.push(name));
    return {
        preferences,
        changes,
        stored: () => JSON.parse(fs.readFileSync(configPath, 'utf8')),
    };
}

test('changing a preference tells subscribers which one changed', (t) => {
    const { preferences, changes } = setup(t);

    preferences.set('nasLocalProxy', true);

    assert.equal(preferences.get('nasLocalProxy'), true);
    assert.deepEqual(changes, ['nasLocalProxy']);
});

test('saving a preference with the value it already has tells no one', (t) => {
    const { preferences, changes } = setup(t, {
        storedConfig: { downloadProxyEnabled: true, downloadProxy: 'https://relay.example.test/', hideOriginalPlayButton: false },
    });

    preferences.set('appDownloadProxy', { enabled: true, proxyUrl: 'https://relay.example.test/' });
    preferences.set('mpvPlayback', false);

    assert.deepEqual(changes, []);
});

for (const [stored, expected] of [[undefined, true], [true, true], [false, false], [null, false], ['true', false], [1, false]]) {
    test(`a stored MPV playback value ${JSON.stringify(stored)} reads as ${expected ? 'on' : 'off'}`, (t) => {
        const { preferences } = setup(t, { storedConfig: stored === undefined ? {} : { hideOriginalPlayButton: stored } });

        assert.equal(preferences.get('mpvPlayback'), expected);
    });
}

test('the MPV playback preference keeps its historical key in the config file', (t) => {
    const { preferences, stored } = setup(t);

    preferences.set('mpvPlayback', false);

    assert.equal(stored().hideOriginalPlayButton, false);
});

for (const [platform, key, values] of [
    ['win32', 'exitMode', { hide: 'minimize', quit: 'direct', ask: 'ask' }],
    ['darwin', 'macCloseAction', { hide: 'minimize', quit: 'quit', ask: 'ask' }],
]) {
    test(`on ${platform} the close behavior is stored as ${key} with the values existing configs use`, (t) => {
        const { preferences, stored } = setup(t, { platform });

        for (const [behavior, storedValue] of Object.entries(values)) {
            preferences.set('closeBehavior', behavior);
            assert.equal(stored()[key], storedValue);
            assert.equal(preferences.get('closeBehavior'), behavior);
        }
    });
}

test('an unknown stored close behavior reads as asking', (t) => {
    const { preferences } = setup(t, { platform: 'darwin', storedConfig: { macCloseAction: 'bogus', exitMode: 'direct' } });

    assert.equal(preferences.get('closeBehavior'), 'ask');
});

test('clearing the user-chosen MPV removes it from the config file', (t) => {
    const { preferences, changes, stored } = setup(t, { storedConfig: { mpvPlayerPath: 'E:\tools\mpv\mpv.exe' } });

    preferences.set('userMpvPath', undefined);

    assert.equal(preferences.get('userMpvPath'), undefined);
    assert.equal('mpvPlayerPath' in stored(), false);
    assert.deepEqual(changes, ['userMpvPath']);
});

test('a subscriber that throws neither fails the save nor keeps later subscribers from hearing it', (t) => {
    const { preferences, changes } = setup(t);
    const later = [];
    preferences.onChange(() => { throw new Error('reload failed'); });
    preferences.onChange((name) => later.push(name));

    assert.doesNotThrow(() => preferences.set('nasLocalProxy', true));

    assert.equal(preferences.get('nasLocalProxy'), true);
    assert.deepEqual(changes, ['nasLocalProxy']);
    assert.deepEqual(later, ['nasLocalProxy']);
});
