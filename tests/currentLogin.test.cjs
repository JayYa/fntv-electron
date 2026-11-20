const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

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
    accessCodeStatus = null,
    encryptionAvailable = true,
    clearStorageHangs = false,
} = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-current-login-'));
    const paths = { home: testRoot, temp: testRoot, userData: path.join(testRoot, '.fntv') };
    const listeners = new Map();
    const cookies = [];
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
        ipcMain: {
            on(channel, listener) { listeners.set(channel, listener); },
            handle() {},
            removeAllListeners(channel) { listeners.delete(channel); },
        },
        dialog: {
            async showMessageBox(...args) {
                dialogs.push(args.at(-1).title);
                return { response: trustCertificate ? 0 : 1, checkboxChecked: false };
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
                        remove: async () => {},
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
    const config = require('../dest/modules/fn_config/loginStore.js');
    require('../dest/main/handlers/plugins/auth.js').init();

    return {
        config,
        cookies,
        dialogs,
        loginRequests,
        gatewayRequests,
        clearedStorages,
        configFile: () => path.join(paths.userData, 'config.json'),
        mainWindow: () => mainWindow,
        currentLogin: () => require('../dest/main/common/currentLogin.js'),
        accessGrant: () => require('../dest/modules/fn_api/accessGrant.js'),
        loadWinctrl: () => require('../dest/main/common/winctrl.js'),
        async login(loginData = PASSWORD_LOGIN) {
            const replies = [];
            await listeners.get('login')({
                reply(channel, data) { replies.push({ channel, data }); },
            }, loginData);
            return replies;
        },
    };
}

async function assertNothingSaved(world) {
    assert.equal((await world.config.readCurrentLogin())?.token, undefined);
    assert.deepEqual(await world.config.listHistory(), []);
}

test('password login saves the current login and history, then opens the web UI', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })] });

    assert.deepEqual(await world.login(), []);

    const saved = await world.config.readCurrentLogin();
    assert.equal(saved.domain, NAS);
    assert.equal(saved.token, 'new-token');
    assert.deepEqual((await world.config.listHistory()).map(({ domain, account }) => ({ domain, account })), [
        { domain: 'nas.example:5667', account: 'alice' },
    ]);
    assert.ok(world.cookies.some((cookie) => cookie.name === 'Trim-MC-token' && cookie.value === 'new-token'));
    assert.deepEqual(world.mainWindow().loaded.urls, [`${NAS}/v`]);
});

test('password login keeps the path of an address served under a subpath', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })] });

    await world.login({ ...PASSWORD_LOGIN, domain: 'nas.example:5667/fn' });

    assert.deepEqual(world.loginRequests, [`${NAS}/fn/v/api/v1/login`]);
    assert.equal((await world.config.readCurrentLogin()).domain, `${NAS}/fn`);
    assert.deepEqual(world.mainWindow().loaded.urls, [`${NAS}/fn/v`]);
});

test('when the login state cannot be restored, password login saves nothing and stays on the login page', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })], cookiesFail: true });

    assert.deepEqual(await world.login(), [{
        channel: 'login-error',
        data: { title: '登录失败', message: '无法恢复登录状态，请重新登录。' },
    }]);

    await assertNothingSaved(world);
    assert.equal(world.mainWindow(), null);
});

test('a rejected password is reported as it came from FNMedia and nothing is saved', async (t) => {
    const world = setup(t, { loginResponses: [rejected('用户名或密码错误')] });

    assert.deepEqual(await world.login(), [{
        channel: 'login-error',
        data: { title: '登录失败', message: '用户名或密码错误' },
    }]);
    await assertNothingSaved(world);
});

test('after the user trusts an untrusted certificate, password login is retried once and succeeds', async (t) => {
    const world = setup(t, {
        loginResponses: [certificateError(), ok({ token: 'new-token' })],
        trustCertificate: true,
    });

    assert.deepEqual(await world.login(), []);

    assert.deepEqual(world.dialogs, ['证书安全警告']);
    assert.equal(world.loginRequests.length, 2);
    assert.equal((await world.config.readCurrentLogin()).token, 'new-token');
    assert.deepEqual(world.mainWindow().loaded.urls, [`${NAS}/v`]);
});

test('when the user does not trust the certificate, password login is cancelled and nothing is saved', async (t) => {
    const world = setup(t, { loginResponses: [certificateError()] });

    assert.deepEqual(await world.login(), [{
        channel: 'login-error',
        data: { title: '登录取消', message: '用户取消信任证书，无法继续登录。' },
    }]);
    assert.equal(world.loginRequests.length, 1);
    await assertNothingSaved(world);
});

test('a rejected access code stops password login before the login request, and nothing is saved', async (t) => {
    const world = setup(t, { accessCodeStatus: 403, loginResponses: [ok({ token: 'new-token' })] });

    assert.deepEqual(await world.login({ ...PASSWORD_LOGIN, accessCode: 'wrong-code' }), [{
        channel: 'login-error',
        data: { title: '访问码错误', message: '访问码错误，请检查后重试。' },
    }]);
    assert.deepEqual(world.loginRequests, []);
    await assertNothingSaved(world);
});

test('when FNMedia moves the login to another address, the current login and the web UI use that address', async (t) => {
    const moved = 'https://nas2.example:5667';
    const world = setup(t, {
        loginResponses: [
            { status: 302, headers: { location: `${moved}/v/api/v1/login` }, data: '' },
            ok({ token: 'new-token' }),
        ],
    });

    assert.deepEqual(await world.login(), []);

    assert.equal((await world.config.readCurrentLogin()).domain, moved);
    assert.deepEqual(world.mainWindow().loaded.urls, [`${moved}/v`]);
});

