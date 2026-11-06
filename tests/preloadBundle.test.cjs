const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('every script that produces dest also bundles the preload', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    assert.match(scripts.compile, /build:preload/);
    assert.match(scripts.start, /build:preload/);
    assert.match(scripts.watch, /build-preload\.cjs --watch/);
});
