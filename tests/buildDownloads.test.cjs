const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { lines, stub, tempDir, writeProject } = require('./helpers/ciCache.cjs');
const downloads = require('../scripts/ci-download-cache.cjs');

// build.yml 打包阶段的下载（2026-11-09，Renovate PR #139 的 504）：打包命令遇到下载错误时整体重跑。
// 打包下载缓存在 2026-11-14 删掉（run 43585290276 对比 43560322186，不命中只多 10 到 14 秒），
// 只留 install-dependencies 的 Electron 下载缓存和 MPV 归档缓存（tests/mpvArchiveCache.test.cjs）。

const root = path.resolve(__dirname, '..');
const CACHE_DIRS = ['~/.cache/electron', '~/Library/Caches/electron', '~/AppData/Local/electron/Cache'];
const LINUX = { os: 'Linux', arch: 'X64' };

test('build.yml caches nothing but the MPV archive', () => {
    const job = workflow('build.yml').jobs.build;
    const caches = job.steps.filter(step => /^actions\/cache(\/(restore|save))?@/.test(step.uses ?? ''));
    assert.deepEqual(caches.map(step => step.id ?? step.with.key), ['mpv-archive-cache', '${{ steps.mpv-archive-cache.outputs.cache-primary-key }}']);
    const build = job.steps.find(step => step.name === 'Build application');
    assert.equal(build.env.ELECTRON_BUILDER_CACHE, undefined);
});

test('checksums are seeded before packaging so a cached zip is verified offline', () => {
    const job = workflow('build.yml').jobs.build;
    const seed = job.steps.find(step => step.name === 'Seed Electron checksums');
    const build = job.steps.find(step => step.name === 'Build application');
    assert.equal(seed.run, 'node scripts/ci-download-cache.cjs seed-checksums');
    assert.ok(job.steps.indexOf(seed) < job.steps.indexOf(build));
});

test('cache keys come from the pinned Electron version and the runner architecture', t => {
    const dir = tempDir(t, 'fntv-cache-keys-');
    writeProject(dir);
    const keys = downloads.cacheKeys(LINUX, dir);
    assert.deepEqual(keys, { 'electron-version': '38.8.6', 'electron-key': 'electron-Linux-X64-38.8.6' });
    writeProject(dir, { builder: '26.99.0', lock: '  app-builder-lib@26.99.0:\n  esbuild@0.99.0:\n' });
    assert.deepEqual(downloads.cacheKeys(LINUX, dir), keys);
    assert.equal(downloads.cacheKeys({ os: 'macOS', arch: 'ARM64' }, dir)['electron-key'], 'electron-macOS-ARM64-38.8.6');
    // Electron zip 只对一种架构有用，key 带架构。
    assert.equal(downloads.cacheKeys({ os: 'Linux', arch: 'ARM64' }, dir)['electron-key'], 'electron-Linux-ARM64-38.8.6');
});

test('cache keys refuse version ranges and a missing runner', t => {
    const dir = tempDir(t, 'fntv-cache-keys-');
    writeProject(dir, { electron: '^38.8.6' });
    assert.throws(() => downloads.cacheKeys(LINUX, dir), /electron must be pinned/);
    assert.throws(() => downloads.cacheKeys(undefined, dir), /RUNNER_OS/);
    assert.throws(() => downloads.cacheKeys({ os: 'Linux' }, dir), /RUNNER_ARCH/);
    // 仓库自己的 package.json 要能算出 key（Renovate 的 rangeStrategy 是 pin）。
    assert.match(downloads.cacheKeys(LINUX, root)['electron-key'], /^electron-Linux-X64-\d/);
});

test('seeding writes SHASUMS256.txt for the installed Electron version', t => {
    const dir = tempDir(t, 'fntv-electron-cache-');
    const cacheRoot = path.join(dir, 'cache');
    const electron = path.join(dir, 'electron');
    fs.mkdirSync(electron);
    fs.writeFileSync(path.join(electron, 'package.json'), JSON.stringify({ version: '38.8.6' }));
    fs.writeFileSync(path.join(electron, 'checksums.json'), JSON.stringify({ 'electron-v38.8.6-linux-x64.zip': 'a'.repeat(64) }));
    const { file, version } = downloads.seedChecksums(cacheRoot, path.join(electron, 'checksums.json'));
    assert.equal(version, '38.8.6');
    assert.equal(path.basename(file), 'SHASUMS256.txt-38.8.6');
    // app-builder-lib 的 parseChecksumFile 认 `<sha256> *<文件名>`。
    assert.equal(fs.readFileSync(file, 'utf8'), `${'a'.repeat(64)} *electron-v38.8.6-linux-x64.zip\n`);
    fs.writeFileSync(path.join(electron, 'checksums.json'), '{}');
    assert.throws(() => downloads.seedChecksums(cacheRoot, path.join(electron, 'checksums.json')), /no checksums/);
});

test('the Electron cache root matches the directories the workflows cache', () => {
    const home = path.join(path.sep, 'home', 'runner');
    const expand = dir => path.join(home, ...dir.slice(2).split('/'));
    assert.equal(downloads.electronCacheRoot('linux', home, {}), expand(CACHE_DIRS[0]));
    assert.equal(downloads.electronCacheRoot('darwin', home, {}), expand(CACHE_DIRS[1]));
    assert.equal(downloads.electronCacheRoot('win32', home, {}), expand(CACHE_DIRS[2]));
});

// 用桩 pnpm 运行打包步骤：前 failures 次输出 error 后失败。
function runBuild(t, failures, error) {
    const dir = tempDir(t, 'fntv-build-retry-');
    const bin = path.join(dir, 'bin');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(calls, '');
    stub(bin, 'pnpm', calls, `[ "$(wc -l < "${posixPath(calls)}")" -gt ${failures} ] && exit 0\necho "  ⨯ ${error}"\nexit 1`);
    const result = runStep(t, workflow('build.yml').jobs.build, step => step.name === 'Build application', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        PLATFORM: 'linux',
        RUNNER_TEMP: posixPath(dir),
        RETRY_DELAY: '0',
    });
    return { result, calls: lines(calls) };
}

test('packaging is retried when a download fails with a 5xx', t => {
    const { result, calls } = runBuild(t, 2, 'Response code 504 (Gateway Time-out)');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(calls, Array(3).fill('run build:linux'));
});

test('packaging gives up after three download failures', t => {
    const { result, calls } = runBuild(t, 99, 'HttpError: 502 Bad Gateway');
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 3);
});

test('packaging is not retried for other errors', t => {
    const { result, calls } = runBuild(t, 99, 'Cannot find module dest/main/main.js');
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 1);
});
