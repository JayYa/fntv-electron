const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { action, assertRestoreAndSave, posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');

// 安装依赖时 postinstall 不下载 Electron，改由单独的步骤带缓存和重试下载（2026-11-09，PR #140、#139 的 504）。
// ci.yml 和 build.yml 共用 .github/actions/install-dependencies，这里检查 action 本身和两处调用。
const INSTALL = './.github/actions/install-dependencies';

function installSteps() {
    const install = action('install-dependencies');
    return {
        install,
        pnpm: install.steps.find(step => step.name === 'Install dependencies'),
        keys: install.steps.find(step => step.id === 'keys'),
        restore: install.steps.find(step => step.id === 'electron-cache'),
        download: install.steps.find(step => step.name === 'Download Electron binary'),
        save: install.steps.find(step => step.name === 'Save Electron download cache'),
    };
}

// 用桩 node 运行下载步骤：前 failures 次失败，之后写出 path.txt。返回进程结果和桩收到的参数。
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
        'mkdir -p node_modules/electron && printf electron > node_modules/electron/path.txt',
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
    for (const [name, steps, before] of [['ci.yml', ci, 'Run Node tests'], ['build.yml', build, 'Build application']]) {
        const install = steps.filter(step => step.uses === INSTALL);
        assert.equal(install.length, 1, `${name} must install through ${INSTALL}`);
        assert.ok(install[0]['timeout-minutes'] > 0, `${name}: install has no timeout`);
        assert.ok(!steps.some(step => /pnpm install/.test(step.run ?? '')), `${name} runs pnpm install itself`);
        assert.ok(steps.indexOf(install[0]) < steps.findIndex(step => step.name === before), `${name}: install must run before ${before}`);
    }
});

test('the install skips the Electron download in the postinstall and downloads it afterwards', () => {
    // postinstall 里下载遇到 504 时整个 pnpm install 失败，没有重试。
    const { install, pnpm, download } = installSteps();
    assert.equal(install.runs.using, 'composite');
    assert.match(pnpm.run, /^pnpm install --frozen-lockfile$/);
    assert.equal(pnpm.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, '1');
    assert.equal(download.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
    assert.ok(install.steps.indexOf(pnpm) < install.steps.indexOf(download), 'Electron must be downloaded after the install');
    assert.match(download.run, /node node_modules\/electron\/install\.js/);
    // composite action 的步骤不支持 timeout-minutes，写了也不生效。
    assert.ok(install.steps.every(step => step['timeout-minutes'] === undefined));
});

test('the Electron download is cached per Electron version', () => {
    const { install, keys, restore, download, save } = installSteps();
    assertRestoreAndSave(install, restore, save, download);
    assert.ok(install.steps.indexOf(keys) < install.steps.indexOf(restore));
    assert.ok(install.steps.indexOf(restore) < install.steps.indexOf(download), 'Electron cache must be restored before the download');
    assert.equal(keys.run, 'node scripts/ci-download-cache.cjs keys');
    assert.equal(restore.with.key, '${{ steps.keys.outputs.electron-key }}');
    const paths = restore.with.path.trim().split('\n');
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
