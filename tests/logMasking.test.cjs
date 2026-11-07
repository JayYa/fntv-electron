const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { maskStringByPatterns, maskSensitiveData } = require('../dest/modules/logger/masking.js');
const { describeFnIdPageForLog } = require('../dest/main/handlers/core/fnIdTrust.js');

const loggerModule = path.resolve(__dirname, '../dest/modules/logger/logger.js');

function writeNoformat(t, message) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-log-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = `const { Logger } = require(${JSON.stringify(loggerModule)});
new Logger().noformat(${JSON.stringify(message)});`;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(path.join(dir, 'log', 'app.log'), 'utf8');
}

test('keeps only the first two parts of an IP address', () => {
    assert.equal(maskStringByPatterns('peer 192.168.0.110 up'), 'peer 192.168.***.** up');
    assert.equal(maskStringByPatterns('peer 10.0.0.12 up'), 'peer 10.0.***.** up');
});

test('masks an IP address inside a URL-encoded redirect_uri', () => {
    const masked = maskStringByPatterns(
        'http://nas.local/signin?client_id=abc&redirect_uri=http%3A%2F%2F192.168.0.110%3A5666%2Fv%2Foauth%2Fresult',
    );
    assert.doesNotMatch(masked, /0\.110/);
    assert.match(masked, /client_id=abc/);
});

test('masks a host name inside a URL-encoded redirect_uri', () => {
    const masked = maskStringByPatterns('/signin?redirect_uri=https%3A%2F%2Fmynas.fnos.net%2Fv%2Foauth%2Fresult');
    assert.doesNotMatch(masked, /mynas/);
});

test('masks usernames in logged objects', () => {
    assert.doesNotMatch(JSON.stringify(maskSensitiveData({ username: 'someone-private' })), /someone-private/);
});

test('masks proxy output written without formatting', t => {
    const written = writeNoformat(
        t,
        '2026-11-07 14:22:21.271 INFO  [utils.go:171] 代理请求 method=GET host=192.168.0.110:5666 path=/v/api/v1/media/range/b9dc range=bytes=0-\n',
    );
    assert.doesNotMatch(written, /0\.110/);
    assert.match(written, /host[^ ]*:5666 path=/);
});

test('keeps proxy source locations and timestamps readable', t => {
    const line = '2026-11-07 14:22:21.271 INFO  [playvideo.go:173] 开始代理 | 模式: 0 | itemGuid: 32e8f905f68940648a6b46abb93809b3\n';
    assert.equal(writeNoformat(t, line).trim(), line.trim());
});

test('hides the FN ID in logged page paths', () => {
    assert.equal(describeFnIdPageForLog('https://5ddd.com/Some-Fnid', 'some-fnid'), '/(FN ID)');
    assert.equal(describeFnIdPageForLog('https://5ddd.com/some-fnid/next', 'some-fnid'), '/(FN ID)/next');
});

test('logged page paths drop the query string and keep hash routes', () => {
    assert.equal(describeFnIdPageForLog('http://nas/signin?code=secret', 'some-fnid'), '/signin');
    assert.equal(describeFnIdPageForLog('http://nas/#/login?state=secret', 'some-fnid'), '/#/login');
    assert.equal(describeFnIdPageForLog('not a url', 'some-fnid'), '(无效地址)');
});
