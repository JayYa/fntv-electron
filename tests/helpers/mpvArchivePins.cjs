const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 升级归档时 mpv-archive.json 是唯一来源（build.yml 从它读），README 的准备步骤和 docs/external-runtime.md
// 都要跟着改。tests/mpvArchiveCache.test.cjs 用它检查仓库本身，tests/mpvArchiveUpdate.test.cjs 用它检查
// scripts/update-mpv-archive.cjs 改过的临时副本。这里自己读文件，不用脚本的解析。

// 三处文件相对仓库根目录的路径，测试复制临时副本时也用。都不在 .github/workflows 下：
// GITHUB_TOKEN 推不了改 workflow 的提交，update-mpv-archive.yml 会开不了 PR（2026-11-14 实际失败过）。
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
