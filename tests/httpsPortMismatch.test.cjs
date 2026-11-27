const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { fakeIpcMain } = require('./helpers/fakeIpc.cjs');

const ELECTRON_ERROR = 'write EPROTO 115584:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER:..\..\third_party\boringssl\src\ssl\tls_record.cc:127:\n';
const NODE_ERROR = 'write EPROTO E84B0000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number:openssl\ssl\record\methods\tlsany_meth.c:78:\n';

test('recognizes HTTPS reaching an HTTP port from the raw TLS error', () => {
    const { isHttpsPortMismatch } = require('../dest/modules/fn_api/core/httpsPortMismatch.js');

    assert.equal(isHttpsPortMismatch(ELECTRON_ERROR), true);
    assert.equal(isHttpsPortMismatch(NODE_ERROR), true);
});

test('does not treat other failures as HTTPS reaching an HTTP port', () => {
    const { isHttpsPortMismatch } = require('../dest/modules/fn_api/core/httpsPortMismatch.js');

    assert.equal(isHttpsPortMismatch('connect ECONNREFUSED 192.0.2.10:5666'), false);
    assert.equal(isHttpsPortMismatch('write EPROTO 115584:error:10000410:SSL routines:OPENSSL_internal:SSLV3_ALERT_HANDSHAKE_FAILURE'), false);
    assert.equal(isHttpsPortMismatch('用户名或密码错误'), false);
    assert.equal(isHttpsPortMismatch(undefined), false);
});

function setupLogin(t, onConnection = () => {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-https-port-'));
    const paths = { home: testRoot, temp: testRoot, userData: path.join(testRoot, '.fntv') };
    const ipc = fakeIpcMain();
    const electronMock = {
        app: {
            isPackaged: true,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        ipcMain: ipc.ipcMain,
        session: { fromPartition() { return {}; } },
        safeStorage: {
            async isAsyncEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            async encryptStringAsync(value) { return Buffer.from(value, 'utf8'); },
            async decryptStringAsync(value) { return { result: value.toString('utf8'), shouldReEncrypt: false }; },
        },
    };

    useFakeElectron(t, electronMock);

    let connections = 0;
    const server = http.createServer((request, response) => response.end('plain http'));
    server.on('connection', (socket) => {
        connections++;
        onConnection(socket);
    });

    t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    fs.mkdirSync(paths.userData, { recursive: true });
    ipc.register(require('../dest/main/ipc/login.js').loginHandlers);

    return {
        connections: () => connections,
        log: () => fs.readFileSync(path.join(paths.userData, 'logs', 'app.log'), 'utf8'),
        async login() {
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            const domain = `127.0.0.1:${server.address().port}`;
            return ipc.invoke('login', { domain, username: 'user', password: 'password', useHttps: true });
        },
    };
}

test('login over HTTPS to an HTTP port tells the user to check the HTTPS setting and logs the raw error', async (t) => {
    const login = setupLogin(t);

    const reply = await login.login();

    assert.deepEqual(reply, {
        ok: false,
        error: { title: '登录失败', message: '无法用 HTTPS 连接到服务器，请检查 HTTPS 设置和端口。' },
    });
    assert.match(login.log(), /wrong version number/);
});

test('login stops at the first attempt when HTTPS reaches an HTTP port', async (t) => {
    const login = setupLogin(t);

    await login.login();

    assert.equal(login.connections(), 1);
});

test('login still retries connection failures that can recover', async (t) => {
    const login = setupLogin(t, (socket) => socket.destroy());

    const reply = await login.login();

    assert.equal(reply.ok, false);
    assert.equal(login.connections(), 6);
});
