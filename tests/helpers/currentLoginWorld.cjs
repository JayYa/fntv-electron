const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const axios = require('axios');
const { useFakeElectron } = require('./fakeElectron.cjs');
const { startMainWindow } = require('./fakeMainWindow.cjs');

const NAS = 'https://nas.example:5667';
const PASSWORD_LOGIN = { domain: 'nas.example:5667', username: 'alice', password: 'secret', useHttps: true };

const ok = (data) => ({ status: 200, headers: { 'content-type': 'application/json' }, data: { code: 0, msg: '', data } });
const rejected = (msg) => ({ status: 200, headers: { 'content-type': 'application/json' }, data: { code: 1, msg } });
const certificateError = () => Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });

function setup(t, {
    loginResponses = [],
    userInfo = ok({ username: 'alice' }),
    cookiesFail = false,
    trustCertificate = false,
    rememberCertificate = false,
    accessCodeStatus = null,
    encryptionAvailable = true,
    clearStorageHangs = false,
    initialCookies = [],
} = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-current-login-'));
    const paths = { home: testRoot, temp: testRoot, userData: path.join(testRoot, '.fntv') };
    const listeners = new Map();
    const invokeHandlers = new Map();
    const cookies = [...initialCookies];
    const dialogs = [];
    const loginRequests = [];
    const gatewayRequests = [];
    const clearedStorages = [];
    let mainWindow = null;

    class FakeBrowserWindow extends EventEmitter {
        constructor() {
            super();
            mainWindow = this;
            this.loaded = { urls: [], files: [] };
            this.webContents = new EventEmitter();
        }

        loadURL(url) { this.loaded.urls.push(url); return Promise.resolve(); }

        loadFile(file) { this.loaded.files.push(file); return Promise.resolve(); }
    }

    const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        BrowserWindow: FakeBrowserWindow,
        screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display },
        powerMonitor: new EventEmitter(),
        ipcMain: {
            on(channel, listener) { listeners.set(channel, listener); },
            handle(channel, handler) { invokeHandlers.set(channel, handler); },
            removeAllListeners(channel) { listeners.delete(channel); },
        },
        dialog: {
            async showMessageBox(...args) {
                dialogs.push(args.at(-1).title);
                return { response: trustCertificate ? 0 : 1, checkboxChecked: rememberCertificate };
            },
        },
        net: {
            request({ url }) {
                if (accessCodeStatus === null) throw new Error('no access code, the gateway is not asked');
                gatewayRequests.push(url);
                const request = new EventEmitter();
                request.setHeader = () => {};
                request.abort = () => {};
                request.end = () => setImmediate(() => {
                    const response = new EventEmitter();
                    response.statusCode = accessCodeStatus;
                    request.emit('response', response);
                    response.emit('end');
                });
                return request;
            },
        },
        session: {
            fromPartition() {
                return {
                    clearStorageData({ storages }) {
                        if (clearStorageHangs) return new Promise(() => {});
                        clearedStorages.push(...storages);
                        return Promise.resolve();
                    },
                    cookies: {
                        get: async ({ url }) => (url && accessCodeStatus === 200 ? [{ name: 'gateway', value: 'granted' }] : []),
                        async remove(url, name) {
                            const index = cookies.findIndex((cookie) => cookie.url === url && cookie.name === name);
                            if (index >= 0) cookies.splice(index, 1);
                        },
                        async set(cookie) {
                            if (cookiesFail) throw new Error('cookie store unavailable');
                            cookies.push(cookie);
                        },
                    },
                };
            },
        },
        safeStorage: {
            async isAsyncEncryptionAvailable() { return encryptionAvailable; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            async encryptStringAsync(value) { return Buffer.from(value, 'utf8'); },
            async decryptStringAsync(value) { return { result: value.toString('utf8'), shouldReEncrypt: false }; },
        },
    };

    useFakeElectron(t, electronMock);

    const originalPost = axios.post;
    const originalGet = axios.get;
    axios.post = async (url) => {
        loginRequests.push(url);
        const next = loginResponses.shift();
        if (next instanceof Error) throw next;
        return next;
    };
    axios.get = async () => userInfo;

    t.after(() => {
        axios.post = originalPost;
        axios.get = originalGet;
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    fs.mkdirSync(paths.userData, { recursive: true });
    startMainWindow();
    const config = require('../../dest/modules/fn_config/loginStore.js');
    require('../../dest/main/handlers/plugins/auth.js').init();

    return {
        config,
        cookies,
        dialogs,
        loginRequests,
        gatewayRequests,
        clearedStorages,
        configFile: () => path.join(paths.userData, 'config.json'),
        mainWindow: () => mainWindow,
        currentLogin: () => require('../../dest/main/common/currentLogin.js'),
        accessGrant: () => require('../../dest/modules/fn_api/accessGrant.js'),
        certTrust: () => require('../../dest/modules/cert_trust/index.js'),
        login(loginData = PASSWORD_LOGIN) {
            return invokeHandlers.get('login')({}, loginData);
        },
    };
}

async function assertNothingSaved(world) {
    assert.equal((await world.config.readCurrentLogin())?.token, undefined);
    assert.deepEqual(await world.config.listHistory(), []);
}

const isLoginPage = (file) => path.relative(path.resolve(__dirname, '..', '..'), file) === path.join('resource', 'login', 'index.html');

const FN_ID_HISTORY = { domain: 'alice-fnid', account: 'alice', password: 'secret', accessCode: 'code', useHttps: true };

function fakeStartupWindow() {
    const loaded = { urls: [], files: [] };
    return { loaded, loadURL(url) { loaded.urls.push(url); }, loadFile(file) { loaded.files.push(file); } };
}

async function seedCurrentLogin(config) {
    await config.saveCurrentLogin({ account: 'alice', domain: NAS, token: 'saved-token', accessCode: '', useHttps: true });
}

module.exports = {
    NAS,
    PASSWORD_LOGIN,
    FN_ID_HISTORY,
    ok,
    rejected,
    certificateError,
    setup,
    assertNothingSaved,
    isLoginPage,
    fakeStartupWindow,
    seedCurrentLogin,
};
