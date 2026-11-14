const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assertRestoreAndSave, posixPath, root, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { assertArchivePinsConsistent } = require('./helpers/mpvArchivePins.cjs');

// MPV 归档按 sha256 缓存：换版本时 key 跟着变，命中缓存也要校验，不通过就重新下载。
function mpvArchiveSteps() {
    const job = workflow('build.yml').jobs.build;
    const cache = job.steps.find(step => step.id === 'mpv-archive-cache');
    const download = job.steps.find(step => step.name === 'Download third-party dependencies');
    const save = job.steps.find(step => step.name === 'Save MPV archive cache');
    return { job, cache, download, save };
}

// 在临时目录里放好缓存的压缩包，用桩代替 curl 和 unzip 运行下载步骤，返回桩被调用的记录。
function runMpvDownload(t, archive, sha256) {
    const { job } = mpvArchiveSteps();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-archive-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bin = path.join(dir, 'bin');
    const temp = path.join(dir, 'temp');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(temp, 'mpv-archive'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'mpv-archive', 'mpv-config.zip'), archive);
    fs.writeFileSync(calls, '');
    for (const tool of ['curl', 'unzip']) {
        fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\necho ${tool} >> "${posixPath(calls)}"\n`, { mode: 0o755 });
    }
    const result = runStep(t, job, step => step.name === 'Download third-party dependencies', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        RUNNER_TEMP: posixPath(temp),
        RUNNER_OS: 'Linux',
        MPV_CONFIG_SHA256: sha256,
    });
    return { result, calls: fs.readFileSync(calls, 'utf8').split(/\r?\n/).filter(Boolean) };
}

test('the MPV archive cache key changes with the archive sha256', () => {
    const { job, cache, download } = mpvArchiveSteps();
    assert.ok(cache, 'build.yml has no mpv-archive-cache step');
    assert.match(cache.with.key, /\$\{\{\s*env\.MPV_CONFIG_SHA256\s*\}\}/);
    assert.match(job.env.MPV_CONFIG_SHA256, /^[0-9a-f]{64}$/);
    assert.ok(job.steps.indexOf(cache) < job.steps.indexOf(download), 'cache must be restored before the download step');
    assert.equal(cache.with.path, '${{ runner.temp }}/mpv-archive');
    assert.match(download.run, /\$RUNNER_TEMP\/mpv-archive\/mpv-config\.zip/);
});

test('the MPV archive is cached as soon as it is downloaded and verified', () => {
    // 后面的构建失败也要保住已下载的压缩包。
    const { job, cache, download, save } = mpvArchiveSteps();
    assertRestoreAndSave(job, cache, save, download);
});

test('a cached MPV archive is verified and used without downloading', t => {
    const archive = Buffer.from('cached archive');
    const sha256 = require('node:crypto').createHash('sha256').update(archive).digest('hex');
    const { result, calls } = runMpvDownload(t, archive, sha256);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(calls, ['unzip']);
});

test('a cached MPV archive that fails verification is downloaded again', t => {
    const { result, calls } = runMpvDownload(t, Buffer.from('corrupted archive'), '0'.repeat(64));
    // 桩 curl 不写文件，重新下载后的校验失败，步骤也要失败。
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls, ['curl']);
});

// 升级归档时 build.yml 的 env 是唯一来源，README 的准备步骤和 docs/external-runtime.md 都要跟着改
//（scripts/update-mpv-archive.cjs 一起改，tests/mpvArchiveUpdate.test.cjs）。
test('README and docs/external-runtime.md pin the same MPV archive as build.yml', () => {
    assertArchivePinsConsistent(root);
});
