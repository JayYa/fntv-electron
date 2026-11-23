const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { action, posixPath, runStep, workflow } = require('./helpers/workflowSteps.cjs');

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
    const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
    const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
    for (const script of ['preinstall', 'install', 'postinstall']) {
        assert.equal(pkg.scripts?.[script], undefined, `electron has a ${script} script again`);
    }
    assert.equal(pkg.bin['install-electron'], 'install.js');
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
    assert.equal(pnpm.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
    assert.equal(download.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
    assert.ok(install.steps.indexOf(pnpm) < install.steps.indexOf(download), 'Electron must be downloaded after the install');
    assert.match(download.run, /node node_modules\/electron\/install\.js/);
    assert.equal(download.env?.DEBUG, '@electron/get:*');
    assert.ok(install.steps.every(step => step['timeout-minutes'] === undefined));
});

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
    assert.deepEqual(Object.keys(install.outputs), ['electron-version']);
});

test('every run step of the install action names its shell', () => {
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
