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
});
