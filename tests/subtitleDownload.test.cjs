const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron, useFakeModule } = require('./helpers/fakeElectron.cjs');

function recordingLog() {
    const lines = [];
    const record = (message, ...args) => lines.push([message, ...args].map(String).join(' '));
    return { lines, debug: record, info: record, warn: record, error: record };
}

function summary(lines) {
    const start = lines.indexOf('字幕下载摘要:');
    assert.notEqual(start, -1, 'no subtitle download summary was logged');
    const summaryLines = lines.slice(start + 1);
    const count = (label) => {
        const line = summaryLines.find((candidate) => new RegExp(`${label}: \\d+$`).test(candidate));
        assert.ok(line, `the summary has no ${label} line`);
        return Number(line.split(':').pop().trim());
    };
    return { total: count('总数'), downloaded: count('新下载'), skipped: count('跳过'), failed: count('失败') };
}

test('the subtitle download summary counts existing files as skipped, new files as downloaded and server errors as failed', async (t) => {
    const log = recordingLog();
    useFakeElectron(t, { app: { getPath: () => os.tmpdir() } });
    useFakeModule(t, '../logger', log);
    const { ApiService } = require('../dest/modules/fn_api/api.js');

    const server = http.createServer((req, res) => {
        if (req.url.endsWith('/sub-b')) {
            res.setHeader('Content-Type', 'text/plain');
            res.end('1\n00:00:01,000 --> 00:00:02,000\nB\n');
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 1, msg: 'subtitle missing', data: null }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-subtitles-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const existing = path.join(dir, 'Chinese@sub-a.srt');
    fs.writeFileSync(existing, 'A');

    const api = new ApiService(`http://127.0.0.1:${server.address().port}`, 'token-1', dir);
    const paths = await api.downloadSubtitle([
        { id: 'sub-a', name: 'Chinese', format: 'srt' },
        { id: 'sub-b', name: 'English', format: 'srt' },
        { id: 'sub-c', name: 'French', format: 'ass' },
    ]);

    assert.deepEqual(summary(log.lines), { total: 3, downloaded: 1, skipped: 1, failed: 1 });
    assert.deepEqual(paths, [existing, path.join(dir, 'English@sub-b.srt')]);
});
