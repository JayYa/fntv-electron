const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReleaseNotes } = require('../dest/modules/updater/releaseNotes.js');

const REPO = 'https://github.com/JayYa/fntv-electron';

// release-please 17 生成的 Release 说明格式，取自 googleapis/release-please 的 v17.11.0 等 Release，
// 分区标题换成本仓库 release-please-config.json 的中文分区。
const RELEASE_BODY = [
    `## [2.7.0](${REPO}/compare/v2.6.2...v2.7.0) (2026-11-07)`,
    '',
    '',
    '### 新功能',
    '',
    `* **player:** 剧集详情页的播放键改用 MPV 播放 ([#58](${REPO}/issues/58)) ([13fc82e](${REPO}/commit/13fc82e0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6))`,
    `* 支持 \`HTTPS\` 地址的 [FN Connect](https://connect.fnnas.com) 登录 ([a176dfe](${REPO}/commit/a176dfe0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6))`,
    '',
    '',
    '### 问题修复',
    '',
    `* **updater:** 新版本下载链接默认直连 GitHub，修复 [#32](${REPO}/issues/32) 提到的问题 ([ac6a39a](${REPO}/commit/ac6a39a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6)), closes [#30](${REPO}/issues/30) [#31](${REPO}/issues/31)`,
    '',
].join('\n');

test('release-please notes become plain text without version heading, links, or markup', () => {
    assert.equal(formatReleaseNotes(RELEASE_BODY), [
        '新功能',
        '• player: 剧集详情页的播放键改用 MPV 播放',
        '• 支持 HTTPS 地址的 FN Connect 登录',
        '',
        '问题修复',
        '• updater: 新版本下载链接默认直连 GitHub，修复 #32 提到的问题',
    ].join('\n'));
});

test('first release heading without a compare link is also dropped', () => {
    const body = '## 2.7.0 (2026-11-07)\n\n\n### 新功能\n\n* 支持访问码登录 ([0c4ed46](https://github.com/JayYa/fntv-electron/commit/0c4ed46))\n';

    assert.equal(formatReleaseNotes(body), '新功能\n• 支持访问码登录');
});

test('Windows line endings are handled like plain newlines', () => {
    const body = RELEASE_BODY.replace(/\n/g, '\r\n');

    assert.equal(formatReleaseNotes(body), formatReleaseNotes(RELEASE_BODY));
});

for (const [label, body] of [
    ['empty', ''],
    ['whitespace only', '  \n\n  '],
    ['missing', undefined],
    ['null', null],
    ['only a version heading', `## [2.7.0](${REPO}/compare/v2.6.2...v2.7.0) (2026-11-07)\n\n`],
]) {
    test(`${label} release body shows the no-notes placeholder`, () => {
        assert.equal(formatReleaseNotes(body), '暂无更新说明');
    });
}

const TRUNCATION_HINT = '更多内容请点“查看详情”打开 Release 页面查看。';

function manyItems(count) {
    const items = Array.from({ length: count }, (_, i) => `* 改动 ${i + 1} ([abc${String(i).padStart(4, '0')}](${REPO}/commit/abc${i}))`);
    return [`## [2.7.0](${REPO}/compare/v2.6.2...v2.7.0) (2026-11-07)`, '', '### 新功能', '', ...items].join('\n');
}

test('long notes keep the first 15 lines and point to the release page', () => {
    const lines = formatReleaseNotes(manyItems(40)).split('\n');

    assert.equal(lines.length, 17);
    assert.equal(lines[0], '新功能');
    assert.equal(lines[14], '• 改动 14');
    assert.equal(lines[15], '…');
    assert.equal(lines[16], TRUNCATION_HINT);
});

test('notes that fit in 15 lines are not truncated', () => {
    const text = formatReleaseNotes(manyItems(14));

    assert.equal(text.split('\n').length, 15);
    assert.ok(!text.includes(TRUNCATION_HINT));
});

test('a few very long lines are cut at 800 characters and point to the release page', () => {
    const long = '很长的描述'.repeat(100);
    const text = formatReleaseNotes(`### 新功能\n\n* ${long}\n* ${long}\n`);
    const [kept, hint] = text.split('\n…\n');

    assert.ok(kept.length <= 800);
    assert.ok(kept.startsWith('新功能\n• 很长的描述'));
    assert.equal(hint, TRUNCATION_HINT);
});
