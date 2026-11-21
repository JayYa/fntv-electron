const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { useFakeModule } = require('./helpers/fakeElectron.cjs');

const root = path.resolve(__dirname, '..');

test('preload statically imports every plugin in alphabetical order', () => {
    const index = fs.readFileSync(path.join(root, 'src', 'preload', 'index.ts'), 'utf8');
    const imported = [...index.matchAll(/^import '\.\/plugins\/([^']+)';$/gm)].map(match => match[1]);
    const plugins = fs.readdirSync(path.join(root, 'src', 'preload', 'plugins'))
        .filter(file => file.endsWith('.ts'))
        .map(file => file.slice(0, -'.ts'.length))
        .sort();

    assert.deepEqual(imported, plugins);

    const reported = index.match(/const PLUGINS = \[([^\]]+)\]/)[1].match(/[A-Za-z]+/g);
    assert.deepEqual(reported, plugins);
});

test('the preload bundle targets the Chrome of the installed Electron', t => {
    const electron = require('electron');
    const result = spawnSync(electron, ['-p', 'process.versions.chrome'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const expected = `chrome${result.stdout.trim().split('.')[0]}`;

    const builds = [];
    useFakeModule(t, 'esbuild', { build: async options => { builds.push(options); } });
    require('../scripts/build-preload.cjs');

    assert.deepEqual(builds.map(options => options.target), [expected], `scripts/build-preload.cjs 的 target 应改为 '${expected}'`);
});

test('the bundled preload requires nothing but electron', () => {
    const bundle = fs.readFileSync(path.join(root, 'dest', 'preload', 'bundle.js'), 'utf8');

    assert.match(bundle, /require\("electron"\)/);
    // 把允许的调用去掉后不能再出现 require，esbuild 的 __require 也算。
    assert.doesNotMatch(bundle.replaceAll('require("electron")', ''), /require/);
});

test('the bundled preload uses no Node globals', () => {
    const bundle = fs.readFileSync(path.join(root, 'dest', 'preload', 'bundle.js'), 'utf8');

    assert.doesNotMatch(bundle, /\b(?:process|__dirname|__filename|Buffer)\b/);
});

test('the login page bridge loads before any plugin', () => {
    const index = fs.readFileSync(path.join(root, 'src', 'preload', 'index.ts'), 'utf8');
    const bridgeImport = index.indexOf("import './loginPageApi';");

    assert.notEqual(bridgeImport, -1);
    assert.ok(bridgeImport < index.indexOf("import './plugins/"));

    const bundle = fs.readFileSync(path.join(root, 'dest', 'preload', 'bundle.js'), 'utf8');
    assert.ok(bundle.indexOf('exposeInMainWorld') < bundle.indexOf('src/preload/plugins/'));
});
