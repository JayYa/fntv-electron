const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// 在新进程里取一次 HTTPS NAS 的流，返回 MPV 收到的状态码。env 覆盖证书相关的环境变量。
function probeTls(mode, env = {}) {
    const cleanEnv = { ...process.env };
    for (const name of ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_OPTIONS']) delete cleanEnv[name];
    const output = execFileSync(process.execPath, [path.join(__dirname, 'helpers', 'proxyTlsProbe.cjs'), mode], {
        env: { ...cleanEnv, ...env },
        encoding: 'utf8',
    });
    return Number(output);
}

test('skipVerify from the session lets an untrusted NAS certificate through', () => {
    assert.equal(probeTls('skipVerify'), 200);
});

test('without skipVerify an NAS certificate from an unknown CA is rejected', () => {
    assert.equal(probeTls('verify'), 500);
});

// Linux 上系统证书库由 SSL_CERT_FILE 指定，能在测试里装入私有 CA；Windows 和 macOS 要改系统设置，不在这里测。
test('an NAS certificate signed by a CA in the system store is accepted without skipVerify', { skip: process.platform !== 'linux' }, () => {
    assert.equal(probeTls('verify', { SSL_CERT_FILE: path.join(__dirname, 'fixtures', 'tls', 'ca.pem') }), 200);
});
