const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assertRestoreAndSave, posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');

// ci.yml 的 Test job：postinstall 不下载 Electron，改由单独的步骤带缓存和重试下载（2026-11-09，PR #140 的 504）。
function ciElectronSteps() {
    const job = workflow('ci.yml').jobs.test;
    return {
        job,
        install: job.steps.find(step => step.name === 'Install dependencies'),
        restore: job.steps.find(step => step.id === 'electron-cache'),
        download: job.steps.find(step => step.name === 'Download Electron binary'),
        save: job.steps.find(step => step.name === 'Save Electron download cache'),
    };
}

// 用桩 node 运行下载步骤：前 failures 次失败，之后写出 path.txt。返回进程结果和桩收到的参数。
function runElectronDownload(t, failures) {
    const { job } = ciElectronSteps();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-electron-download-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bin = path.join(dir, 'bin');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(calls, '');
    fs.writeFileSync(path.join(bin, 'node'), [
        '#!/bin/sh',
        `echo "$1" >> "${posixPath(calls)}"`,
        `[ "$(wc -l < "${posixPath(calls)}")" -gt ${failures} ] || exit 1`,
        'mkdir -p node_modules/electron && printf electron > node_modules/electron/path.txt',
        '',
    ].join('\n'), { mode: 0o755 });
    const result = runStep(t, job, step => step.name === 'Download Electron binary', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        RETRY_DELAY: '0',
    });
    return { result, calls: fs.readFileSync(calls, 'utf8').split(/\r?\n/).filter(Boolean) };
}

test('CI installs dependencies without downloading Electron in the postinstall', () => {
    // postinstall 里下载遇到 504 时整个 pnpm install 失败，没有重试。
    const { job, install, download } = ciElectronSteps();
    assert.equal(install.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, '1');
    assert.ok(download, 'ci.yml has no Download Electron binary step');
    assert.equal(download.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
    assert.ok(job.steps.indexOf(install) < job.steps.indexOf(download), 'Electron must be downloaded after the install');
    const tests = job.steps.find(step => step.name === 'Run Node tests');
    assert.ok(job.steps.indexOf(download) < job.steps.indexOf(tests), 'Electron must be downloaded before the tests');
    assert.match(download.run, /node node_modules\/electron\/install\.js/);
    assert.ok(download['timeout-minutes'] > 0, 'Electron download has no timeout');
});

test('the CI Electron download is cached per Electron version', () => {
    const { job, restore, download, save } = ciElectronSteps();
    assertRestoreAndSave(job, restore, save, download);
    assert.ok(job.steps.indexOf(restore) < job.steps.indexOf(download), 'Electron cache must be restored before the download');
    assert.match(restore.with.key, /\$\{\{\s*runner\.os\s*\}\}/);
    assert.match(restore.with.key, /hashFiles\('node_modules\/electron\/package\.json'\)/);
    const paths = restore.with.path.trim().split('\n');
    for (const dir of ['~/.cache/electron', '~/Library/Caches/electron', '~/AppData/Local/electron/Cache']) {
        assert.ok(paths.includes(dir), `${dir} is not cached`);
    }
});

test('a failed CI Electron download is retried', t => {
    const { result, calls } = runElectronDownload(t, 2);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(calls, Array(3).fill('node_modules/electron/install.js'));
});

test('the CI Electron download fails after five attempts', t => {
    const { result, calls } = runElectronDownload(t, 99);
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 5);
});
