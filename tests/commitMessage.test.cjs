const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '..', 'scripts', 'check-commit-message.cjs');

function checkTitle(title) {
    return spawnSync(process.execPath, [script, '-'], { input: `${title}\n`, encoding: 'utf8' });
}

function checkMessageFile(t, message) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-commit-msg-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(file, message);
    return spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
}

test('conventional titles with and without scope are accepted', () => {
    for (const title of [
        'feat(player): 详情页播放键改用 MPV',
        'fix: 修复托盘菜单不刷新',
        'perf(media): 减少海报重复加载',
        'feat(playTarget)!: 移除旧路由标记',
        'chore(main): release 2.7.0',
    ]) {
        assert.equal(checkTitle(title).status, 0, title);
    }
});

test('titles without a known type or description are rejected with a hint', () => {
    for (const title of ['更新代码', '[update] version', 'feature: 新增设置', 'fix:缺空格', 'fix(): 空 scope', 'fix: ']) {
        const result = checkTitle(title);
        assert.equal(result.status, 1, title);
        assert.match(result.stderr, /用户可见的更新日志/, title);
    }
});

test('commit-msg hook reads the first non-comment line', (t) => {
    const message = '# Please enter the commit message\n\nfix(updater): 下载代理默认关闭\n\n正文\n';

    assert.equal(checkMessageFile(t, message).status, 0);
});

test('commit-msg hook lets git-generated merge, revert and autosquash messages through', (t) => {
    for (const message of [
        "Merge branch 'main' into t3/release",
        'Revert "feat(player): 详情页播放键改用 MPV"',
        'fixup! fix(updater): 下载代理默认关闭',
    ]) {
        assert.equal(checkMessageFile(t, message).status, 0, message);
    }
});

test('commit-msg hook rejects an empty message', (t) => {
    assert.equal(checkMessageFile(t, '# only comments\n').status, 1);
});
