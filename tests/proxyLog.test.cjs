// Proxy 子进程的日志经 IPC 交给主进程的 logger 写，按字段名的脱敏要和主进程里一样生效。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const logModule = path.resolve(__dirname, '../dest/modules/proxy_service/log.js');
const loggerModule = path.resolve(__dirname, '../dest/modules/logger/logger.js');

// 在子进程里：Proxy 一侧记一条日志，消息经结构化克隆（与 IPC 一样）后由主进程一侧写进 log/app.log。
function logThroughIpc(t, level, message, args) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-proxy-log-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = `
const { ipcLog, writeProxyLog } = require(${JSON.stringify(logModule)});
const { Logger } = require(${JSON.stringify(loggerModule)});
const logger = new Logger();
const log = ipcLog((message) => writeProxyLog(logger, structuredClone(message)));
log[${JSON.stringify(level)}](${JSON.stringify(message)}, ...${args});`;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(path.join(dir, 'log', 'app.log'), 'utf8');
}

test('fields with sensitive names in a Proxy log object are masked like in the main process', (t) => {
    const written = logThroughIpc(t, 'error', 'fn_api 请求失败', `[{ code: 1, msg: 'denied', username: 'someone-private', secret: 'abcdef0123' }]`);

    assert.doesNotMatch(written, /someone-private/);
    assert.doesNotMatch(written, /abcdef0123/);
    assert.match(written, /\[ERROR\] \[Proxy\] fn_api 请求失败/);
    assert.match(written, /denied/);
});

test('a logged error from the Proxy keeps its code and message', (t) => {
    const written = logThroughIpc(t, 'warn', '转发失败', `[Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })]`);

    assert.match(written, /\[WARN\] \[Proxy\] 转发失败/);
    assert.match(written, /ECONNRESET/);
    assert.match(written, /socket hang up/);
});