test('when secure storage is unavailable, password login says so and saves nothing', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })], encryptionAvailable: false });

    const [reply] = await world.login();

    assert.equal(reply.data.title, '无法安全保存登录信息');
    assert.match(reply.data.message, /安全存储不可用/);
    await assertNothingSaved(world);
    assert.equal(world.mainWindow(), null);
});

function fakeStartupWindow() {
    const loaded = { urls: [], files: [] };
    return { loaded, loadURL(url) { loaded.urls.push(url); }, loadFile(file) { loaded.files.push(file); } };
}

async function seedCurrentLogin(config) {
    await config.saveCurrentLogin({ account: 'alice', domain: NAS, token: 'saved-token', accessCode: '', useHttps: true });
}

test('startup restores a saved login that FNMedia still accepts', async (t) => {
    const world = setup(t);
    await seedCurrentLogin(world.config);
    const window = fakeStartupWindow();

    await world.loadWinctrl().setupCookieRestore(window);

    assert.deepEqual(window.loaded, { urls: [`${NAS}/v`], files: [] });
    assert.ok(world.cookies.some((cookie) => cookie.name === 'Trim-MC-token' && cookie.value === 'saved-token'));
});

test('startup goes to the login page when FNMedia no longer accepts the saved token', async (t) => {
    const world = setup(t, { userInfo: rejected('token 无效') });
    await seedCurrentLogin(world.config);
    const window = fakeStartupWindow();

    await world.loadWinctrl().setupCookieRestore(window);

    assert.deepEqual(window.loaded.urls, []);
    assert.equal(path.relative(path.resolve(__dirname, '..'), window.loaded.files[0]), path.join('resource', 'login', 'index.html'));
    assert.deepEqual(world.cookies, []);
});

const FN_ID_HISTORY = { domain: 'alice-fnid', account: 'alice', password: 'secret', accessCode: 'code', useHttps: true };

test('a login whose access code was already verified saves the current login and history without asking the gateway again', async (t) => {
    const world = setup(t, { accessCodeStatus: 200 });
    const currentLogin = world.currentLogin();
    const window = fakeStartupWindow();

    const granted = await currentLogin.verifyAccess(NAS, 'code');
    const result = await currentLogin.establishNewLogin(() => window, {
        access: granted,
        account: 'alice',
        token: 'fnid-token',
        history: FN_ID_HISTORY,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(world.gatewayRequests.length, 1);
    assert.equal(world.accessGrant().getAccessCookieHeader(NAS), 'gateway=granted');
    const saved = await world.config.readCurrentLogin();
    assert.equal(saved.domain, NAS);
    assert.equal(saved.token, 'fnid-token');
    assert.deepEqual((await world.config.listHistory()).map(({ domain }) => domain), ['alice-fnid']);
    assert.deepEqual(window.loaded.urls, [`${NAS}/v`]);
});

test('when another verification cleared the access grant in between, the earlier verified address is verified again', async (t) => {
    const world = setup(t, { accessCodeStatus: 200 });
    const currentLogin = world.currentLogin();
    const window = fakeStartupWindow();

    const granted = await currentLogin.verifyAccess(NAS, 'code');
    await currentLogin.verifyAccess('https://other.example:5667', 'other-code');
    const result = await currentLogin.establishNewLogin(() => window, {
        access: granted,
        account: 'alice',
        token: 'fnid-token',
        history: FN_ID_HISTORY,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(world.gatewayRequests.length, 3);
    assert.equal(world.accessGrant().getAccessCookieHeader(NAS), 'gateway=granted');
    assert.equal(world.accessGrant().getAccessCookieHeader('https://other.example:5667'), '');
});

const isLoginPage = (file) => path.relative(path.resolve(__dirname, '..'), file) === path.join('resource', 'login', 'index.html');

test('ending the current login clears the token, the access grant and the cookies before showing the login page', async (t) => {
    const world = setup(t, { accessCodeStatus: 200 });
    const currentLogin = world.currentLogin();
    await currentLogin.establishNewLogin(() => fakeStartupWindow(), {
        access: await currentLogin.verifyAccess(NAS, 'code'),
        account: 'alice',
        token: 'fnid-token',
        history: FN_ID_HISTORY,
    });
    const window = fakeStartupWindow();
    let stateWhenShown = null;
    window.loadFile = (file) => {
        stateWhenShown ??= {
            loginPage: isLoginPage(file),
            token: JSON.parse(fs.readFileSync(world.configFile(), 'utf8')).token,
            grant: world.accessGrant().getAccessCookieHeader(NAS),
            clearedStorages: [...world.clearedStorages],
        };
    };

    await currentLogin.endCurrentLogin(window);

    assert.deepEqual(stateWhenShown, { loginPage: true, token: '', grant: '', clearedStorages: ['cookies'] });
    assert.equal((await world.config.readCurrentLogin()).domain, NAS);
});

test('ending the current login still shows the login page when clearing the cookies never finishes', async (t) => {
    const world = setup(t, { clearStorageHangs: true });
    await seedCurrentLogin(world.config);
    const window = fakeStartupWindow();
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const ending = world.currentLogin().endCurrentLogin(window);
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(5000);
    await ending;

    assert.ok(isLoginPage(window.loaded.files[0]));
    assert.equal((await world.config.readCurrentLogin()).token, '');
});

test('a rejected access code fails verification with the access code error', async (t) => {
    const world = setup(t, { accessCodeStatus: 401 });

    await assert.rejects(world.currentLogin().verifyAccess(NAS, 'wrong-code'), {
        name: 'LoginFailedError',
        reason: 'access-code-rejected',
        loginError: { title: '访问码错误', message: '访问码错误，请检查后重试。' },
    });
});
