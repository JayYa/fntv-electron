const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

function runBundledPreload(protocol) {
    const bundle = fs.readFileSync(path.join(root, 'dest', 'preload', 'bundle.js'), 'utf8');
    const exposed = {};
    const electron = {
        contextBridge: { exposeInMainWorld(name, value) { exposed[name] = value; } },
        ipcRenderer: { send() {}, on() {}, once() {}, off() {}, invoke: async () => undefined },
    };
    const context = {
        window: { location: { protocol }, addEventListener() {} },
        document: { readyState: 'loading', addEventListener() {} },
        console,
        setTimeout,
        clearTimeout,
        require(name) {
            assert.equal(name, 'electron');
            return electron;
        },
        module: { exports: {} },
    };
    vm.createContext(context);
    vm.runInContext(bundle, context);
    return exposed;
}

test('the login page bridge checks FN IDs synchronously with the main process rule', () => {
    const { electronAPI } = runBundledPreload('file:');
    const { isFnId } = require('../dest/public/fnId.js');

    for (const value of ['demo123', '  demo123  ', 'demo1', 'nas.example.com', '192.168.1.10', '[fd00::10]:5666', '']) {
        assert.equal(electronAPI.isFnId(value), isFnId(value), value);
    }
    assert.equal(electronAPI.isFnId('  demo123  '), true);
    assert.equal(electronAPI.isFnId(''), false);
});

test('pages other than the login page get no bridge', () => {
    assert.deepEqual(Object.keys(runBundledPreload('https:')), []);
});

test('the login page bridge loads before any plugin', () => {
    const index = fs.readFileSync(path.join(root, 'src', 'preload', 'index.ts'), 'utf8');
    const bridgeImport = index.indexOf("import './loginPageApi';");

    assert.notEqual(bridgeImport, -1);
    assert.ok(bridgeImport < index.indexOf("import './plugins/"));

    const bundle = fs.readFileSync(path.join(root, 'dest', 'preload', 'bundle.js'), 'utf8');
    assert.ok(bundle.indexOf('exposeInMainWorld') < bundle.indexOf('src/preload/plugins/'));
});
