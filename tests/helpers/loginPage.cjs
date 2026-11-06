const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LOGIN_DIR = path.join(__dirname, '..', '..', 'resource', 'login');

const readLoginFile = (name) => fs.readFileSync(path.join(LOGIN_DIR, name), 'utf8');

// 文件列表取自 index.html 的引用，还要和目录内容一致。新文件没接进页面或测试读漏时在这里失败，
// 不会让 doesNotMatch 对着空内容通过。
function referencedFiles(tagPattern, extension) {
    const names = [...readLoginFile('index.html').matchAll(tagPattern)].map(([, name]) => name);
    const onDisk = fs.readdirSync(LOGIN_DIR).filter((name) => name.endsWith(extension));
    assert.ok(names.length > 0, `index.html references no ${extension} files`);
    assert.deepEqual([...names].sort(), onDisk.sort());
    return names;
}

function loginPageStyles() {
    return referencedFiles(/<link rel="stylesheet" href="\.\/([^"]+)"/g, '.css')
        .map(readLoginFile)
        .join('\n');
}

module.exports = { loginPageStyles };
