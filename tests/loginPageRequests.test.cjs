const test = require('node:test');
const assert = require('node:assert/strict');
const { loginPageScripts, openLoginPage } = require('./helpers/loginPage.cjs');

const LOGIN_ERROR = { title: '登录失败', message: '用户名或密码错误' };

function pageWithFilledForm() {
    const page = openLoginPage();
    page.load();
    page.typeInto('domain', 'nas.example:5667');
    page.typeInto('username', 'user');
    page.typeInto('password', 'secret');
    return page;
}

const loginRequests = (page) => page.invoked.filter(({ channel }) => channel === 'login');
const shownMessage = (page) => (page.input('customMessage').classList.contains('show')
    ? { title: page.input('messageTitle').textContent, message: page.input('messageContent').textContent }
    : null);

const SNAPSHOT = { appDownloadProxy: { enabled: false, proxyUrl: 'https://gh-proxy.com/' }, mpvPlayback: true, defaultProxyUrl: 'https://gh-proxy.com/' };

function saveMpvPlaybackTurnedOff(page) {
    page.receive('preferences-snapshot', SNAPSHOT);
    page.click('proxySettingsBtn');
    page.input('mpvPlaybackSwitch').checked = false;
    assert.ok(page.input('proxyPanel').classList.contains('show'));
    page.click('proxySaveBtn');
}

test('the login page scripts restore no button on a timer', () => {
    for (const { name, source } of loginPageScripts()) {
        assert.doesNotMatch(source, /setTimeout/, name);
    }
});

test('the login button stays disabled while a login takes longer than five seconds and comes back when it ends', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = pageWithFilledForm();

    page.click('loginBtn');
    t.mock.timers.tick(6000);

    assert.equal(page.loginEnabled(), false);
    assert.equal(page.input('loginBtn').textContent, '登录中...');

    await page.resolve('login', { ok: false, error: LOGIN_ERROR });

    assert.equal(page.loginEnabled(), true);
    assert.notEqual(page.input('loginBtn').textContent, '登录中...');
});

test('the login request carries the form', () => {
    const page = pageWithFilledForm();
    page.input('accessCode').value = 'code';
    page.input('httpsSwitch').checked = true;

    page.click('loginBtn');

    assert.deepEqual(loginRequests(page).map(({ payload }) => payload), [{
        domain: 'nas.example:5667',
        username: 'user',
        password: 'secret',
        accessCode: 'code',
        useHttps: true,
    }]);
});

test('clicking login, pressing Enter or editing the form while a login is in progress sends no second request', () => {
    const page = pageWithFilledForm();

    page.click('loginBtn');
    page.typeInto('password', 'secret2');
    page.click('loginBtn');
    page.focus('password');
    page.press('Enter');

    assert.equal(loginRequests(page).length, 1);
    assert.equal(page.loginEnabled(), false);
});

test('a failed login shows the reason from the main process and enables the button again', async () => {
    const page = pageWithFilledForm();

    page.click('loginBtn');
    await page.resolve('login', { ok: false, error: LOGIN_ERROR });

    assert.deepEqual(shownMessage(page), LOGIN_ERROR);
    assert.equal(page.loginEnabled(), true);
});

test('when the login handler throws, the button comes back and an error is shown', async () => {
    const page = pageWithFilledForm();

    page.click('loginBtn');
    await page.reject('login', new Error("Error invoking remote method 'login': boom"));

    assert.equal(page.loginEnabled(), true);
    assert.equal(shownMessage(page).title, '登录失败');
});

test('a successful login shows no message', async () => {
    const page = pageWithFilledForm();

    page.click('loginBtn');
    await page.resolve('login', { ok: true });

    assert.equal(shownMessage(page), null);
});

test('the update button stays in progress until the main process finishes the check', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = openLoginPage();
    page.load();
    page.input('updateBtn').textContent = '检查更新';

    page.click('updateBtn');
    page.click('updateBtn');
    t.mock.timers.tick(6000);

    assert.equal(page.invoked.filter(({ channel }) => channel === 'check-update').length, 1);
    assert.equal(page.input('updateBtn').disabled, true);
    assert.equal(page.input('updateBtn').textContent, '检查中...');

    await page.resolve('check-update', undefined);

    assert.equal(page.input('updateBtn').disabled, false);
    assert.equal(page.input('updateBtn').textContent, '检查更新');
});

test('when the update check handler throws, the update button comes back and an error is shown', async () => {
    const page = openLoginPage();
    page.load();

    page.click('updateBtn');
    await page.reject('check-update', new Error('boom'));

    assert.equal(page.input('updateBtn').disabled, false);
    assert.equal(shownMessage(page).title, '检查更新失败');
});

test('saving settings closes the panel only after the save is answered', async () => {
    const page = openLoginPage();
    page.load();

    saveMpvPlaybackTurnedOff(page);
    assert.equal(page.input('proxySaveBtn').disabled, true);
    assert.deepEqual(page.pending(), [{ channel: 'set-preferences', payload: { mpvPlayback: false } }]);
    assert.ok(page.input('proxyPanel').classList.contains('show'));

    await page.resolve('set-preferences', { success: true, preferences: { ...SNAPSHOT, mpvPlayback: false } });
    assert.equal(page.input('proxyPanel').classList.contains('show'), false);
    assert.equal(page.input('proxySaveBtn').disabled, false);
    assert.equal(page.input('mpvPlaybackSwitch').checked, false);
    assert.equal(shownMessage(page), null);
});

test('when the settings fail to save, the panel stays open, the button comes back and the failure is shown', async () => {
    const page = openLoginPage();
    page.load();

    saveMpvPlaybackTurnedOff(page);
    await page.resolve('set-preferences', { success: false, error: 'disk full' });

    assert.ok(page.input('proxyPanel').classList.contains('show'));
    assert.equal(page.input('proxySaveBtn').disabled, false);
    assert.equal(shownMessage(page).title, '保存失败');
    assert.match(shownMessage(page).message, /disk full/);
});

test('when the settings handler throws, the panel stays open and the failure is shown', async () => {
    const page = openLoginPage();
    page.load();

    saveMpvPlaybackTurnedOff(page);
    await page.reject('set-preferences', new Error('boom'));

    assert.ok(page.input('proxyPanel').classList.contains('show'));
    assert.equal(page.input('proxySaveBtn').disabled, false);
    assert.equal(shownMessage(page).title, '保存失败');
});

test('saving settings before the preferences have arrived writes nothing and says so', () => {
    const page = openLoginPage();
    page.load();

    page.click('proxySettingsBtn');
    page.click('proxySaveBtn');

    assert.deepEqual(page.pending(), []);
    assert.ok(page.input('proxyPanel').classList.contains('show'));
    assert.equal(shownMessage(page).title, '保存失败');
});

test('a relay address the user only padded with spaces counts as untouched when a tray change arrives', () => {
    const page = openLoginPage();
    page.load();
    page.receive('preferences-snapshot', SNAPSHOT);

    page.click('proxySettingsBtn');
    page.input('proxyUrlInput').value = ' https://gh-proxy.com/ ';
    page.receive('preferences-snapshot', { ...SNAPSHOT, appDownloadProxy: { enabled: true, proxyUrl: 'https://other.example.test/' } });

    assert.equal(page.input('proxyUrlInput').value, 'https://other.example.test/');
});
