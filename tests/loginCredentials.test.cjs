const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
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

// 用假 ipcMain 跑真实的 auth.init()，页面和主进程之间只经过 send 和 event.reply。
function setupAuth(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-login-credentials-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const undecryptable = new Set();
    const listeners = new Map();
    const electronMock = {
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
        },
        ipcMain: {
            on(channel, listener) { listeners.set(channel, listener); },
            handle() {},
            removeAllListeners(channel) { listeners.delete(channel); },
        },
        safeStorage: {
            isEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            encryptString(value) { return Buffer.from(`protected:${value}`, 'utf8'); },
            decryptString(value) {
                const plaintext = value.toString('utf8').slice('protected:'.length);
                if (undecryptable.has(plaintext)) throw new Error('cannot decrypt');
                return plaintext;
            },
        },
    };

    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return electronMock;
        return originalLoad.call(this, request, parent, isMain);
    };
    const clearCompiledModules = () => Object.keys(require.cache)
        .filter((id) => id.includes(`${path.sep}dest${path.sep}`))
        .forEach((id) => delete require.cache[id]);
    t.after(() => {
        Module._load = originalLoad;
        clearCompiledModules();
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    fs.mkdirSync(paths.userData, { recursive: true });
    clearCompiledModules();
    const config = require('../dest/modules/fn_config/config.js');
    require('../dest/main/handlers/plugins/auth.js').init();

    return {
        config,
        undecryptable,
        send(channel, payload, frameUrl = LOGIN_PAGE_URL) {
            const replies = [];
            listeners.get(channel)({
                senderFrame: frameUrl === null ? null : { url: frameUrl },
                reply(replyChannel, data) { replies.push({ channel: replyChannel, data }); },
            }, payload);
            return replies;
        },
    };
}

function seedLogins({ config }) {
    config.saveConfig(CURRENT_LOGIN);
    config.addHistory(FIRST_LOGIN);
    config.addHistory(SECOND_LOGIN);
}

test('config-data lists logins and says whether an access code is saved without sending credentials', (t) => {
    const auth = setupAuth(t);
    seedLogins(auth);

    const [reply] = auth.send('get-config');

    assert.equal(reply.channel, 'config-data');
    assert.doesNotMatch(JSON.stringify(reply.data), SECRETS);
    assert.deepEqual(reply.data, {
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

test('clicking a history entry returns only that entry\'s credentials, keyed by domain and account', (t) => {
    const auth = setupAuth(t);
    seedLogins(auth);

    const replies = auth.send('get-history-credentials', { domain: 'first.example', account: 'first-user' });

    assert.deepEqual(replies, [{
        channel: 'history-credentials',
        data: {
            domain: 'first.example',
            account: 'first-user',
            password: 'first-password',
            accessCode: 'first-access-code',
        },
    }]);
});

test('an account on another domain does not receive the credentials of a same-named entry', (t) => {
    const auth = setupAuth(t);
    seedLogins(auth);

    const [reply] = auth.send('get-history-credentials', { domain: 'second.example', account: 'first-user' });

    assert.deepEqual(reply.data, {
        domain: 'second.example',
        account: 'first-user',
        password: '',
        accessCode: '',
    });
});

test('undecryptable history credentials come back empty so the form stays blank', (t) => {
    const auth = setupAuth(t);
    seedLogins(auth);
    auth.undecryptable.add('first-password');
    auth.undecryptable.add('first-access-code');

    const [reply] = auth.send('get-history-credentials', { domain: 'first.example', account: 'first-user' });

    assert.equal(reply.channel, 'history-credentials');
    assert.equal(reply.data.password, '');
    assert.equal(reply.data.accessCode, '');
});

test('the current access code is available on request and tagged with the current login', (t) => {
    const auth = setupAuth(t);
    seedLogins(auth);

    assert.deepEqual(auth.send('get-current-access-code'), [{
        channel: 'current-access-code',
        data: {
            domain: 'https://nas.example:5667',
            account: 'current-user',
            accessCode: 'saved-access-code',
        },
    }]);
});

test('an undecryptable current access code reads as not saved', (t) => {
    const auth = setupAuth(t);
    seedLogins(auth);
    auth.undecryptable.add('saved-access-code');

    assert.equal(auth.send('get-config')[0].data.config.hasAccessCode, false);
    assert.equal(auth.send('get-current-access-code')[0].data.accessCode, '');
});

for (const [name, frameUrl] of [
    ['a remote page', 'https://nas.example:5667/v'],
    ['an http page named like the login page', 'http://nas.example/resource/login/index.html'],
    ['another local file', pathToFileURL(path.join(os.tmpdir(), 'index.html')).href],
    ['a destroyed frame', null],
    ['a malformed frame url', 'not a url'],
]) {
    test(`credential channels refuse ${name}`, (t) => {
        const auth = setupAuth(t);
        seedLogins(auth);

        assert.deepEqual(
            auth.send('get-history-credentials', { domain: 'first.example', account: 'first-user' }, frameUrl),
            [],
        );
        assert.deepEqual(auth.send('get-current-access-code', undefined, frameUrl), []);
    });
}

test('a credential request without a domain and account is ignored', (t) => {
    const auth = setupAuth(t);
    seedLogins(auth);

    assert.deepEqual(auth.send('get-history-credentials'), []);
    assert.deepEqual(auth.send('get-history-credentials', { domain: 'first.example' }), []);
});

test('the preload bridge allows the credential channels', () => {
    const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf8');
    const [, send] = preload.match(/SEND_CHANNELS = new Set\(\[([^\]]+)\]/);
    const [, receive] = preload.match(/RECEIVE_CHANNELS = new Set\(\[([^\]]+)\]/);

    assert.match(send, /'get-history-credentials'/);
    assert.match(send, /'get-current-access-code'/);
    assert.match(receive, /'history-credentials'/);
    assert.match(receive, /'current-access-code'/);
});
