const test = require('node:test');
const assert = require('node:assert/strict');
const { openLoginPage } = require('./helpers/loginPage.cjs');

const LOGIN_ERROR = { title: '登录失败', message: '用户名或密码错误' };

function pageWithFilledForm() {
    const page = openLoginPage();
    page.load();
    page.typeInto('domain', 'nas.example:5667');
    page.typeInto('username', 'user');
    page.typeInto('password', 'wrong-password');
    return page;
}

test('opening the login page focuses the domain input', () => {
    const page = openLoginPage();

    page.load();

    assert.equal(page.focusedId(), 'domain');
});

test('closing the login failure message returns focus to the password input that submitted the form', () => {
    const page = pageWithFilledForm();
    page.focus('password');

    page.press('Enter');
    assert.equal(page.sent.filter((message) => message.channel === 'login').length, 1);
    page.receive('login-error', LOGIN_ERROR);
    page.click('messageButton');

    assert.equal(page.focusedId(), 'password');
});

test('closing the login failure message with Escape returns focus to the password input', () => {
    const page = pageWithFilledForm();
    page.focus('password');

    page.press('Enter');
    page.receive('login-error', LOGIN_ERROR);
    page.press('Escape');

    assert.equal(page.focusedId(), 'password');
});

test('closing a message falls back to the domain input when the previously focused element left the page', () => {
    const page = pageWithFilledForm();
    page.focus('username');

    page.receive('login-error', LOGIN_ERROR);
    page.input('username').isConnected = false;
    page.click('messageButton');

    assert.equal(page.focusedId(), 'domain');
});

test('closing a message falls back to the domain input when nothing was focused before it opened', () => {
    const page = openLoginPage();

    page.receive('login-error', LOGIN_ERROR);
    page.click('messageButton');

    assert.equal(page.focusedId(), 'domain');
});

test('closing a message falls back to the domain input when the previously focused element cannot take focus', () => {
    const page = pageWithFilledForm();
    page.focus('loginBtn');

    page.receive('login-error', LOGIN_ERROR);
    page.input('loginBtn').disabled = true;
    page.click('messageButton');

    assert.equal(page.focusedId(), 'domain');
});

test('cancelling the clear history confirmation returns focus to the button that opened it', () => {
    const page = openLoginPage();
    page.receive('config-data', {
        config: { account: 'user', domain: 'nas.example', hasAccessCode: false, useHttps: false },
        history: [{ domain: 'nas.example', account: 'user', useHttps: false }],
    });

    page.click('clearHistoryBtn');
    assert.ok(page.input('customConfirm').classList.contains('show'));
    page.click('confirmCancel');

    assert.equal(page.focusedId(), 'clearHistoryBtn');
});
