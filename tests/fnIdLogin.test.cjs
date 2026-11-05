const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const PASSWORD = 'plain-password-value';
const ACCESS_CODE = 'plain-access-code';
const NAS = 'https://nas.example.com:5667';
const EVIL = 'https://nas.example.com.evil.com:5667';

function setupLogin(t, { accessCode = '' } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-fnid-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const netRequests = [];
    let oauthWindow = null;

    class FakeBrowserWindow extends EventEmitter {
        constructor() {
            super();
            oauthWindow = this;
            this.loaded = [];
            this.scripts = [];
            this.destroyed = false;
            const cookies = new EventEmitter();
            cookies.set = async () => {};
            cookies.get = async () => [{ value: 'cookie-token' }];
            const webContents = new EventEmitter();
            webContents.session = { cookies };
            webContents.mainFrame = { name: 'main' };
            webContents.currentUrl = '';
            webContents.getURL = () => webContents.currentUrl;
            webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
            webContents.executeJavaScript = async (script) => {
                this.scripts.push(script);
                return script.includes('#access-code-input');
            };
            this.webContents = webContents;
        }

        loadURL(url) {
            this.loaded.push(url);
            return Promise.resolve();
        }

        isDestroyed() { return this.destroyed; }

        close() {
            if (this.destroyed) return;
            this.destroyed = true;
            this.emit('closed');
        }
    }

    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
        },
        BrowserWindow: FakeBrowserWindow,
        dialog: {},
        net: {
            request(options) {
                netRequests.push(options);
                throw new Error('unexpected gateway request');
            },
        },
        session: {
            fromPartition() {
                return {
                    cookies: { get: async () => [], remove: async () => {}, set: async () => {} },
                    clearStorageData: async () => {},
                };
            },
        },
        safeStorage: {
            isEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            encryptString(value) { return Buffer.from(value, 'utf8'); },
            decryptString(value) { return value.toString('utf8'); },
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

    const { handleFnIdLogin } = require('../dest/main/handlers/plugins/fnid_login.js');
    const replies = [];
    const finished = handleFnIdLogin(
        { reply: (channel, payload) => replies.push({ channel, payload }) },
        { domain: 'demo123', username: 'alice', password: PASSWORD, accessCode },
    );

    t.after(async () => {
        oauthWindow?.close();
        await finished;
        Module._load = originalLoad;
        clearCompiledModules();
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    const flush = async () => {
        for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    };

    return {
        netRequests,
        async start() {
            await flush();
            return oauthWindow;
        },
        navigate(eventName, url, extra = {}) {
            let prevented = false;
            oauthWindow.webContents.emit(eventName, {
                url,
                isMainFrame: true,
                preventDefault() { prevented = true; },
                ...extra,
            });
            return !prevented;
        },
        async finishLoad(url) {
            oauthWindow.scripts.length = 0;
            oauthWindow.webContents.currentUrl = url;
            oauthWindow.webContents.emit('did-finish-load');
            await flush();
            return oauthWindow.scripts.join('\n');
        },
        async bridge(payload, frame = oauthWindow.webContents.mainFrame) {
            const message = `__FNTV_BRIDGE__:${JSON.stringify(payload)}`;
            oauthWindow.webContents.emit('console-message', { frame, message }, 1, message);
            await flush();
        },
        async tokenCookieChanged() {
            oauthWindow.webContents.session.cookies.emit(
                'changed', {}, { name: 'Trim-MC-token', value: 'cookie-token' }, 'explicit', false,
            );
            await flush();
        },
    };
}

const sysConfig = (url) => ({
    type: 'SysConfig',
    url: '/v/api/v1/sys/config',
    body: JSON.stringify({ data: { nas_oauth: { app_id: 'app1', url } } }),
});

test('injects the password only on the login page of the confirmed NAS', async (t) => {
    const login = setupLogin(t);
    await login.start();
    assert.equal(login.navigate('will-navigate', `${NAS}/v`), true);

    const fnConnectPage = await login.finishLoad('https://5ddd.com/demo123');
    const appPage = await login.finishLoad(`${NAS}/v`);
    const signinPage = await login.finishLoad(`${NAS}/signin?client_id=app1`);
    const loginPage = await login.finishLoad(`${NAS}/login?redirect=%2Fsignin`);

    assert.doesNotMatch(fnConnectPage, new RegExp(PASSWORD));
    assert.doesNotMatch(appPage, new RegExp(PASSWORD));
    assert.doesNotMatch(signinPage, new RegExp(PASSWORD));
    assert.match(appPage, /oauthapi\/authorize/);
    assert.match(signinPage, /oauthapi\/authorize/);
    assert.match(loginPage, new RegExp(PASSWORD));
    assert.match(loginPage, /oauthapi\/authorize/);
});

test('makes the password script check the page again before it reads the password', async (t) => {
    const login = setupLogin(t);
    await login.start();
    login.navigate('will-navigate', `${NAS}/login`);

    const loginPage = await login.finishLoad(`${NAS}/login`);

    const guard = loginPage.indexOf(`window.location.origin !== ${JSON.stringify(NAS)}`);
    assert.notEqual(guard, -1);
    assert.ok(guard < loginPage.indexOf(PASSWORD));
});

test('injects nothing into a page outside the confirmed NAS', async (t) => {
    const login = setupLogin(t, { accessCode: ACCESS_CODE });
    await login.start();
    login.navigate('will-navigate', `${NAS}/v`);

    for (const url of [`${EVIL}/login`, 'https://evil.com/x?next=/login', `http://nas.example.com:5667/login`]) {
        assert.equal(await login.finishLoad(url), '', url);
    }
});

test('fills the access code only on the confirmed NAS', async (t) => {
    const login = setupLogin(t, { accessCode: ACCESS_CODE });
    await login.start();

    assert.doesNotMatch(await login.finishLoad('https://evil.com/'), new RegExp(ACCESS_CODE));

    login.navigate('will-navigate', `${NAS}/`);
    const nasPage = await login.finishLoad(`${NAS}/`);

    assert.match(nasPage, new RegExp(ACCESS_CODE));
    const guard = nasPage.indexOf(`window.location.origin !== ${JSON.stringify(NAS)}`);
    assert.notEqual(guard, -1);
    assert.ok(guard < nasPage.indexOf(ACCESS_CODE));
});

test('blocks main-frame redirects off the confirmed NAS but not subframe probes', async (t) => {
    const login = setupLogin(t);
    await login.start();

    assert.equal(login.navigate('will-redirect', 'http://192.0.2.10/static/bridge.html', { isMainFrame: false }), true);
    assert.equal(login.navigate('will-navigate', `${NAS}/v`), true);
    assert.equal(login.navigate('will-redirect', `${NAS}/login`), true);

    assert.equal(login.navigate('will-redirect', `${EVIL}/login`), false);
    assert.equal(login.navigate('will-navigate', 'https://evil.com/login'), false);
    assert.equal(login.navigate('will-navigate', 'http://nas.example.com:5667/login'), false);
    assert.equal(login.navigate('will-navigate', 'file:///C:/Windows/win.ini'), false);
});

test('a subframe probe does not become the confirmed NAS', async (t) => {
    const login = setupLogin(t);
    await login.start();

    login.navigate('will-redirect', 'https://evil.com/bridge', { isMainFrame: false });
    login.navigate('will-navigate', `${NAS}/v`);

    assert.equal(await login.finishLoad('https://evil.com/login'), '');
    assert.notEqual(await login.finishLoad(`${NAS}/login`), '');
});

test('continues an FN Connect target=_blank address in the same window and denies other popups', async (t) => {
    const login = setupLogin(t);
    const oauthWindow = await login.start();
    oauthWindow.webContents.currentUrl = 'https://5ddd.com/demo123';

    assert.deepEqual(oauthWindow.openHandler({ url: 'https://beian.miit.gov.cn' }), { action: 'deny' });
    assert.ok(!oauthWindow.loaded.includes('https://beian.miit.gov.cn'));

    assert.deepEqual(oauthWindow.openHandler({ url: `${NAS}/` }), { action: 'deny' });
    assert.ok(oauthWindow.loaded.includes(`${NAS}/`));
    assert.notEqual(await login.finishLoad(`${NAS}/login`), '');

    assert.deepEqual(oauthWindow.openHandler({ url: 'https://evil.com/' }), { action: 'deny' });
    assert.ok(!oauthWindow.loaded.includes('https://evil.com/'));
});

test('ignores bridge messages from an unconfirmed page or a subframe', async (t) => {
    const login = setupLogin(t);
    const oauthWindow = await login.start();
    login.navigate('will-navigate', `${NAS}/v`);
    const before = oauthWindow.loaded.length;

    await login.finishLoad('https://evil.com/');
    await login.bridge(sysConfig('https://evil.com'));
    assert.equal(oauthWindow.loaded.length, before);

    await login.finishLoad(`${NAS}/v`);
    await login.bridge(sysConfig('https://evil.com'), { name: 'subframe' });
    assert.equal(oauthWindow.loaded.length, before);
});

test('moves to the OAuth address the NAS reports', async (t) => {
    const login = setupLogin(t);
    const oauthWindow = await login.start();
    login.navigate('will-navigate', 'http://192.0.2.10:5666/v');
    await login.finishLoad('http://192.0.2.10:5666/v');

    await login.bridge(sysConfig('https://other.example.net:8443'));

    assert.match(oauthWindow.loaded.at(-1), /^https:\/\/other\.example\.net:8443\/signin\?client_id=app1/);
    assert.match(await login.finishLoad('https://other.example.net:8443/login'), new RegExp(PASSWORD));
    assert.doesNotMatch(await login.finishLoad('http://192.0.2.10:5666/login'), new RegExp(PASSWORD));
});

test('stays on the current NAS when the reported OAuth address downgrades to HTTP', async (t) => {
    const login = setupLogin(t);
    const oauthWindow = await login.start();
    login.navigate('will-navigate', `${NAS}/v`);
    await login.finishLoad(`${NAS}/v`);

    await login.bridge(sysConfig('http://192.0.2.10:5666'));

    assert.match(oauthWindow.loaded.at(-1), new RegExp(`^${NAS}/signin\\?client_id=app1`));
});

test('does not send the access code to an unconfirmed page that sets the token cookie', async (t) => {
    const login = setupLogin(t, { accessCode: ACCESS_CODE });
    await login.start();
    login.navigate('will-navigate', `${NAS}/v`);
    await login.finishLoad('https://evil.com/');

    await login.tokenCookieChanged();

    assert.deepEqual(login.netRequests, []);
});
