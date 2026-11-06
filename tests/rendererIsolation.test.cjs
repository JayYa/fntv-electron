const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loginPageScriptText } = require('./helpers/loginPage.cjs');

test('main window disables renderer Node access and enables context isolation', () => {
    const mainWindow = fs.readFileSync(
        path.join(__dirname, '..', 'dest', 'main', 'common', 'mainwin.js'),
        'utf8',
    );
    assert.match(mainWindow, /nodeIntegration:\s*false/);
    assert.match(mainWindow, /contextIsolation:\s*true/);
});

test('login page uses the restricted preload bridge and renders history as text', () => {
    const loginPage = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'index.html'),
        'utf8',
    );
    const loginScript = loginPageScriptText();
    for (const source of [loginPage, loginScript]) {
        assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
        assert.doesNotMatch(source, /data-password="\$\{/);
    }
    assert.match(loginScript, /window\.electronAPI/);
    assert.match(loginScript, /account\.textContent = item\.account/);
});

test('login page runs only its external script and the CSP forbids inline scripts', () => {
    const loginPage = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'index.html'),
        'utf8',
    );
    const scriptTags = loginPage.match(/<script\b[^>]*>/gi);
    const csp = loginPage.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    const scriptSrc = csp.split(';').map((directive) => directive.trim())
        .find((directive) => directive.startsWith('script-src '));

    assert.deepEqual(scriptTags, [
        '<script src="./dom.js">',
        '<script src="./dialogs.js">',
        '<script src="./form.js">',
        '<script src="./history.js">',
        '<script src="./pageEvents.js">',
        '<script src="./settings.js">',
        '<script src="./index.js">',
    ]);
    assert.doesNotMatch(loginPage, /<[a-z][^>]*\son[a-z]+\s*=/i);
    assert.equal(scriptSrc, "script-src 'self'");
});
