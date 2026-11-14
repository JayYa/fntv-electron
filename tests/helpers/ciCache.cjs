const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { posixPath } = require('./workflowSteps.cjs');

// tests/buildDownloads.test.cjs、tests/ciWorkflow.test.cjs 和 tests/checkCommand.test.cjs 共用：临时项目、桩命令和调用记录。

function tempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// scripts/ci-download-cache.cjs 算 key 要读的 package.json 和锁文件。
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

module.exports = { lines, stub, tempDir, writeProject };
