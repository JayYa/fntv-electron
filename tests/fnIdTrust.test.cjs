const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createFnIdTrust,
    isFnIdLoginPage,
    isFnIdNasPage,
    isFnIdTokenCookie,
    resolveFnIdNavigation,
    resolveFnIdOauthTrust,
    resolveFnIdWindowOpen,
} = require('../dest/main/handlers/core/fnIdTrust.js');

const FN_CONNECT_URL = 'https://5ddd.com/demo123';

function trustFor(targetOrigin) {
    return { ...createFnIdTrust(FN_CONNECT_URL), targetOrigin };
}

test('recognizes only the confirmed NAS origin as a NAS page', () => {
    const trust = trustFor('https://nas.example.com:5667');

    assert.equal(isFnIdNasPage('https://nas.example.com:5667/v', trust), true);
    assert.equal(isFnIdNasPage('HTTPS://NAS.Example.COM:5667/v', trust), true);

    for (const url of [
        'https://nas.example.com.evil.com:5667/v',
        'https://evil.com/nas.example.com:5667/v',
        'https://nas.example.com:5667@evil.com/v',
        'https://user:pass@nas.example.com:5667/v',
        'https://nas.example.com:5668/v',
        'https://nas.example.com/v',
        'http://nas.example.com:5667/v',
        'file:///C:/nas.example.com/v',
        'about:blank',
        'not a url',
        '',
    ]) {
        assert.equal(isFnIdNasPage(url, trust), false, url);
    }
});

test('treats nothing but the relay path as a NAS page before an origin is confirmed', () => {
    const trust = createFnIdTrust(FN_CONNECT_URL);

    assert.equal(isFnIdNasPage('https://5ddd.com/demo123', trust), true);
    assert.equal(isFnIdNasPage('https://5ddd.com/demo123/v', trust), true);

    for (const url of [
        'https://5ddd.com/',
        'https://5ddd.com/demo1234',
        'https://5ddd.com/other99/v',
        'https://5ddd.com/demo123/../other99/v',
        'http://5ddd.com/demo123',
        'https://5ddd.com:8443/demo123',
        'https://5ddd.com.evil.com/demo123',
        'https://nas.example.com/v',
    ]) {
        assert.equal(isFnIdNasPage(url, trust), false, url);
    }
});

test('treats only the login paths of a NAS page as login pages', () => {
    const trust = trustFor('https://nas.example.com:5667');

    for (const url of [
        'https://nas.example.com:5667/login',
        'https://nas.example.com:5667/login/',
        'https://nas.example.com:5667/v/login',
        'https://nas.example.com:5667/login?redirect=%2Fsignin',
        'https://5ddd.com/demo123/login',
        'https://5ddd.com/demo123/v/login',
    ]) {
        assert.equal(isFnIdLoginPage(url, trust), true, url);
    }

    for (const url of [
        'https://nas.example.com:5667/',
        'https://nas.example.com:5667/signin?client_id=a',
        'https://nas.example.com:5667/x?next=/login',
        'https://nas.example.com:5667/x#/login',
        'https://nas.example.com:5667/plugin/login',
        'https://nas.example.com:5667/LOGIN',
        'https://nas.example.com:5667/login.html',
        'https://5ddd.com/login',
        'https://5ddd.com/other99/login',
        'https://nas.example.com.evil.com:5667/login',
        'https://evil.com/login',
        'http://nas.example.com:5667/login',
    ]) {
        assert.equal(isFnIdLoginPage(url, trust), false, url);
    }
});

test('confirms the first address FN Connect leaves for, including plain HTTP LAN addresses', () => {
    const trust = createFnIdTrust(FN_CONNECT_URL);

    assert.equal(
        resolveFnIdNavigation('http://192.168.1.10:5666/login', trust).targetOrigin,
        'http://192.168.1.10:5666',
    );
    assert.equal(
        resolveFnIdNavigation('https://abc.example.net/', trust).targetOrigin,
        'https://abc.example.net',
    );
    assert.equal(
        resolveFnIdNavigation('http://[fd00::10]:5666/', trust).targetOrigin,
        'http://[fd00::10]:5666',
    );
});

test('keeps the trust state while moving between FN Connect pages', () => {
    const trust = createFnIdTrust(FN_CONNECT_URL);

    assert.deepEqual(resolveFnIdNavigation('http://check.fnos.net/demo123', trust), trust);
    assert.deepEqual(resolveFnIdNavigation('https://www.5ddd.com/demo123', trust), trust);
});

test('refuses to confirm non-web, credentialed, downgraded or vendor footer addresses', () => {
    const trust = createFnIdTrust(FN_CONNECT_URL);

    for (const url of [
        'file:///C:/Windows/win.ini',
        'javascript:alert(1)',
        'data:text/html,x',
        'fntv://login',
        'https://user@nas.example.com/',
        'http://5ddd.com/demo123',
        'http://www.5ddd.com/demo123',
        'https://fnnas.com/fn-connect',
        'https://beian.miit.gov.cn',
    ]) {
        assert.equal(resolveFnIdNavigation(url, trust), null, url);
    }
});

