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
