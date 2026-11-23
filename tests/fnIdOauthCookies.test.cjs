const test = require('node:test');
const assert = require('node:assert/strict');
const { NAS, setupLogin, sysConfig } = require('./helpers/fnIdLogin.cjs');

const loginCookie = () => ({ type: 'XHR', url: '/sac/rpcproxy/v1/new-user-guide/status', cookie: 'fnos-token=abc; other=x=y' });

async function reachOauth(login, nas) {
    const oauthWindow = await login.start();
    login.navigate('will-navigate', `${nas}/v`);
    await login.finishLoad(`${nas}/v`);
    await login.bridge(loginCookie());
    await login.bridge(sysConfig(nas));
    return oauthWindow;
}

for (const [nas, domain] of [
    ['https://[fd00::1]:5666', '[fd00::1]'],
    ['http://192.168.1.2:5666', '192.168.1.2'],
    ['https://nas.example.com', 'nas.example.com'],
]) {
    test(`forwards the login cookies to the OAuth address ${nas} with the cookie domain ${domain}`, async (t) => {
        const login = setupLogin(t);
        const oauthWindow = await reachOauth(login, nas);

        const forwarded = login.cookieSets.filter((cookie) => cookie.name !== 'mode');
        assert.deepEqual(forwarded.map(({ name, value, domain: d, url }) => ({ name, value, d, url })), [
            { name: 'fnos-token', value: 'abc', d: domain, url: nas },
            { name: 'other', value: 'x=y', d: domain, url: nas },
        ]);
        assert.ok(login.cookieSets.some((cookie) => cookie.name === 'mode' && cookie.value === 'relay' && cookie.url === nas));
        assert.equal(oauthWindow.loaded.at(-1), `${nas}/signin?client_id=app1&redirect_uri=${encodeURIComponent(`${nas}/v/oauth/result`)}`);
    });
}

test('a cookie the session refuses is logged as a warning without its value and the login still moves to the OAuth page', async (t) => {
    const login = setupLogin(t);
    const warnings = [];
    t.mock.method(require('../dest/modules/logger/index.js'), 'warn', (...args) => warnings.push(args.map(String).join(' ')));
    const oauthWindow = await login.start();
    login.refuseCookies();
    await reachOauth(login, NAS);

    assert.ok(oauthWindow.loaded.at(-1)?.startsWith(`${NAS}/signin?client_id=app1&`), oauthWindow.loaded.at(-1));
    const cookieWarnings = warnings.filter((line) => line.includes('Cookie'));
    assert.equal(cookieWarnings.length, 3);
    assert.ok(cookieWarnings.every((line) => !line.includes('abc')));
});

test('the OAuth configuration the client requests itself forwards the cookies and moves to the same OAuth page', async (t) => {
    const nas = 'https://[fd00::1]:5666';
    const login = setupLogin(t, { sysConfigOauth: { app_id: 'app1', url: nas } });
    const oauthWindow = await login.start();
    login.navigate('will-navigate', `${nas}/v`);
    await login.finishLoad(`${nas}/v`);

    await login.bridge(loginCookie());

    assert.ok(login.nasRequests.some((request) => request.url.includes('/v/api/v1/sys/config')));
    assert.ok(login.cookieSets.some((cookie) => cookie.name === 'fnos-token' && cookie.domain === '[fd00::1]'));
    assert.equal(oauthWindow.loaded.at(-1), `${nas}/signin?client_id=app1&redirect_uri=${encodeURIComponent(`${nas}/v/oauth/result`)}`);
});
