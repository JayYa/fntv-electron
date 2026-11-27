const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
    NAS,
    FN_ID_HISTORY,
    ok,
    rejected,
    setup,
    assertNothingSaved,
    isLoginPage,
    fakeStartupWindow,
    seedCurrentLogin,
} = require('./helpers/currentLoginWorld.cjs');

test('startup restores a saved login that FNMedia still accepts', async (t) => {
    const world = setup(t);
    await seedCurrentLogin(world.config);
    const window = fakeStartupWindow();

    await world.currentLogin().restoreAtStartup(window);

    assert.deepEqual(window.loaded, { urls: [`${NAS}/v`], files: [] });
    assert.ok(world.cookies.some((cookie) => cookie.name === 'Trim-MC-token' && cookie.value === 'saved-token'));
});

test('startup goes to the login page when FNMedia no longer accepts the saved token', async (t) => {
    const world = setup(t, { userInfo: rejected('token 无效') });
    await seedCurrentLogin(world.config);
    const window = fakeStartupWindow();

    await world.currentLogin().restoreAtStartup(window);

    assert.deepEqual(window.loaded.urls, []);
    assert.ok(isLoginPage(window.loaded.files[0]));
    assert.deepEqual(world.cookies, []);
});

test('startup replaces the token cookie left by an earlier login with the saved token', async (t) => {
    const world = setup(t, { initialCookies: [{ url: NAS, name: 'Trim-MC-token', value: 'old-token', path: '/' }] });
    await seedCurrentLogin(world.config);

    await world.currentLogin().restoreAtStartup(fakeStartupWindow());

    assert.deepEqual(world.cookies.filter(({ name }) => name === 'Trim-MC-token').map(({ value }) => value), ['saved-token']);
});

test('the web UI session of an HTTPS login carries the token and relay mode as cross-site cookies the web UI can read', async (t) => {
    const world = setup(t, { loginResponses: [ok({ token: 'new-token' })] });

    await world.login();

    const attributes = ({ name, value, secure, httpOnly, sameSite, path: cookiePath }) => ({ name, value, secure, httpOnly, sameSite, path: cookiePath });
    assert.deepEqual(world.cookies.map(attributes), [
        { name: 'Trim-MC-token', value: 'new-token', secure: true, httpOnly: false, sameSite: 'no_restriction', path: '/' },
        { name: 'mode', value: 'relay', secure: true, httpOnly: false, sameSite: 'no_restriction', path: '/' },
    ]);
});

test('startup goes to the login page without asking FNMedia after the token was cleared by logging out', async (t) => {
    const world = setup(t);
    await seedCurrentLogin(world.config);
    await world.config.clearToken();
    let asked = false;
    axios.get = async () => { asked = true; return ok({ username: 'alice' }); };
    const window = fakeStartupWindow();

    await world.currentLogin().restoreAtStartup(window);

    assert.equal(asked, false);
    assert.deepEqual(window.loaded.urls, []);
    assert.ok(isLoginPage(window.loaded.files[0]));
});

test('a new login without a token saves nothing and does not open the web UI', async (t) => {
    const world = setup(t);
    const window = fakeStartupWindow();

    const result = await world.currentLogin().establishNewLogin(() => window, {
        access: { baseUrl: NAS, accessCode: '' },
        account: 'alice',
        token: '',
        history: FN_ID_HISTORY,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'session-not-restored');
    assert.deepEqual(world.cookies, []);
    assert.deepEqual(window.loaded.urls, []);
    await assertNothingSaved(world);
});

test('startup goes to the login page without asking FNMedia when the saved address is not an http address', async (t) => {
    const world = setup(t);
    await world.config.saveCurrentLogin({ account: 'alice', domain: 'nas.example:5667', token: 'saved-token', accessCode: '', useHttps: true });
    let asked = false;
    axios.get = async () => { asked = true; return ok({ username: 'alice' }); };
    const window = fakeStartupWindow();

    await world.currentLogin().restoreAtStartup(window);

    assert.equal(asked, false);
    assert.deepEqual(window.loaded.urls, []);
    assert.ok(isLoginPage(window.loaded.files[0]));
});

test('the current connection carries the saved login, its access grant and whether its host is trusted', async (t) => {
    const world = setup(t, { accessCodeStatus: 200, trustCertificate: true });
    const currentLogin = world.currentLogin();
    await currentLogin.establishNewLogin(() => fakeStartupWindow(), {
        access: await currentLogin.verifyAccess(NAS, 'code'),
        account: 'alice',
        token: 'fnid-token',
        history: FN_ID_HISTORY,
    });

    assert.deepEqual(await currentLogin.currentConnection(), {
        baseUrl: NAS,
        token: 'fnid-token',
        account: 'alice',
        accessCookie: 'gateway=granted',
        trustedHost: false,
    });
    assert.equal(await world.certTrust().confirmTrust(NAS, 'net::ERR_CERT_AUTHORITY_INVALID'), true);
    assert.equal((await currentLogin.currentConnection()).trustedHost, true);
});

test('there is no current connection after the current login ended', async (t) => {
    const world = setup(t);
    await seedCurrentLogin(world.config);
    await world.currentLogin().endCurrentLogin(fakeStartupWindow());

    await assert.rejects(world.currentLogin().currentConnection(), /无法找到有效的服务器登录配置/);
});
