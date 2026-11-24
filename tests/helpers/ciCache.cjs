const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { posixPath } = require('./workflowSteps.cjs');

function tempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function writeProject(dir, { electron = '38.8.6', builder = '26.18.0', lock = '  app-builder-lib@26.18.0:\n' } = {}) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { electron, 'electron-builder': builder } }));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), `packages:\n\n${lock}`);
}

function stub(bin, name, calls, script) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "$*" >> "${posixPath(calls)}"\n${script}\n`, { mode: 0o755 });
}

function lines(file) {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}

module.exports = { lines, stub, tempDir, writeProject };
