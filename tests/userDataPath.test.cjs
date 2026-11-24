const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

const CONSTANTS = path.resolve(__dirname, '../dest/public/constants.js');

function userDataPathWith(t, userDataDir) {
    const home = path.join(os.tmpdir(), 'fntv-home');
    const electron = {
        app: {
            getPath: name => (name === 'home' ? home : os.tmpdir()),
            commandLine: { getSwitchValue: name => (name === 'user-data-dir' ? userDataDir : '') },
        },
    };
    useFakeElectron(t, electron);
    return { home, value: require(CONSTANTS).USER_DATA_PATH };
}

test('without --user-data-dir the user data stays in ~/.fntv', t => {
    const { home, value } = userDataPathWith(t, '');
    assert.equal(value, path.join(home, '.fntv'));
});

test('an absolute --user-data-dir is used as the user data directory', t => {
    const dir = path.join(os.tmpdir(), 'fntv-smoke-home', '.fntv');
    assert.equal(userDataPathWith(t, dir).value, dir);
});

test('a relative --user-data-dir is resolved against the working directory like Chromium does', t => {
    assert.equal(userDataPathWith(t, path.join('portable', 'data')).value, path.resolve('portable', 'data'));
});
