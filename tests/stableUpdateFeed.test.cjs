const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { UPDATE_FEED_URL, UPDATE_METADATA } = require('./helpers/updateFeed.cjs');

// 更新源地址和 3 个更新元数据文件名写进了已发的客户端。这里把 CODING_STANDARDS.md「稳定标识」表里登记的值、
// package.json 的 publish 地址和客户端代码里的更新源钉在一起；release.yml 核对的文件名由 releaseGate.test.cjs 钉住。

const root = path.resolve(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

function stableIdentifiersSection() {
    const standards = read('CODING_STANDARDS.md');
    const start = standards.indexOf('## 稳定标识');
    assert.notEqual(start, -1, 'CODING_STANDARDS.md 没有「稳定标识」一节');
    const end = standards.indexOf('\n## ', start + 1);
    return standards.slice(start, end === -1 ? undefined : end);
}

test('the stable identifiers table lists the update feed and every update metadata file', () => {
    const section = stableIdentifiersSection();
    assert.ok(section.includes('`releases/latest/download/`'), '稳定标识表没有登记更新源 releases/latest/download/');
    assert.ok(section.includes(UPDATE_FEED_URL), '稳定标识表里的更新源地址和固定值不一致');
    for (const name of UPDATE_METADATA) {
        assert.ok(section.includes(`\`${name}\``), `稳定标识表没有登记 ${name}`);
    }
});

test('electron-builder publishes update metadata for the pinned feed', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.deepEqual(pkg.build.publish, { provider: 'generic', url: UPDATE_FEED_URL });
});

test('the client reads updates from the pinned feed', () => {
    const checker = read('src', 'modules', 'updater', 'updateChecker.ts');
    const repository = checker.match(/const UPDATE_REPOSITORY = \{ owner: '([^']+)', repo: '([^']+)' \}/);
    assert.ok(repository, 'updateChecker.ts 里找不到 UPDATE_REPOSITORY');
    assert.ok(checker.includes('`https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases/latest/download/`'),
        'updateChecker.ts 的更新源不再是 UPDATE_REPOSITORY 的 releases/latest/download/');
    assert.equal(`https://github.com/${repository[1]}/${repository[2]}/releases/latest/download/`, UPDATE_FEED_URL);
});
