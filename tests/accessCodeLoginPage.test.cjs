const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loginPageStyles } = require('./helpers/loginPage.cjs');

const loginPage = fs.readFileSync(path.join(__dirname, '../resource/login/index.html'), 'utf8');
const loginScript = fs.readFileSync(path.join(__dirname, '../resource/login/index.js'), 'utf8');
const loginStyles = loginPageStyles();

test('login page exposes an optional password-style access-code control', () => {
    assert.match(loginPage, /<label for="accessCode">访问码（可选）<\/label>/);
    assert.match(loginPage, /<input type="password" id="accessCode"[^>]+autocomplete="off"/);
    assert.match(loginPage, /id="accessCodeToggle"[^>]+title="显示访问码"/);
    assert.match(loginScript, /accessCode: accessCode/);
});

test('compact login panel remains scrollable on short windows', () => {
    assert.match(loginStyles, /max-height: calc\(100vh - 24px\)/);
    assert.match(loginStyles, /overflow-y: auto/);
    assert.match(loginStyles, /scrollbar-gutter: stable/);
});

test('login page credits the original author and the current maintainer', () => {
    const credits = [...loginPage.matchAll(/<span class="code-by">([^<]+)<\/span>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
        .map(([, role, href, name]) => ({ role, href, name }));

    assert.deepEqual(credits, [
        { role: '原作者', href: 'https://github.com/QiaoKes/fntv-electron', name: 'Tag mig hånden' },
        { role: '维护者', href: 'https://github.com/JayYa/fntv-electron', name: 'JayYa' },
    ]);
});

test('every login page link opens through the GitHub-only external link handler', () => {
    const anchors = loginPage.match(/<a\s[^>]*>/g);

    assert.ok(anchors.length > 0);
    for (const anchor of anchors) {
        assert.match(anchor, /class="github-link"/);
        const target = new URL(anchor.match(/href="([^"]+)"/)[1]);
        assert.equal(target.protocol, 'https:');
        assert.equal(target.hostname, 'github.com');
    }
});