test('follows same-host port and HTTPS upgrades after an origin is confirmed', () => {
    assert.equal(
        resolveFnIdNavigation('http://192.0.2.10:5666/v', trustFor('http://192.0.2.10')).targetOrigin,
        'http://192.0.2.10:5666',
    );
    assert.equal(
        resolveFnIdNavigation('https://192.0.2.10:5667/v', trustFor('http://192.0.2.10:5666')).targetOrigin,
        'https://192.0.2.10:5667',
    );
});

test('refuses other hosts and HTTP downgrades after an origin is confirmed', () => {
    const trust = trustFor('https://nas.example.com:5667');

    for (const url of [
        'https://evil.com/login',
        'https://nas.example.com.evil.com:5667/login',
        'https://nas.example.com:5667@evil.com/login',
        'http://nas.example.com:5666/login',
        'http://nas.example.com:5667/login',
    ]) {
        assert.equal(resolveFnIdNavigation(url, trust), null, url);
    }
});

test('lets only FN Connect pages open an address, and only before one is confirmed', () => {
    const unconfirmed = createFnIdTrust(FN_CONNECT_URL);
    const confirmed = trustFor('https://nas.example.com');

    assert.equal(
        resolveFnIdWindowOpen('http://203.0.113.5:5666', 'https://5ddd.com/demo123', unconfirmed).targetOrigin,
        'http://203.0.113.5:5666',
    );
    assert.equal(resolveFnIdWindowOpen('https://beian.miit.gov.cn', 'https://5ddd.com/demo123', unconfirmed), null);
    assert.equal(resolveFnIdWindowOpen('https://other.example.com', 'https://5ddd.com/demo123', confirmed), null);
    assert.equal(resolveFnIdWindowOpen('https://nas.example.com/help', 'https://nas.example.com/v', confirmed), null);
    assert.equal(resolveFnIdWindowOpen('https://evil.com', 'https://evil.com/x', unconfirmed), null);
});

test('moves trust to the OAuth address a NAS reports unless it downgrades', () => {
    assert.equal(
        resolveFnIdOauthTrust('https://other.example.net:8443', trustFor('http://192.0.2.10:5666')).targetOrigin,
        'https://other.example.net:8443',
    );
    assert.equal(
        resolveFnIdOauthTrust('http://192.0.2.20:5666', trustFor('http://192.0.2.10:5666')).targetOrigin,
        'http://192.0.2.20:5666',
    );

    const httpsTrust = trustFor('https://nas.example.com');
    for (const url of [
        'http://nas.example.com',
        'http://192.0.2.20:5666',
        'https://user@nas.example.com',
        'file:///C:/x',
        '://',
        '',
        'https://5ddd.com',
    ]) {
        assert.equal(resolveFnIdOauthTrust(url, httpsTrust), null, url);
    }
});

test('accepts the token cookie shapes Chromium stores for the confirmed NAS', () => {
    const accepted = [
        ['http://192.168.1.10:5666', '192.168.1.10'],
        ['http://[fd00::10]:5666', '[fd00::10]'],
        ['https://demo.fnos.net', 'demo.fnos.net'],
        ['https://demo.fnos.net', '.demo.fnos.net'],
        ['https://demo.fnos.net', '.fnos.net'],
        ['https://demo.fnos.net:5667', 'DEMO.fnos.net'],
    ];

    for (const [origin, domain] of accepted) {
        assert.equal(isFnIdTokenCookie({ domain }, trustFor(origin)), true, `${origin} ${domain}`);
    }
});

test('accepts relay token cookies only until a NAS is confirmed', () => {
    const relay = createFnIdTrust(FN_CONNECT_URL);
    const nas = trustFor('https://demo.fnos.net');

    for (const domain of ['5ddd.com', '.5ddd.com']) {
        assert.equal(isFnIdTokenCookie({ domain }, relay), true);
        assert.equal(isFnIdTokenCookie({ domain }, nas), false);
    }
});

test('refuses token cookies no confirmed NAS or relay page can read', () => {
    const lan = trustFor('http://192.168.1.10:5666');
    const nas = trustFor('https://demo.fnos.net');

    for (const [domain, trust] of [
        ['evil.com', nas],
        ['.evil.com', nas],
        ['demo.fnos.net.evil.com', nas],
        ['.demo.fnos.net.evil.com', nas],
        ['xdemo.fnos.net', nas],
        ['fnos.net', nas],
        ['other.demo.fnos.net', nas],
        ['.other.demo.fnos.net', nas],
        ['check.fnos.net', nas],
        ['www.5ddd.com', nas],
        ['x5ddd.com', nas],
        ['192.168.1.11', lan],
        ['.1.10', lan],
        ['.168.1.10', lan],
        ['demo.fnos.net', createFnIdTrust(FN_CONNECT_URL)],
        ['', nas],
        [undefined, nas],
    ]) {
        assert.equal(isFnIdTokenCookie({ domain }, trust), false, String(domain));
    }
});
