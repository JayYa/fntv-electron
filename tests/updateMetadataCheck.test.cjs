const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

// scripts/check-update-metadata.cjs 在构建 workflow 里打包之后运行，核对 latest*.yml 记录的安装包
// 文件名、size 和 sha512 与输出目录里的实际文件一致。这里用临时目录里的小假安装包运行它。

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'check-update-metadata.cjs');
const INSTALLER = 'FNMedia_9.9.9_win_x64.exe';
const CONTENT = Buffer.from('fake installer');

const sha512Of = buffer => crypto.createHash('sha512').update(buffer).digest('base64');

// electron-builder 生成的 latest.yml 的结构，overrides 改掉其中的字段。
function metadataFor(name, content, overrides = {}) {
    const entry = { url: name, sha512: sha512Of(content), size: content.length, ...overrides.entry };
    return {
        version: '9.9.9',
        files: [entry],
        path: overrides.path ?? name,
        sha512: overrides.sha512 ?? entry.sha512,
        releaseDate: '2026-11-14T00:00:00.000Z',
    };
}

function releaseDir(t, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-update-metadata-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), typeof content === 'string' || Buffer.isBuffer(content) ? content : yaml.dump(content));
    }
    return dir;
}

function check(dir, ...names) {
    return spawnSync(process.execPath, [SCRIPT, dir, ...names], { encoding: 'utf8' });
}

const errorsOf = result => result.stdout.split(/\r?\n/).filter(line => line.startsWith('::error::'));

test('metadata that matches the installers passes and prints one summary line per metadata file', t => {
    const linuxInstaller = 'FNMedia_9.9.9_linux_x86_64.AppImage';
    const dir = releaseDir(t, {
        [INSTALLER]: CONTENT,
        [linuxInstaller]: 'another installer',
        'latest.yml': metadataFor(INSTALLER, CONTENT),
        'latest-linux.yml': metadataFor(linuxInstaller, Buffer.from('another installer')),
    });
    const result = check(dir, 'latest.yml', 'latest-linux.yml');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(errorsOf(result), []);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 2, result.stdout);
    assert.match(lines[0], new RegExp(`^latest\\.yml: .*${INSTALLER.replace(/\./g, '\\.')}`));
    assert.match(lines[1], /^latest-linux\.yml: /);
});

test('a missing installer fails the check', t => {
    const dir = releaseDir(t, { 'latest.yml': metadataFor(INSTALLER, CONTENT) });
    const result = check(dir, 'latest.yml');
    assert.notEqual(result.status, 0);
    const errors = errorsOf(result);
    assert.ok(errors.length > 0, result.stdout);
    for (const error of errors) {
        assert.match(error, /latest\.yml/);
        assert.ok(error.includes(INSTALLER), error);
        assert.match(error, /missing/);
    }
});

test('a size that differs from the installer fails the check with the expected and actual size', t => {
    const dir = releaseDir(t, { [INSTALLER]: CONTENT, 'latest.yml': metadataFor(INSTALLER, CONTENT, { entry: { size: 999 } }) });
    const result = check(dir, 'latest.yml');
    assert.notEqual(result.status, 0);
    assert.deepEqual(errorsOf(result), [`::error::latest.yml: files[0].size expected 999, actual ${CONTENT.length}`]);
});

test('a sha512 that differs from the installer fails the check with the expected and actual hash', t => {
    const wrong = sha512Of(Buffer.from('other bytes'));
    const dir = releaseDir(t, { [INSTALLER]: CONTENT, 'latest.yml': metadataFor(INSTALLER, CONTENT, { entry: { sha512: wrong }, sha512: wrong }) });
    const result = check(dir, 'latest.yml');
    assert.notEqual(result.status, 0);
    assert.deepEqual(errorsOf(result), [`::error::latest.yml: files[0].sha512 expected ${wrong}, actual ${sha512Of(CONTENT)}`]);
});

test('a top-level path that differs from files[0].url fails the check', t => {
    const other = 'FNMedia_9.9.8_win_x64.exe';
    const dir = releaseDir(t, { [INSTALLER]: CONTENT, [other]: CONTENT, 'latest.yml': metadataFor(INSTALLER, CONTENT, { path: other }) });
    const result = check(dir, 'latest.yml');
    assert.notEqual(result.status, 0);
    assert.deepEqual(errorsOf(result), [`::error::latest.yml: path expected ${INSTALLER} (files[0].url), actual ${other}`]);
});

test('a top-level sha512 that differs from files[0].sha512 fails the check', t => {
    const wrong = sha512Of(Buffer.from('other bytes'));
    const dir = releaseDir(t, { [INSTALLER]: CONTENT, 'latest.yml': metadataFor(INSTALLER, CONTENT, { sha512: wrong }) });
    const result = check(dir, 'latest.yml');
    assert.notEqual(result.status, 0);
    assert.deepEqual(errorsOf(result), [`::error::latest.yml: sha512 expected ${sha512Of(CONTENT)} (files[0].sha512), actual ${wrong}`]);
});

test('a missing metadata file fails the check and every requested file is still checked', t => {
    const dir = releaseDir(t, { [INSTALLER]: CONTENT, 'latest.yml': metadataFor(INSTALLER, CONTENT) });
    const result = check(dir, 'latest-linux.yml', 'latest.yml');
    assert.notEqual(result.status, 0);
    assert.deepEqual(errorsOf(result), ['::error::latest-linux.yml: file expected in the output directory, actual missing']);
    assert.match(result.stdout, /^latest\.yml: /m);
});

test('metadata without any files entry fails the check', t => {
    const metadata = metadataFor(INSTALLER, CONTENT);
    metadata.files = [];
    const dir = releaseDir(t, { [INSTALLER]: CONTENT, 'latest.yml': metadata });
    const result = check(dir, 'latest.yml');
    assert.notEqual(result.status, 0);
    assert.deepEqual(errorsOf(result), ['::error::latest.yml: files expected at least one entry, actual 0']);
});
