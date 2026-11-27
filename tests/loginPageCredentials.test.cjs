const test = require('node:test');
const assert = require('node:assert/strict');
const { openLoginPage } = require('./helpers/loginPage.cjs');

const CONFIG_DATA = {
    config: { account: 'current-user', domain: 'https://nas.example:5667', hasAccessCode: true, useHttps: true },
    history: [
        { domain: 'first.example', account: 'first-user', useHttps: true },
        { domain: 'second.example', account: 'second-user', useHttps: false },
    ],
};
const FIRST_CREDENTIALS = { password: 'first-password', accessCode: 'first-access-code' };
const SECOND_CREDENTIALS = { password: 'second-password', accessCode: 'second-access-code' };
const CURRENT_ACCESS_CODE = {
    domain: 'https://nas.example:5667',
    account: 'current-user',
    accessCode: 'saved-access-code',
};

const requestsOn = (page, channel) => page.invoked.filter((message) => message.channel === channel);
const pendingOn = (page, channel) => page.pending().filter((message) => message.channel === channel);

async function openWithConfig(config = CONFIG_DATA) {
    const page = openLoginPage();
    page.load();
    await page.resolve('get-config', config);
    return page;
}

test('opening the login page restores the saved access code into the form', async () => {
    const page = await openWithConfig();

    assert.equal(requestsOn(page, 'get-current-access-code').length, 1);
    await page.resolve('get-current-access-code', CURRENT_ACCESS_CODE);

    assert.deepEqual(page.form(), {
        domain: 'nas.example:5667',
        username: 'current-user',
        password: '',
        accessCode: 'saved-access-code',
        useHttps: true,
    });
});

test('the login page does not ask for an access code when none is saved', async () => {
    const page = await openWithConfig({ ...CONFIG_DATA, config: { ...CONFIG_DATA.config, hasAccessCode: false } });

    assert.equal(requestsOn(page, 'get-current-access-code').length, 0);
});

test('a saved access code tagged with another login is not filled in', async () => {
    const page = await openWithConfig();

    await page.resolve('get-current-access-code', { ...CURRENT_ACCESS_CODE, account: 'someone-else' });

    assert.equal(page.form().accessCode, '');
});

test('clicking a history entry asks for its credentials and fills the form from the reply', async () => {
    const page = await openWithConfig();

    page.clickHistory(0);

    assert.deepEqual(pendingOn(page, 'get-history-credentials').map((message) => message.payload), [
        { domain: 'first.example', account: 'first-user' },
    ]);
    await page.resolve('get-history-credentials', FIRST_CREDENTIALS);
    assert.deepEqual(page.form(), {
        domain: 'first.example',
        username: 'first-user',
        password: 'first-password',
        accessCode: 'first-access-code',
        useHttps: true,
    });
    assert.equal(page.loginEnabled(), true);
});

test('a late reply for an earlier click never fills the entry clicked last', async () => {
    const page = await openWithConfig();

    page.clickHistory(0);
    page.clickHistory(1);
    await page.resolveAt('get-history-credentials', 1, SECOND_CREDENTIALS);
    await page.resolve('get-history-credentials', FIRST_CREDENTIALS);

    assert.deepEqual(page.form(), {
        domain: 'second.example',
        username: 'second-user',
        password: 'second-password',
        accessCode: 'second-access-code',
        useHttps: false,
    });
});

test('a reply for an earlier click is dropped while the last click is still pending', async () => {
    const page = await openWithConfig();

    page.clickHistory(0);
    page.clickHistory(1);
    await page.resolve('get-history-credentials', FIRST_CREDENTIALS);

    assert.equal(page.form().username, 'second-user');
    assert.equal(page.form().password, '');
    assert.equal(page.form().accessCode, '');
});

test('clicking a history entry clears the previous credentials before the reply arrives', async () => {
    const page = await openWithConfig();
    page.clickHistory(0);
    await page.resolve('get-history-credentials', FIRST_CREDENTIALS);

    page.clickHistory(1);

    assert.equal(page.form().password, '');
    assert.equal(page.form().accessCode, '');
});

