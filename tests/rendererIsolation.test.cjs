const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
    const loginScript = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'index.js'),
        'utf8',
    );
    for (const source of [loginPage, loginScript]) {
        assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
        assert.doesNotMatch(source, /data-password="\$\{/);
    }
    assert.match(loginScript, /window\.electronAPI/);
    assert.match(loginScript, /account\.textContent = item\.account/);
});
