const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { fakeIpcMain } = require('./helpers/fakeIpc.cjs');
const { pathToFileURL } = require('node:url');

const LOGIN_PAGE_URL = pathToFileURL(path.join(__dirname, '..', 'resource', 'login', 'index.html')).href;

const CURRENT_LOGIN = {
    account: 'current-user',
    domain: 'https://nas.example:5667',
    token: 'saved-token',
    accessCode: 'saved-access-code',
    useHttps: true,
};
const FIRST_LOGIN = {
    domain: 'first.example',
    account: 'first-user',
    password: 'first-password',
    accessCode: 'first-access-code',
    useHttps: true,
};
const SECOND_LOGIN = {
    domain: 'second.example',
    account: 'second-user',
    password: 'second-password',
    accessCode: 'second-access-code',
    useHttps: false,
};
const SECRETS = /saved-token|saved-access-code|first-password|first-access-code|second-password|second-access-code/;

function setupAuth(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-login-credentials-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const undecryptable = new Set();
    const ipc = fakeIpcMain();
    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        ipcMain: ipc.ipcMain,
        safeStorage: {
            async isAsyncEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            async encryptStringAsync(value) { return Buffer.from(`protected:${value}`, 'utf8'); },
            async decryptStringAsync(value) {
                const plaintext = value.toString('utf8').slice('protected:'.length);
                if (undecryptable.has(plaintext)) throw new Error('cannot decrypt');
                return { result: plaintext, shouldReEncrypt: false };
            },
        },
    };

    useFakeElectron(t, electronMock);
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    fs.mkdirSync(paths.userData, { recursive: true });
    const config = require('../dest/modules/fn_config/loginStore.js');
    ipc.register(require('../dest/main/ipc/login.js').loginHandlers);

    return {
        config,
        undecryptable,
        request: (channel, payload, frameUrl = LOGIN_PAGE_URL) => ipc.invoke(channel, payload, { frameUrl }),
    };
}

async function seedLogins({ config }) {
    for (const entry of [FIRST_LOGIN, SECOND_LOGIN]) {
        await config.saveNewLogin({
            account: entry.account,
            domain: `https://${entry.domain}`,
            token: `${entry.account}-token`,
            accessCode: entry.accessCode,
            useHttps: true,
        }, entry);
    }
    await config.saveCurrentLogin(CURRENT_LOGIN);
}

test('get-config lists logins and says whether an access code is saved without sending credentials', async (t) => {
    const auth = setupAuth(t);
    await seedLogins(auth);

    const config = await auth.request('get-config');

    assert.doesNotMatch(JSON.stringify(config), SECRETS);
    assert.deepEqual(config, {
        config: {
            account: 'current-user',
            domain: 'https://nas.example:5667',
            hasAccessCode: true,
            useHttps: true,
        },
        history: [
            { domain: 'second.example', account: 'second-user', useHttps: false },
            { domain: 'first.example', account: 'first-user', useHttps: true },
        ],
    });
});

test('clicking a history entry returns only the credentials of that entry', async (t) => {
    const auth = setupAuth(t);
    await seedLogins(auth);

    assert.deepEqual(await auth.request('get-history-credentials', { domain: 'first.example', account: 'first-user' }), {
        password: 'first-password',
        accessCode: 'first-access-code',
    });
});

test('an account on another domain does not receive the credentials of a same-named entry', async (t) => {
    const auth = setupAuth(t);
    await seedLogins(auth);

    assert.deepEqual(await auth.request('get-history-credentials', { domain: 'second.example', account: 'first-user' }), {
        password: '',
        accessCode: '',
    });
});

test('undecryptable history credentials come back empty so the form stays blank', async (t) => {
    const auth = setupAuth(t);
    await seedLogins(auth);
    auth.undecryptable.add('first-password');
    auth.undecryptable.add('first-access-code');

    assert.deepEqual(await auth.request('get-history-credentials', { domain: 'first.example', account: 'first-user' }), {
        password: '',
        accessCode: '',
    });
});

test('the current access code is available on request and tagged with the current login', async (t) => {
    const auth = setupAuth(t);
    await seedLogins(auth);

    assert.deepEqual(await auth.request('get-current-access-code'), {
        domain: 'https://nas.example:5667',
        account: 'current-user',
        accessCode: 'saved-access-code',
    });
});

test('an undecryptable current access code reads as not saved', async (t) => {
    const auth = setupAuth(t);
    await seedLogins(auth);
    auth.undecryptable.add('saved-access-code');

    assert.equal((await auth.request('get-config')).config.hasAccessCode, false);
    assert.equal((await auth.request('get-current-access-code')).accessCode, '');
});

for (const [name, frameUrl] of [
    ['a remote page', 'https://nas.example:5667/v'],
    ['an http page named like the login page', 'http://nas.example/resource/login/index.html'],
    ['another local file', pathToFileURL(path.join(os.tmpdir(), 'index.html')).href],
    ['a destroyed frame', null],
    ['a malformed frame url', 'not a url'],
]) {
    test(`credential channels refuse ${name}`, async (t) => {
        const auth = setupAuth(t);
        await seedLogins(auth);

        await assert.rejects(
            auth.request('get-history-credentials', { domain: 'first.example', account: 'first-user' }, frameUrl),
            /不接受这个页面的请求/,
        );
        await assert.rejects(auth.request('get-current-access-code', undefined, frameUrl), /不接受这个页面的请求/);
    });
}

test('a credential request without a domain and account is refused', async (t) => {
    const auth = setupAuth(t);
    await seedLogins(auth);

    await assert.rejects(auth.request('get-history-credentials'), /参数不合法/);
    await assert.rejects(auth.request('get-history-credentials', { domain: 'first.example' }), /参数不合法/);
});
