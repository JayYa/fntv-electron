const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loginPageScriptText } = require('./helpers/loginPage.cjs');

test('login settings default to MPV playback', () => {
    const loginPage = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'index.html'),
        'utf8',
    );
    const loginScript = loginPageScriptText();

    assert.match(loginPage, /id="mpvPlaybackSwitch" checked/);
    assert.match(loginScript, /data\.mpvPlayback !== false/);
});