test('undecryptable history credentials leave the form blank with no error shown', async () => {
    const page = await openWithConfig();

    page.clickHistory(0);
    await page.resolve('get-history-credentials', { password: '', accessCode: '' });

    assert.equal(page.form().username, 'first-user');
    assert.equal(page.form().password, '');
    assert.equal(page.form().accessCode, '');
    assert.equal(page.input('customMessage').classList.contains('show'), false);
    assert.equal(page.loginEnabled(), false);
});

test('a credential reply does not overwrite what the user typed after clicking', async () => {
    const page = await openWithConfig();

    page.clickHistory(0);
    page.typeInto('password', 'typed-password');
    await page.resolve('get-history-credentials', FIRST_CREDENTIALS);

    assert.equal(page.form().password, 'typed-password');
    assert.equal(page.form().accessCode, '');
});

test('the saved access code does not land on a history entry clicked before it arrived', async () => {
    const page = await openWithConfig();

    page.clickHistory(0);
    await page.resolve('get-current-access-code', CURRENT_ACCESS_CODE);

    assert.equal(page.form().accessCode, '');
});

test('the saved access code does not overwrite an access code the user typed first', async () => {
    const page = await openWithConfig();

    page.typeInto('accessCode', 'typed-access-code');
    await page.resolve('get-current-access-code', CURRENT_ACCESS_CODE);

    assert.equal(page.form().accessCode, 'typed-access-code');
});

test('deleting a history entry reloads the list once the main process removed it', async () => {
    const page = await openWithConfig();

    page.input('historyDropdown').querySelectorAll('.history-delete')[0].dispatch('click');
    page.click('confirmOk');
    assert.deepEqual(pendingOn(page, 'delete-history-item').map((message) => message.payload), [
        { domain: 'first.example', account: 'first-user' },
    ]);
    await page.resolve('delete-history-item', true);

    assert.equal(requestsOn(page, 'get-config').length, 2);
});

test('a failed clear history keeps the list and tells the user', async () => {
    const page = await openWithConfig();

    page.click('clearHistoryBtn');
    page.click('confirmOk');
    await page.reject('clear-history', new Error('disk full'));

    assert.equal(page.input('historyDropdown').querySelectorAll('.history-content').length, 2);
    assert.equal(page.input('messageTitle').textContent, '清除失败');
});

test('login page accepts the same FN ID characters as the main process', () => {
    const page = openLoginPage();
    page.typeInto('username', 'alice');
    page.typeInto('password', 'secret');
    const accepts = (value) => {
        page.typeInto('domain', value);
        return page.loginEnabled();
    };

    for (const value of ['demo123', 'my-nas-01', 'my_nas_01', 'DEMO123', '123456', '  demo123  ', 'a'.repeat(30)]) {
        assert.equal(accepts(value), true, value);
    }

    for (const value of [
        'demo1',
        'a'.repeat(31),
        'demo/123',
        'demo123/../other99',
        'demo?123',
        'demo#123',
        'demo 123',
        'demo\\123',
        'demo%2f123',
        'demo@123',
        'demo:5666',
        '飞牛账号一二三',
    ]) {
        assert.equal(accepts(value), false, value);
    }
});

test('login page accepts domains, IPv4 and bracketed IPv6 addresses with optional ports', () => {
    const page = openLoginPage();
    page.typeInto('username', 'alice');
    page.typeInto('password', 'secret');
    const accepts = (value) => {
        page.typeInto('domain', value);
        return page.loginEnabled();
    };

    for (const value of [
        'nas.example.com',
        'nas.example.com:5667',
        '飞牛.中国',
        '192.168.1.10',
        '192.168.1.10:5666',
        '[fd00::10]',
        '[fd00::10]:5666',
        '[::ffff:192.168.1.10]:5666',
        '[fe80::1%eth0]',
    ]) {
        assert.equal(accepts(value), true, value);
    }

    for (const value of [
        '',
        'nas',
        'nas.example.c0m',
        '256.1.1.1',
        '192.168.1',
        'fd00::10',
        '[fd00::10',
        '[fd00:::10]',
        'https://nas.example.com',
    ]) {
        assert.equal(accepts(value), false, value);
    }
});
