const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PIN_FILES = ['mpv-archive.json', 'README.md', 'docs/external-runtime.md'];

function pinnedArchive(root) {
    return JSON.parse(fs.readFileSync(path.join(root, PIN_FILES[0]), 'utf8'));
}

function assertArchivePinsConsistent(root) {
    const { repo, tag, asset, sha256 } = pinnedArchive(root);
    assert.match(sha256, /^[0-9a-f]{64}$/);
    const readme = fs.readFileSync(path.join(root, PIN_FILES[1]), 'utf8');
    const runtimeDoc = fs.readFileSync(path.join(root, PIN_FILES[2]), 'utf8');
    const tagsIn = text => [...new Set(text.match(/fntv-mpv-v\d{8}_\d{6}/g) ?? [])];
    const assetsIn = text => [...new Set(text.match(/mpv-package-\d{8}_\d{6}\.zip/g) ?? [])];

    assert.ok(readme.includes(`https://github.com/${repo}/releases/download/${tag}/${asset}`),
        'README 的下载命令要用 mpv-archive.json 固定的 tag 和资产名');
    assert.deepEqual(tagsIn(readme), [tag], 'README 只应出现 mpv-archive.json 固定的 tag');
    assert.deepEqual(assetsIn(readme), [asset], 'README 只应出现 mpv-archive.json 固定的资产名');
    assert.deepEqual(tagsIn(runtimeDoc), [tag], 'docs/external-runtime.md 只应出现 mpv-archive.json 固定的 tag');
}

module.exports = { assertArchivePinsConsistent, pinnedArchive, PIN_FILES };
