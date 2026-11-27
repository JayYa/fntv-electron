const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const { useFakeElectron } = require('./fakeElectron.cjs');
const { startMainWindow } = require('./fakeMainWindow.cjs');

const PASSWORD = 'plain-password-value';
const ACCESS_CODE = 'plain-access-code';
const NAS = 'https://nas.example.com:5667';
const EVIL = 'https://nas.example.com.evil.com:5667';

function fakeSingleDisplayScreen() {
    const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    return { getAllDisplays: () => [display], getPrimaryDisplay: () => display };
}

function setupLogin(t, { accessCode = '', tokenCookies = [{ value: 'cookie-token', domain: 'nas.example.com' }], sysConfigOauth = null } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-fnid-'));
    const paths = { home: testRoot, temp: testRoot, userData: path.join(testRoot, '.fntv') };
    const netRequests = [];
    const nasRequests = [];
    const cookieSets = [];
    let cookieSetFails = false;
    let oauthWindow = null;
    let mainWindow = null;
    let windowsOpened = 0;

    class FakeBrowserWindow extends EventEmitter {
        constructor() {
            super();
            if (mainWindow) {
                windowsOpened += 1;
                oauthWindow = this;
            } else {
                mainWindow = this;
            }
            this.loaded = [];
            this.scripts = [];
            this.destroyed = false;
            const cookies = new EventEmitter();
            cookies.set = async (cookie) => {
                cookieSets.push(cookie);
                if (cookieSetFails) throw new Error('The cookie was set with an invalid Domain attribute.');
            };
            cookies.get = async () => tokenCookies;
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
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        BrowserWindow: FakeBrowserWindow,
        screen: fakeSingleDisplayScreen(),
        powerMonitor: new EventEmitter(),
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
            async isAsyncEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            async encryptStringAsync(value) { return Buffer.from(value, 'utf8'); },
            async decryptStringAsync(value) { return { result: value.toString('utf8'), shouldReEncrypt: false }; },
        },
    };

    useFakeElectron(t, electronMock);

    const originalAxiosGet = axios.get;
    axios.get = async (url, config) => {
        nasRequests.push({ url, token: config.headers.Authorization });
        if (sysConfigOauth && url.includes('/v/api/v1/sys/config')) {
            return { status: 200, headers: { 'content-type': 'application/json' }, data: { code: 0, msg: '', data: { nas_oauth: sysConfigOauth } } };
        }
        return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            data: { code: 0, msg: '', data: { username: 'alice' } },
        };
    };

    startMainWindow();
    const { handleFnIdLogin } = require('../../dest/main/common/fnId/fnIdLogin.js');
    const { readCurrentLogin } = require('../../dest/modules/fn_config/loginStore.js');
    const loginData = { domain: 'demo123', username: 'alice', password: PASSWORD, accessCode };
    const finished = handleFnIdLogin(loginData);

    t.after(async () => {
        oauthWindow?.close();
        await finished;
        axios.get = originalAxiosGet;
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    const flush = async () => {
        for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    };

    return {
        netRequests,
        nasRequests,
        cookieSets,
        refuseCookies() { cookieSetFails = true; },
        finished,
        loginAgain: () => handleFnIdLogin(loginData),
        windowsOpened: () => windowsOpened,
        readCurrentLogin,
        mainWindowLoaded: () => mainWindow?.loaded ?? [],
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
        async tokenCookieChanged(domain = 'nas.example.com') {
            oauthWindow.webContents.session.cookies.emit(
                'changed', {}, { name: 'Trim-MC-token', value: 'cookie-token', domain }, 'explicit', false,
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

module.exports = { PASSWORD, ACCESS_CODE, NAS, EVIL, setupLogin, sysConfig };
