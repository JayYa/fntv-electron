const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertExitedCleanly } = require('./helpers/childProcess.cjs');

const APP = path.join(__dirname, 'helpers', 'accessCodeCertificateApp.cjs');

function runElectron(t, scenario) {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-access-code-cert-'));
    t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
    const args = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', APP] : [APP];
    const env = { ...process.env, FNTV_ACCESS_CODE_SCENARIO: JSON.stringify({ userData, ...scenario }) };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), args, {
        env,
        encoding: 'utf8',
        timeout: 25000,
    });
    assertExitedCleanly(result);
    const line = result.stdout.split('\n').find(entry => entry.startsWith('{'));
    assert.ok(line, `Electron 没有输出结果：\n${result.stdout}\n${result.stderr}`);
    return JSON.parse(line);
}

test('access code verification on an untrusted certificate asks once and passes after the user trusts it', t => {
    const { attempts, dialogs } = runElectron(t, { answers: ['trust'], attempts: 1 });

    assert.deepEqual(attempts, [{ ok: true, cookie: 'access-session=granted' }]);
    assert.deepEqual(dialogs, ['证书安全警告']);
});

test('cancelling the certificate prompt fails this verification and the next one asks again', t => {
    const { attempts, dialogs } = runElectron(t, { answers: ['cancel', 'trust'], attempts: 2 });

    assert.equal(attempts[0].ok, false);
    assert.equal(attempts[0].reason, 'certificate-declined');
    assert.deepEqual(attempts[1], { ok: true, cookie: 'access-session=granted' });
    assert.deepEqual(dialogs, ['证书安全警告', '证书安全警告']);
});

test('a remembered certificate passes access code verification without asking', t => {
    const { attempts, dialogs } = runElectron(t, { remembered: true, answers: [], attempts: 1 });

    assert.deepEqual(attempts, [{ ok: true, cookie: 'access-session=granted' }]);
    assert.deepEqual(dialogs, []);
});
