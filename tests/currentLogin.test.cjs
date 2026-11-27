const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
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
} = require('./helpers/currentLoginWorld.cjs');

test('password login saves the current login and history, then opens the web UI', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })] });

    assert.deepEqual(await world.login(), { ok: true });

    const saved = await world.config.readCurrentLogin();
    assert.equal(saved.domain, NAS);
    assert.equal(saved.token, 'new-token');
    assert.deepEqual((await world.config.listHistory()).map(({ domain, account }) => ({ domain, account })), [
        { domain: 'nas.example:5667', account: 'alice' },
    ]);
    assert.ok(world.cookies.some((cookie) => cookie.name === 'Trim-MC-token' && cookie.value === 'new-token'));
    assert.deepEqual(world.mainWindow().loaded.urls, [`${NAS}/v`]);
});

test('password login logs the established login without the NAS address', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })] });
    const infos = [];
    t.mock.method(require('../dest/modules/logger/index.js'), 'info', (...args) => infos.push(args.join(' ')));

    assert.deepEqual(await world.login(), { ok: true });

    const established = infos.find((line) => line.includes('已建立当前登录'));
    assert.ok(established, infos.join(' | '));
    const { hostname, port } = new URL(NAS);
    assert.ok(!established.includes(hostname) && !established.includes(port), established);
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

    assert.deepEqual(await world.login(), {
        ok: false,
        error: { title: '登录失败', message: '无法恢复登录状态，请重新登录。' },
    });

    await assertNothingSaved(world);
    assert.deepEqual(world.mainWindow().loaded.urls, []);
});

test('a rejected password is reported as it came from FNMedia and nothing is saved', async (t) => {
    const world = setup(t, { loginResponses: [rejected('用户名或密码错误')] });

    assert.deepEqual(await world.login(), {
        ok: false,
        error: { title: '登录失败', message: '用户名或密码错误' },
    });
    await assertNothingSaved(world);
});

test('after the user trusts an untrusted certificate, password login is retried once and succeeds', async (t) => {
    const world = setup(t, {
        loginResponses: [certificateError(), ok({ token: 'new-token' })],
        trustCertificate: true,
    });

    assert.deepEqual(await world.login(), { ok: true });

    assert.deepEqual(world.dialogs, ['证书安全警告']);
    assert.equal(world.loginRequests.length, 2);
    assert.equal((await world.config.readCurrentLogin()).token, 'new-token');
    assert.deepEqual(world.mainWindow().loaded.urls, [`${NAS}/v`]);
});

test('trusting a certificate without "remember" does not add the host to the trusted hosts kept across restarts', async (t) => {
    const world = setup(t, {
        loginResponses: [certificateError(), ok({ token: 'new-token' })],
        trustCertificate: true,
    });

    assert.deepEqual(await world.login(), { ok: true });

    assert.equal(world.certTrust().isTrusted(NAS), true);
    assert.equal(world.certTrustAfterRestart().isTrusted(NAS), false);
});

test('trusting a certificate with "remember" keeps the host trusted across restarts', async (t) => {
    const world = setup(t, {
        loginResponses: [certificateError(), ok({ token: 'new-token' })],
        trustCertificate: true,
        rememberCertificate: true,
    });

    assert.deepEqual(await world.login(), { ok: true });

    assert.equal(world.certTrustAfterRestart().isTrusted(NAS), true);
});

test('when the user does not trust the certificate, password login is cancelled and nothing is saved', async (t) => {
    const world = setup(t, { loginResponses: [certificateError()] });

    assert.deepEqual(await world.login(), {
        ok: false,
        error: { title: '登录取消', message: '用户取消信任证书，无法继续登录。' },
    });
    assert.equal(world.loginRequests.length, 1);
    await assertNothingSaved(world);
});

test('a rejected access code stops password login before the login request, and nothing is saved', async (t) => {
    const world = setup(t, { accessCodeStatus: 403, loginResponses: [ok({ token: 'new-token' })] });

    assert.deepEqual(await world.login({ ...PASSWORD_LOGIN, accessCode: 'wrong-code' }), {
        ok: false,
        error: { title: '访问码错误', message: '访问码错误，请检查后重试。' },
    });
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

    assert.deepEqual(await world.login(), { ok: true });

    assert.equal((await world.config.readCurrentLogin()).domain, moved);
    assert.deepEqual(world.mainWindow().loaded.urls, [`${moved}/v`]);
});

test('when secure storage is unavailable, password login says so and saves nothing', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })], encryptionAvailable: false });

    const reply = await world.login();

    assert.equal(reply.ok, false);
    assert.equal(reply.error.title, '无法安全保存登录信息');
    assert.match(reply.error.message, /安全存储不可用/);
    await assertNothingSaved(world);
    assert.deepEqual(world.mainWindow().loaded.urls, []);
});

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
