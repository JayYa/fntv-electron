const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assertRestoreAndSave, posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const downloads = require('../scripts/ci-download-cache.cjs');

// build.yml 打包阶段的下载（2026-11-09，Renovate PR #139 的 504）：缓存 key 只随打包工具版本变，
// 打包命令遇到下载错误时整体重跑，main 上的缓存由 cache-warm.yml 填充。

const root = path.resolve(__dirname, '..');
const CACHE_DIRS = ['~/.cache/electron', '~/Library/Caches/electron', '~/AppData/Local/electron/Cache'];

function tempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function writeProject(dir, { electron = '38.8.6', builder = '26.18.0', lock = '  app-builder-lib@26.18.0:\n' } = {}) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { electron, 'electron-builder': builder } }));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), `packages:\n\n${lock}`);
}

// 桩命令：每次调用记一行参数，按 script 决定输出和退出码。
function stub(bin, name, calls, script) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "$*" >> "${posixPath(calls)}"\n${script}\n`, { mode: 0o755 });
}

function lines(file) {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}

test('the packaging cache key follows the packaging tool versions, not the lockfile', () => {
    const job = workflow('build.yml').jobs.build;
    const restore = job.steps.find(step => step.id === 'packaging-cache');
    const save = job.steps.find(step => step.name === 'Save packaging download cache');
    const prepare = job.steps.find(step => step.name === 'Prepare packaging download cache');
    const build = job.steps.find(step => step.name === 'Build application');
    assertRestoreAndSave(job, restore, save, build);
    assert.equal(restore.with.key, '${{ steps.install.outputs.packaging-key }}');
    // 版本变了时先找同一 Electron 版本的旧缓存，再找同一平台的。
    assert.deepEqual(restore.with['restore-keys'].trim().split('\n'), [
        '${{ steps.install.outputs.packaging-electron-prefix }}',
        '${{ steps.install.outputs.packaging-prefix }}',
    ]);
    assert.ok(job.steps.indexOf(restore) < job.steps.indexOf(prepare) && job.steps.indexOf(prepare) < job.steps.indexOf(build));
    assert.equal(prepare.run, 'node scripts/ci-download-cache.cjs prepare-packaging');
    const paths = restore.with.path.trim().split('\n');
    assert.ok(paths.includes(build.env.ELECTRON_BUILDER_CACHE), 'ELECTRON_BUILDER_CACHE is not cached');
    for (const dir of CACHE_DIRS) assert.ok(paths.includes(dir), `${dir} is not cached`);
});

test('cache keys come from the pinned versions and ignore other lockfile changes', t => {
    const dir = tempDir(t, 'fntv-cache-keys-');
    writeProject(dir);
    const keys = downloads.cacheKeys('Linux', dir);
    assert.equal(keys['electron-key'], 'electron-Linux-38.8.6');
    assert.equal(keys['packaging-key'], 'packaging-Linux-electron-38.8.6-electron-builder-26.18.0-app-builder-lib-26.18.0');
    assert.ok(keys['packaging-key'].startsWith(keys['packaging-electron-prefix']));
    assert.ok(keys['packaging-electron-prefix'].startsWith(keys['packaging-prefix']));
    writeProject(dir, { lock: '  app-builder-lib@26.18.0(dmg-builder@26.18.0):\n  esbuild@0.99.0:\n' });
    assert.deepEqual(downloads.cacheKeys('Linux', dir), keys);
    assert.equal(downloads.cacheKeys('macOS', dir)['electron-key'], 'electron-macOS-38.8.6');
});

test('cache keys refuse version ranges and ambiguous app-builder-lib versions', t => {
    const dir = tempDir(t, 'fntv-cache-keys-');
    writeProject(dir, { electron: '^38.8.6' });
    assert.throws(() => downloads.cacheKeys('Linux', dir), /electron must be pinned/);
    writeProject(dir, { lock: '  app-builder-lib@26.18.0:\n  app-builder-lib@26.17.0:\n' });
    assert.throws(() => downloads.cacheKeys('Linux', dir), /one app-builder-lib version/);
    assert.throws(() => downloads.cacheKeys(undefined, dir), /RUNNER_OS/);
    // 仓库自己的 package.json 和锁文件要能算出 key（Renovate 的 rangeStrategy 是 pin）。
    assert.match(downloads.cacheKeys('Linux', root)['packaging-key'], /^packaging-Linux-electron-\d/);
});

test('preparing the packaging cache seeds checksums and drops other Electron versions', t => {
    const dir = tempDir(t, 'fntv-electron-cache-');
    const cacheRoot = path.join(dir, 'cache');
    const electron = path.join(dir, 'electron');
    fs.mkdirSync(path.join(cacheRoot, 'abc'), { recursive: true });
    fs.mkdirSync(electron);
    fs.writeFileSync(path.join(electron, 'package.json'), JSON.stringify({ version: '38.8.6' }));
    fs.writeFileSync(path.join(electron, 'checksums.json'), JSON.stringify({ 'electron-v38.8.6-linux-x64.zip': 'a'.repeat(64) }));
    for (const name of ['abc/electron-v38.8.6-linux-x64.zip', 'abc/electron-v38.0.0-linux-x64.zip', 'SHASUMS256.txt-38.0.0']) {
        fs.writeFileSync(path.join(cacheRoot, name), '');
    }
    const { file } = downloads.seedChecksums(cacheRoot, path.join(electron, 'checksums.json'));
    const removed = downloads.pruneStaleElectron(cacheRoot, '38.8.6').map(stale => path.relative(cacheRoot, stale).replace(/\\/g, '/'));
    assert.deepEqual(removed.sort(), ['SHASUMS256.txt-38.0.0', 'abc/electron-v38.0.0-linux-x64.zip']);
    assert.equal(path.basename(file), 'SHASUMS256.txt-38.8.6');
    // app-builder-lib 的 parseChecksumFile 认 `<sha256> *<文件名>`。
    assert.equal(fs.readFileSync(file, 'utf8'), `${'a'.repeat(64)} *electron-v38.8.6-linux-x64.zip\n`);
    assert.ok(fs.existsSync(path.join(cacheRoot, 'abc', 'electron-v38.8.6-linux-x64.zip')));
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

test('cache-warm.yml builds on main without uploading, only where caches are missing', () => {
    const warm = workflow('cache-warm.yml');
    assert.deepEqual(warm.on.push.branches, ['main']);
    for (const file of ['package.json', 'pnpm-lock.yaml', 'scripts/ci-download-cache.cjs', '.github/workflows/build.yml']) {
        assert.ok(warm.on.push.paths.includes(file), `${file} does not trigger cache-warm.yml`);
    }
    assert.ok(warm.on.schedule && 'workflow_dispatch' in warm.on);
    assert.equal(warm.jobs.missing.if, "github.ref == 'refs/heads/main'");
    assert.equal(warm.jobs.missing.permissions.actions, 'read');
    assert.equal(warm.jobs.warm.uses, './.github/workflows/build.yml');
    assert.equal(warm.jobs.warm.with.upload, false);
    const upload = workflow('build.yml').jobs.build.steps.find(step => step.name === 'Upload build artifacts');
    assert.equal(upload.if, 'inputs.upload');
    assert.equal(workflow('build.yml').on.workflow_call.inputs.upload.default, true);
});

test('cache-warm.yml warms only the platforms missing a cache on main', t => {
    const dir = tempDir(t, 'fntv-cache-warm-');
    const bin = path.join(dir, 'bin');
    const calls = path.join(dir, 'calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(calls, '');
    // Linux 两个缓存都有，Windows 缺 packaging，macOS 都缺。
    const present = ['electron-Linux-38.8.6', 'packaging-Linux-electron-38.8.6-electron-builder-26.18.0-app-builder-lib-26.18.0', 'electron-Windows-38.8.6'];
    stub(bin, 'gh', calls, `case " $* " in\n${present.map(key => `  *" key=${key} "*) echo 1 ;;`).join('\n')}\n  *) echo 0 ;;\nesac`);
    const result = runStep(t, workflow('cache-warm.yml').jobs.missing, step => step.id === 'missing', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        REPO: 'JayYa/fntv-electron',
        REF: 'refs/heads/main',
    }, cwd => {
        writeProject(cwd);
        fs.mkdirSync(path.join(cwd, 'scripts'));
        fs.copyFileSync(path.join(root, 'scripts', 'ci-download-cache.cjs'), path.join(cwd, 'scripts', 'ci-download-cache.cjs'));
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.outputs.matrix), { include: [
        { platform: 'windows', os: 'windows-latest' },
        { platform: 'macos', os: 'macos-latest' },
    ] });
    assert.equal(lines(calls).length, 6);
    assert.ok(lines(calls).every(call => call.includes('ref=refs/heads/main')));
});
