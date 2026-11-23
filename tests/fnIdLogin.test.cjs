const test = require('node:test');
const assert = require('node:assert/strict');
const { PASSWORD, ACCESS_CODE, NAS, EVIL, setupLogin, sysConfig } = require('./helpers/fnIdLogin.cjs');

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

for (const { name, page, confirmed, domain, baseUrl } of [
    {
        name: 'a LAN address with a port',
        page: 'http://192.168.1.10:5666/v/oauth/result',
        confirmed: true,
        domain: '192.168.1.10',
        baseUrl: 'http://192.168.1.10:5666',
    },
    {
        name: 'an fnos.net address',
        page: 'https://demo.fnos.net/v/oauth/result',
        confirmed: true,
        domain: 'demo.fnos.net',
        baseUrl: 'https://demo.fnos.net',
    },
    {
        name: 'an fnos.net address with a parent-domain cookie',
        page: 'https://demo.fnos.net/v/oauth/result',
        confirmed: true,
        domain: '.fnos.net',
        baseUrl: 'https://demo.fnos.net',
    },
    {
        name: 'the FN Connect relay path',
        page: 'https://5ddd.com/demo123/v',
        confirmed: false,
        domain: '5ddd.com',
        baseUrl: 'https://5ddd.com/demo123',
    },
]) {
    test(`completes login from the token cookie of ${name}`, async (t) => {
        const login = setupLogin(t, { tokenCookies: [{ value: 'nas-token', domain }] });
        await login.start();
        if (confirmed) login.navigate('will-navigate', page);
        await login.finishLoad(page);

        await login.tokenCookieChanged(domain);
        assert.deepEqual(await login.finished, { ok: true });

        assert.deepEqual(login.nasRequests, [{ url: `${baseUrl}/v/api/v1/user/info`, token: 'nas-token' }]);
        assert.equal((await login.readCurrentLogin()).token, 'nas-token');
        assert.equal((await login.readCurrentLogin()).domain, baseUrl);
        assert.deepEqual(login.mainWindowLoaded(), [`${baseUrl}/v`]);
    });
}

test('skips a token cookie of another site and uses the one of the confirmed NAS', async (t) => {
    const login = setupLogin(t, {
        tokenCookies: [
            { value: 'evil-token', domain: 'evil.com' },
            { value: 'nas-token', domain: 'nas.example.com' },
        ],
    });
    await login.start();
    login.navigate('will-navigate', `${NAS}/v`);
    await login.finishLoad(`${NAS}/v`);

    await login.tokenCookieChanged();
    await login.finished;

    assert.deepEqual(login.nasRequests, [{ url: `${NAS}/v/api/v1/user/info`, token: 'nas-token' }]);
    assert.equal((await login.readCurrentLogin()).token, 'nas-token');
});

test('never sends a token cookie of another site to the NAS', async (t) => {
    const login = setupLogin(t, { tokenCookies: [{ value: 'evil-token', domain: 'evil.com' }] });
    await login.start();
    login.navigate('will-navigate', `${NAS}/v`);
    await login.finishLoad(`${NAS}/v`);

    await login.tokenCookieChanged();

    assert.deepEqual(login.nasRequests, []);
    assert.deepEqual(login.mainWindowLoaded(), []);
});

test('closing the FN Connect window ends the login with an error for the login page', async (t) => {
    const login = setupLogin(t);
    const oauthWindow = await login.start();

    oauthWindow.close();

    assert.deepEqual(await login.finished, {
        ok: false,
        error: { title: 'FN ID 登录失败', message: '用户关闭了登录窗口' },
    });
});

test('a token cookie change on another site does not start the login check', async (t) => {
    const login = setupLogin(t);
    await login.start();
    login.navigate('will-navigate', `${NAS}/v`);
    await login.finishLoad(`${NAS}/v`);

    await login.tokenCookieChanged('evil.com');

    assert.deepEqual(login.nasRequests, []);
});

test('treats only URL-safe 6 to 30 character input as an FN ID', () => {
    const { isFnId } = require('../dest/public/fnId.js');

    for (const value of [
        'demo123',
        'my-nas-01',
        'my_nas_01',
        'DEMO123',
        '123456',
        '  demo123  ',
        'a'.repeat(30),
    ]) {
        assert.equal(isFnId(value), true, value);
    }

    for (const value of [
        '',
        'demo1',
        'a'.repeat(31),
        'nas.example.com',
        'demo/123',
        'demo123/../other99',
        'demo?123',
        'demo#123',
        'demo 123',
        'demo\n123',
        'demo\\123',
        'demo%2f123',
        'demo@123',
        'demo:5666',
        '[fd00::10]:5666',
        '飞牛账号一二三',
    ]) {
        assert.equal(isFnId(value), false, value);
    }
});

test('an authorization code the NAS refuses fails the login and logs the refusal without the NAS address', async (t) => {
    const login = setupLogin(t);
    await login.start();
    login.navigate('will-navigate', `${NAS}/v`);
    await login.finishLoad(`${NAS}/v`);
    await login.bridge(sysConfig(NAS));

    const { ApiService } = require('../dest/modules/fn_api/api.js');
    t.mock.method(ApiService.prototype, 'auth', async () => ({ success: false, message: '授权码已过期' }));
    const errors = [];
    t.mock.method(require('../dest/modules/logger/index.js'), 'error', (...args) => errors.push(args.join(' ')));
    await login.bridge({ type: 'Response', url: `${NAS}/oauthapi/authorize`, code: 'auth-code' });

    const result = await login.finished;
    assert.equal(result.ok, false);
    assert.match(result.error.message, /授权码已过期/);
    const refusal = errors.find((line) => line.includes('授权失败'));
    assert.ok(refusal, errors.join('
'));
    assert.match(refusal, /授权码已过期/);
    const { hostname, port } = new URL(NAS);
    assert.ok(!refusal.includes(hostname) && !refusal.includes(port), refusal);
});
