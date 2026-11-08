const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveTarget, findInstaller, findAppExecutable } = require('./smoke/targets.cjs');

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-targets-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function touch(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
}

test('each macOS smoke target picks the dmg of its own architecture from the macOS build', t => {
    // build:mac 一次产出两个 dmg 和各自的 blockmap（package.json 的 artifactName）。
    const release = tempDir(t);
    for (const name of [
        'FNMedia_2.7.1_mac_x64.dmg',
        'FNMedia_2.7.1_mac_x64.dmg.blockmap',
        'FNMedia_2.7.1_mac_arm64.dmg',
        'FNMedia_2.7.1_mac_arm64.dmg.blockmap',
    ]) {
        touch(path.join(release, name));
    }

    assert.equal(findInstaller(resolveTarget('darwin-x64'), release), path.join(release, 'FNMedia_2.7.1_mac_x64.dmg'));
    assert.equal(findInstaller(resolveTarget('darwin-arm64'), release), path.join(release, 'FNMedia_2.7.1_mac_arm64.dmg'));
});

test('the executable to launch is the one inside the .app at the root of the mounted dmg', t => {
    // dmg 根目录有 .app 和指向 /Applications 的链接（package.json 的 dmg.contents）。
    const volume = tempDir(t);
    touch(path.join(volume, '飞牛影视.app', 'Contents', 'MacOS', '飞牛影视'));
    touch(path.join(volume, '飞牛影视.app', 'Contents', 'Info.plist'));
    touch(path.join(volume, '.background', 'background.tiff'));

    assert.equal(findAppExecutable(volume), path.join(volume, '飞牛影视.app', 'Contents', 'MacOS', '飞牛影视'));
});

test('a mounted dmg without exactly one .app is reported with what it contains', t => {
    const volume = tempDir(t);
    touch(path.join(volume, 'README.txt'));

    assert.throws(() => findAppExecutable(volume), /\.app.*README\.txt/s);
});
