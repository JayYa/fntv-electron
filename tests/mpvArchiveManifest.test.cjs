// 构建期清单断言（#221）：固定的 MPV 归档解压后，scripts/check-mpv-manifest.cjs 读归档根目录的清单，
// 清单读不出、formatVersion 不受支持、archiveVersion 不是固定的 tag，或 provides 不满足客户端的 requires 时
// 让构建失败。build.yml 在打包前运行它。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeArchive, tempRoot } = require('./helpers/mpvManifestFixture.cjs');
const { root, workflow } = require('./helpers/workflowSteps.cjs');

const SCRIPT = path.join(root, 'scripts', 'check-mpv-manifest.cjs');
const TAG = 'fntv-mpv-v20261114_235035';
const FILES = { 'mpv.conf': 'include="~~/fntv/defaults.conf"\nprofile=fntv-defaults\n', 'scripts/smart_skip/main.lua': 'skip' };
const PROVIDES = { 'smart-skip.origin-from-play-url': 1 };

// 在临时目录里造一份解压好的归档和 mpv-archive.json，运行脚本。
function check(t, { name = TAG, provides = PROVIDES, formatVersion = 1, pinnedTag = TAG, manifest = true } = {}) {
    const dir = tempRoot(t, 'manifest-check');
    const archive = writeArchive(dir, name, { files: FILES, provides, formatVersion });
    if (!manifest) fs.rmSync(archive.manifestPath);
    const pin = path.join(dir, 'mpv-archive.json');
    fs.writeFileSync(pin, JSON.stringify({ repo: 'JayYa/fntv-mpv-config', tag: pinnedTag, asset: 'a.zip', sha256: 'a'.repeat(64) }));
    const result = spawnSync(process.execPath, [SCRIPT, '--archive', path.join(dir, name), '--pin', pin], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
}

test('a pinned archive whose manifest is supported and provides every required capability passes', (t) => {
    const { status, output } = check(t);
    assert.equal(status, 0, output);
    assert.match(output, new RegExp(`${TAG}.*formatVersion 1`));
});

test('the build fails when the manifest does not provide a capability the client requires', (t) => {
    const { status, output } = check(t, { provides: {} });
    assert.equal(status, 1, output);
    assert.match(output, /smart-skip\.origin-from-play-url, 需要 1, 未提供/);
});

test('the build fails when the manifest provides a required capability at a lower version', (t) => {
    const { status, output } = check(t, { provides: { 'smart-skip.origin-from-play-url': 0 } });
    assert.equal(status, 1, output);
    assert.match(output, /smart-skip\.origin-from-play-url, 需要 1, 当前 0/);
});

test('the build fails when the manifest formatVersion is not supported by the client', (t) => {
    const { status, output } = check(t, { formatVersion: 2 });
    assert.equal(status, 1, output);
    assert.match(output, /manifest-unsupported/);
    assert.match(output, /formatVersion 2/);
});

test('the build fails when the archive has no manifest', (t) => {
    const { status, output } = check(t, { manifest: false });
    assert.equal(status, 1, output);
    assert.match(output, /manifest-missing/);
});

test('the build fails when the manifest belongs to another archive than the pinned tag', (t) => {
    const { status, output } = check(t, { name: 'fntv-mpv-v20261110_224319' });
    assert.equal(status, 1, output);
    assert.match(output, /fntv-mpv-v20261110_224319/);
    assert.match(output, new RegExp(TAG));
});

// electron-builder 的 extraFiles 把仓库里的 from 复制到安装目录的 to。这里只认本仓库用的两种写法：
// 单个文件（没有 filter），或目录加 filter ["**/*"]。返回源文件在安装目录里的相对路径，没带上时返回 undefined。
function packagedPath(extraFiles, source) {
    for (const { from, to, filter } of extraFiles) {
        if (from === source && filter === undefined) return to;
        const inside = path.posix.relative(from, source);
        if (!inside.startsWith('..') && JSON.stringify(filter) === '["**/*"]') return path.posix.join(to, inside);
    }
    return undefined;
}

test('every platform packages the manifest where the client looks for it next to the portable config', () => {
    const { resolveManifestPath } = require('../dest/main/common/mpvConfigSync/manifest.js');
    const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const portable = 'third_party/fntv-mpv/portable_config';
    // 安装目录里客户端找清单的位置（相对 resolvePortableConfigDir 的上一级）。
    const expected = path.posix.join(path.posix.dirname(portable), path.basename(resolveManifestPath(portable)));
    for (const platform of ['win', 'mac', 'linux']) {
        const extraFiles = build[platform].extraFiles;
        assert.equal(packagedPath(extraFiles, `${portable}/mpv.conf`), `${portable}/mpv.conf`, `${platform} packages the portable config`);
        assert.equal(packagedPath(extraFiles, 'third_party/fntv-mpv/fntv-manifest.json'), expected, `${platform} packages the manifest`);
    }
});

test('build.yml checks the pinned manifest after compiling and before packaging', () => {
    const { steps } = workflow('build.yml').jobs.build;
    const index = name => steps.findIndex(step => step.name === name);
    const check = steps[index('Check MPV archive manifest')];
    assert.ok(check, 'build.yml has no Check MPV archive manifest step');
    assert.equal(check.run.trim(), 'node scripts/check-mpv-manifest.cjs');
    assert.equal(check['continue-on-error'], undefined, 'the manifest check must fail the build');
    assert.ok(index('Download third-party dependencies') < index('Check MPV archive manifest'));
    assert.ok(index('Compile TypeScript') < index('Check MPV archive manifest'), 'the check requires the compiled sync module');
    assert.ok(index('Check MPV archive manifest') < index('Build application'));
});
