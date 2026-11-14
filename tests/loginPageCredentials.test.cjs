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
const FIRST_CREDENTIALS = {
    domain: 'first.example',
    account: 'first-user',
    password: 'first-password',
    accessCode: 'first-access-code',
};
const SECOND_CREDENTIALS = {
    domain: 'second.example',
    account: 'second-user',
    password: 'second-password',
    accessCode: 'second-access-code',
};
const CURRENT_ACCESS_CODE = {
    domain: 'https://nas.example:5667',
    account: 'current-user',
    accessCode: 'saved-access-code',
};

const requestsOn = (page, channel) => page.sent.filter((message) => message.channel === channel);

test('opening the login page restores the saved access code into the form', () => {
    const page = openLoginPage();

    page.receive('config-data', CONFIG_DATA);
    assert.equal(requestsOn(page, 'get-current-access-code').length, 1);
    page.receive('current-access-code', CURRENT_ACCESS_CODE);

    assert.deepEqual(page.form(), {
        domain: 'nas.example:5667',
        username: 'current-user',
        password: '',
        accessCode: 'saved-access-code',
        useHttps: true,
    });
});

test('the login page does not ask for an access code when none is saved', () => {
    const page = openLoginPage();

    page.receive('config-data', { ...CONFIG_DATA, config: { ...CONFIG_DATA.config, hasAccessCode: false } });

    assert.equal(requestsOn(page, 'get-current-access-code').length, 0);
});

test('clicking a history entry asks for its credentials and fills the form from the reply', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);

    page.clickHistory(0);

    assert.deepEqual(requestsOn(page, 'get-history-credentials').map((message) => message.payload), [
        { domain: 'first.example', account: 'first-user' },
    ]);
    page.receive('history-credentials', FIRST_CREDENTIALS);
    assert.deepEqual(page.form(), {
        domain: 'first.example',
        username: 'first-user',
        password: 'first-password',
        accessCode: 'first-access-code',
        useHttps: true,
    });
    assert.equal(page.loginEnabled(), true);
});

test('a late reply for an earlier click never fills the entry clicked last', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);

    page.clickHistory(0);
    page.clickHistory(1);
    page.receive('history-credentials', SECOND_CREDENTIALS);
    page.receive('history-credentials', FIRST_CREDENTIALS);

    assert.deepEqual(page.form(), {
        domain: 'second.example',
        username: 'second-user',
        password: 'second-password',
        accessCode: 'second-access-code',
        useHttps: false,
    });
});

test('a reply for an earlier click is dropped while the last click is still pending', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);

    page.clickHistory(0);
    page.clickHistory(1);
    page.receive('history-credentials', FIRST_CREDENTIALS);

    assert.equal(page.form().username, 'second-user');
    assert.equal(page.form().password, '');
    assert.equal(page.form().accessCode, '');
});

test('clicking a history entry clears the previous credentials before the reply arrives', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);
    page.clickHistory(0);
    page.receive('history-credentials', FIRST_CREDENTIALS);

    page.clickHistory(1);

    assert.equal(page.form().password, '');
    assert.equal(page.form().accessCode, '');
});

test('undecryptable history credentials leave the form blank with no error shown', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);

    page.clickHistory(0);
    page.receive('history-credentials', { ...FIRST_CREDENTIALS, password: '', accessCode: '' });

    assert.equal(page.form().username, 'first-user');
    assert.equal(page.form().password, '');
    assert.equal(page.form().accessCode, '');
    assert.equal(page.input('customMessage').classList.contains('show'), false);
    assert.equal(page.loginEnabled(), false);
});

test('a credential reply does not overwrite what the user typed after clicking', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);

    page.clickHistory(0);
    page.typeInto('password', 'typed-password');
    page.receive('history-credentials', FIRST_CREDENTIALS);

    assert.equal(page.form().password, 'typed-password');
    assert.equal(page.form().accessCode, '');
});

test('the saved access code does not land on a history entry clicked before it arrived', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);

    page.clickHistory(0);
    page.receive('current-access-code', CURRENT_ACCESS_CODE);

    assert.equal(page.form().accessCode, '');
});

test('the saved access code does not overwrite an access code the user typed first', () => {
    const page = openLoginPage();
    page.receive('config-data', CONFIG_DATA);

    page.typeInto('accessCode', 'typed-access-code');
    page.receive('current-access-code', CURRENT_ACCESS_CODE);

    assert.equal(page.form().accessCode, 'typed-access-code');
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
