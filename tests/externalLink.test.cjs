const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { resolveAllowedExternalUrl } = require('../dest/main/common/externalUrl.js');

const LOGIN_PAGE_URL = pathToFileURL(path.resolve(__dirname, '..', 'resource', 'login', 'index.html')).href;

function setupHandler(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-external-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const handlers = new Map();
    const opened = [];
    const electronMock = {
        ipcMain: {
            handle(channel, handler) { handlers.set(channel, handler); },
            on() {},
            removeAllListeners() {},
        },
        shell: {
            async openExternal(url) { opened.push(url); },
        },
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
        },
    };

    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return electronMock;
        return originalLoad.call(this, request, parent, isMain);
    };

    const clearCompiledModules = () => Object.keys(require.cache)
        .filter((id) => id.includes(`${path.sep}dest${path.sep}`))
        .forEach((id) => delete require.cache[id]);
    clearCompiledModules();

    t.after(() => {
        Module._load = originalLoad;
        clearCompiledModules();
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    require('../dest/main/handlers/plugins/externalLink.js').init();
    return { openExternal: handlers.get('open-external'), opened };
}

test('only https github.com addresses are allowed', () => {
    assert.equal(
        resolveAllowedExternalUrl('https://github.com/JayYa/fntv-electron'),
        'https://github.com/JayYa/fntv-electron',
    );

    for (const url of [
        'http://github.com/JayYa',
        'https://github.com.evil.example/JayYa',
        'https://evil.example/github.com',
        'https://gist.github.com/JayYa',
        'file:///C:/Windows/System32/calc.exe',
        'javascript:alert(1)',
        'not a url',
        '',
        undefined,
        null,
        42,
        { href: 'https://github.com/' },
    ]) {
        assert.equal(resolveAllowedExternalUrl(url), null, String(url));
    }
});

test('the login page can open a github link', async (t) => {
    const { openExternal, opened } = setupHandler(t);

    await openExternal({ senderFrame: { url: LOGIN_PAGE_URL } }, 'https://github.com/JayYa');

    assert.deepEqual(opened, ['https://github.com/JayYa']);
});

test('the login page cannot open an address outside github', async (t) => {
    const { openExternal, opened } = setupHandler(t);

    await assert.rejects(
        openExternal({ senderFrame: { url: LOGIN_PAGE_URL } }, 'https://evil.example/'),
        /GitHub/,
    );

    assert.deepEqual(opened, []);
});

test('frames other than the login page cannot open links', async (t) => {
    const { openExternal, opened } = setupHandler(t);

    for (const senderFrame of [
        { url: 'http://nas.example:5666/v' },
        { url: 'file:///C:/somewhere/else.html' },
        null,
    ]) {
        await assert.rejects(openExternal({ senderFrame }, 'https://github.com/JayYa'), /登录页/);
    }

    assert.deepEqual(opened, []);
});

test('refuses GitHub addresses with credentials or a custom port', () => {
    for (const url of [
        'https://user:pw@github.com/x',
        'https://user@github.com/x',
        'https://github.com:8443/x',
    ]) {
        assert.equal(resolveAllowedExternalUrl(url), null, url);
    }

    assert.equal(resolveAllowedExternalUrl('https://github.com:443/x'), 'https://github.com/x');
});
