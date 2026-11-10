const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// 真实报错：Electron 的 BoringSSL 用大写错误名，Node 的 OpenSSL 用小写短语。
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

// 用假 ipcMain 跑真实的 auth.init()，请求打到本机真实的 HTTP 服务。
function setupLogin(t, onConnection = () => {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-https-port-'));
    const paths = { home: testRoot, temp: testRoot, userData: path.join(testRoot, '.fntv') };
    const listeners = new Map();
    const electronMock = {
        app: {
            isPackaged: true,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        ipcMain: {
            on(channel, listener) { listeners.set(channel, listener); },
            handle() {},
            removeAllListeners(channel) { listeners.delete(channel); },
        },
        session: { fromPartition() { return {}; } },
        safeStorage: {
            isEncryptionAvailable() { return true; },
            getSelectedStorageBackend() { return 'gnome_libsecret'; },
            encryptString(value) { return Buffer.from(value, 'utf8'); },
            decryptString(value) { return value.toString('utf8'); },
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

    let connections = 0;
    const server = http.createServer((request, response) => response.end('plain http'));
    server.on('connection', (socket) => {
        connections++;
        onConnection(socket);
    });

    t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        Module._load = originalLoad;
        clearCompiledModules();
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    fs.mkdirSync(paths.userData, { recursive: true });
    clearCompiledModules();
    require('../dest/main/handlers/plugins/auth.js').init();

    return {
        connections: () => connections,
        log: () => fs.readFileSync(path.join(paths.userData, 'logs', 'app.log'), 'utf8'),
        async login() {
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            const domain = `127.0.0.1:${server.address().port}`;
            return new Promise((resolve) => {
                listeners.get('login')({
                    reply(channel, data) { resolve({ channel, data }); },
                }, { domain, username: 'user', password: 'password', useHttps: true });
            });
        },
    };
}

test('login over HTTPS to an HTTP port tells the user to check the HTTPS setting and logs the raw error', async (t) => {
    const login = setupLogin(t);

    const reply = await login.login();

    assert.deepEqual(reply, {
        channel: 'login-error',
        data: { title: '登录失败', message: '无法用 HTTPS 连接到服务器，请检查 HTTPS 设置和端口。' },
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

    assert.equal(reply.channel, 'login-error');
    assert.equal(login.connections(), 6);
});
