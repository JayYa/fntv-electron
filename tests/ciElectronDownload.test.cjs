const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { action, posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');

// Electron 二进制由安装依赖之后的单独步骤带缓存和重试下载（2026-11-09，PR #140、#139 的 504）。
// electron 42 起没有 postinstall，二进制在第一次 require('electron') 时按需下载，只试一次；
// 预先下载保证测试和打包不走这条没有重试的路径（Electron 45 升级）。
// ci.yml 和 build.yml 共用 .github/actions/install-dependencies，这里检查 action 本身和两处调用。
const INSTALL = './.github/actions/install-dependencies';

function installSteps() {
    const install = action('install-dependencies');
    return {
        install,
        pnpm: install.steps.find(step => step.name === 'Install dependencies'),
        keys: install.steps.find(step => step.id === 'keys'),
        cache: install.steps.find(step => step.id === 'electron-cache'),
        download: install.steps.find(step => step.name === 'Download Electron binary'),
    };
}

// 用桩 node 运行下载步骤：前 failures 次失败，之后写出 path.txt 和 dist/version。返回进程结果和桩收到的参数。
function runElectronDownload(t, failures) {
    const { install } = installSteps();
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
        'mkdir -p node_modules/electron/dist && printf electron > node_modules/electron/path.txt',
        'printf v45.0.0 > node_modules/electron/dist/version',
        '',
    ].join('\n'), { mode: 0o755 });
    const result = runStep(t, install, step => step.name === 'Download Electron binary', {
        PATH: `${posixPath(bin)}:/usr/bin:${process.env.PATH}`,
        RETRY_DELAY: '0',
    });
    return { result, calls: fs.readFileSync(calls, 'utf8').split(/\r?\n/).filter(Boolean) };
}

test('ci.yml and build.yml install dependencies through the shared action', () => {
    // 两份各写一遍时，build.yml 漏改过一次（#143 只改了 ci.yml），Renovate PR #139 的构建因此失败。
    const ci = workflow('ci.yml').jobs.test.steps;
    const build = workflow('build.yml').jobs.build.steps;
    for (const [name, steps, before] of [['ci.yml', ci, 'Run checks'], ['build.yml', build, 'Build application']]) {
        const install = steps.filter(step => step.uses === INSTALL);
        assert.equal(install.length, 1, `${name} must install through ${INSTALL}`);
        assert.ok(install[0]['timeout-minutes'] > 0, `${name}: install has no timeout`);
        assert.ok(!steps.some(step => /pnpm install/.test(step.run ?? '')), `${name} runs pnpm install itself`);
        assert.ok(steps.indexOf(install[0]) < steps.findIndex(step => step.name === before), `${name}: install must run before ${before}`);
    }
});

test('the electron package downloads its binary on demand, not at install time', () => {
    // 下载步骤依赖这几点：安装依赖时不下载，install.js 还在。electron 重新加回安装脚本或去掉 install.js 时，
    // 这里失败，提醒重新核对下载步骤。
    const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
    const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
    for (const script of ['preinstall', 'install', 'postinstall']) {
        assert.equal(pkg.scripts?.[script], undefined, `electron has a ${script} script again`);
    }
    assert.equal(pkg.bin['install-electron'], 'install.js');
    // index.js 在二进制不在时自己运行 install.js 下载，不重试。
    assert.match(fs.readFileSync(path.join(electronDir, 'index.js'), 'utf8'), /install\.js/);
});

test('no workflow sets the ELECTRON_SKIP_BINARY_DOWNLOAD that electron no longer reads', () => {
    const github = path.join(__dirname, '..', '.github');
    const files = [
        ...fs.readdirSync(path.join(github, 'workflows')).map(name => path.join(github, 'workflows', name)),
        ...fs.readdirSync(path.join(github, 'actions')).map(name => path.join(github, 'actions', name, 'action.yml')),
    ];
    for (const file of files) {
        const code = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => !line.trimStart().startsWith('#'));
        assert.ok(!code.some(line => line.includes('ELECTRON_SKIP_BINARY_DOWNLOAD')), path.relative(github, file));
    }
});

test('the install action downloads Electron after installing dependencies', () => {
    const { install, pnpm, download } = installSteps();
    assert.equal(install.runs.using, 'composite');
    assert.match(pnpm.run, /^pnpm install --frozen-lockfile$/);
    // electron 42 起不读 ELECTRON_SKIP_BINARY_DOWNLOAD，写了也不生效。
    assert.equal(pnpm.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
    assert.equal(download.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
    assert.ok(install.steps.indexOf(pnpm) < install.steps.indexOf(download), 'Electron must be downloaded after the install');
    assert.match(download.run, /node node_modules\/electron\/install\.js/);
    // 日志里要能看到 @electron/get 的 Cache hit / Cache miss。
    assert.equal(download.env?.DEBUG, '@electron/get:*');
    // composite action 的步骤不支持 timeout-minutes，写了也不生效。
    assert.ok(install.steps.every(step => step['timeout-minutes'] === undefined));
});

// 单步 actions/cache，job 结束时由 post 步骤保存（2026-11-14）。key 带架构，见 tests/buildDownloads.test.cjs。
test('the Electron download is cached per Electron version and runner architecture', () => {
    const { install, keys, cache, download } = installSteps();
    assert.match(cache.uses, /^actions\/cache@[0-9a-f]{40}$/);
    assert.equal(cache['continue-on-error'], true);
    assert.ok(!install.steps.some(step => /^actions\/cache\/(restore|save)@/.test(step.uses ?? '')), 'use one actions/cache step');
    assert.ok(install.steps.indexOf(keys) < install.steps.indexOf(cache));
    assert.ok(install.steps.indexOf(cache) < install.steps.indexOf(download), 'Electron cache must be restored before the download');
    assert.equal(keys.run, 'node scripts/ci-download-cache.cjs keys');
    assert.equal(cache.with.key, '${{ steps.keys.outputs.electron-key }}');
    const paths = cache.with.path.trim().split('\n');
    for (const dir of ['~/.cache/electron', '~/Library/Caches/electron', '~/AppData/Local/electron/Cache']) {
        assert.ok(paths.includes(dir), `${dir} is not cached`);
    }
    for (const output of ['packaging-key', 'packaging-electron-prefix', 'packaging-prefix']) {
        assert.equal(install.outputs[output].value, `\${{ steps.keys.outputs.${output} }}`);
    }
});

test('every run step of the install action names its shell', () => {
    // composite action 里的 run 步骤必须写 shell，Windows 上 bash 语法也要靠它。
    for (const step of installSteps().install.steps.filter(step => step.run)) {
        assert.equal(step.shell, 'bash', step.name);
    }
});

test('a failed Electron download is retried', t => {
    const { result, calls } = runElectronDownload(t, 2);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(calls, Array(3).fill('node_modules/electron/install.js'));
});

test('the Electron download fails after five attempts', t => {
    const { result, calls } = runElectronDownload(t, 99);
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 5);
});
