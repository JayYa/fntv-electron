const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

// 升级归档时 build.yml 的 env 是唯一来源，README 的准备步骤和 docs/external-runtime.md 都要跟着改。
// tests/mpvArchiveCache.test.cjs 用它检查仓库本身，tests/mpvArchiveUpdate.test.cjs 用它检查
// scripts/update-mpv-archive.cjs 改过的临时副本。这里自己读 YAML，不用脚本的解析。

// 三处文件相对仓库根目录的路径，测试复制临时副本时也用。
const PIN_FILES = ['.github/workflows/build.yml', 'README.md', 'docs/external-runtime.md'];

function pinnedArchive(root) {
    const build = yaml.load(fs.readFileSync(path.join(root, PIN_FILES[0]), 'utf8'));
    return build.jobs.build.env;
}

function assertArchivePinsConsistent(root) {
    const { MPV_CONFIG_REPO, MPV_CONFIG_TAG, MPV_CONFIG_ASSET } = pinnedArchive(root);
    const readme = fs.readFileSync(path.join(root, PIN_FILES[1]), 'utf8');
    const runtimeDoc = fs.readFileSync(path.join(root, PIN_FILES[2]), 'utf8');
    const tagsIn = text => [...new Set(text.match(/fntv-mpv-v\d{8}_\d{6}/g) ?? [])];
    const assetsIn = text => [...new Set(text.match(/mpv-package-\d{8}_\d{6}\.zip/g) ?? [])];

    assert.ok(readme.includes(`https://github.com/${MPV_CONFIG_REPO}/releases/download/${MPV_CONFIG_TAG}/${MPV_CONFIG_ASSET}`),
        'README 的下载命令要用 build.yml 固定的 tag 和资产名');
    assert.deepEqual(tagsIn(readme), [MPV_CONFIG_TAG], 'README 只应出现 build.yml 固定的 tag');
    assert.deepEqual(assetsIn(readme), [MPV_CONFIG_ASSET], 'README 只应出现 build.yml 固定的资产名');
    assert.deepEqual(tagsIn(runtimeDoc), [MPV_CONFIG_TAG], 'docs/external-runtime.md 只应出现 build.yml 固定的 tag');
}

module.exports = { assertArchivePinsConsistent, pinnedArchive, PIN_FILES };
