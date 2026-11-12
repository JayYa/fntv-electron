const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TARGETS, resolveTarget, findInstaller, findAppExecutable, checkWindowsInstallAllowed } = require('./smoke/targets.cjs');

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
    // build:mac 一次产出两个 dmg（package.json 的 artifactName）。3.1.0 及以前每个 dmg 旁边还有 blockmap，
    // 之后由 dmg.writeUpdateInfo: false 关掉，旁边有 blockmap 时也只挑 dmg。
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

test('each Linux smoke target picks the AppImage of its own architecture from the Linux build', t => {
    // build:linux 一次产出两个 AppImage，x64 的文件名架构是 x86_64（package.json 的 artifactName）。
    const release = tempDir(t);
    for (const name of [
        'FNMedia_2.7.1_linux_x86_64.AppImage',
        'FNMedia_2.7.1_linux_x86_64.AppImage.blockmap',
        'FNMedia_2.7.1_linux_arm64.AppImage',
        'FNMedia_2.7.1_linux_arm64.AppImage.blockmap',
    ]) {
        touch(path.join(release, name));
    }

    assert.equal(findInstaller(resolveTarget('linux-x64'), release), path.join(release, 'FNMedia_2.7.1_linux_x86_64.AppImage'));
    assert.equal(findInstaller(resolveTarget('linux-arm64'), release), path.join(release, 'FNMedia_2.7.1_linux_arm64.AppImage'));
});

// 本机按用户装过的客户端，卸载注册表项名是 appId 生成的 GUID（在装有 2.7.1 的 Windows 上用 reg query 看到的值）。
const INSTALLED_CLIENT_KEY = 'b80d411a-9a19-5c6b-8319-e74d5c792871';

test('a local Windows smoke test refuses to install over a client already installed with the same appId', () => {
    const queried = [];
    const isInstalled = key => { queried.push(key); return key === INSTALLED_CLIENT_KEY; };

    assert.throws(
        () => checkWindowsInstallAllowed({ env: {}, appId: 'com.qiaokes.fntv', isInstalled }),
        error => /com.qiaokes.fntv/.test(error.message) && /FNTV_SMOKE_ALLOW_INSTALL=1/.test(error.message) && /tests\/smoke\/README\.md/.test(error.message)
    );
    assert.deepEqual(queried, [INSTALLED_CLIENT_KEY]);
});

test('a Windows smoke test installs when no client with the same appId is installed, on CI, or when explicitly allowed', () => {
    const installed = key => key === INSTALLED_CLIENT_KEY;
    // 本地构建改了 appId（tests/smoke/README.md 的“在本地跑”），GUID 不同，不会碰到已装的客户端。
    assert.doesNotThrow(() => checkWindowsInstallAllowed({ env: {}, appId: 'com.qiaokes.fntv.smoketest', isInstalled: installed }));
    assert.doesNotThrow(() => checkWindowsInstallAllowed({ env: { CI: 'true' }, appId: 'com.qiaokes.fntv', isInstalled: installed }));
    assert.doesNotThrow(() => checkWindowsInstallAllowed({ env: { FNTV_SMOKE_ALLOW_INSTALL: '1' }, appId: 'com.qiaokes.fntv', isInstalled: installed }));
});

// app.asar 只带 package.json 的 files 列出的 build/ 图标，漏列时托盘没有图标（冒烟测试的托盘检查会失败，
// 这里在打包前就发现）。@2x 由 nativeImage 按文件名自动读取，也要列出。
test('every tray icon the smoke tests expect is listed in the packaged files', () => {
    const files = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).build.files;
    for (const [id, { trayIcon }] of Object.entries(TARGETS)) {
        const expected = trayIcon.scaleFactors.map(scale => `build/${trayIcon.file.replace(/\.png$/, scale === 1 ? '.png' : `@${scale}x.png`)}`);
        for (const file of expected) {
            assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${id}: ${file} does not exist`);
            assert.ok(files.includes(file), `${id}: ${file} is not in package.json build.files`);
        }
    }
});

test('every smoke target names the workflow platform it is built on', () => {
    const platformOf = Object.fromEntries(Object.entries(TARGETS).map(([id, target]) => [id, target.platform]));
    assert.deepEqual(platformOf, {
        'darwin-arm64': 'macos',
        'darwin-x64': 'macos',
        'linux-x64': 'linux',
        'linux-arm64': 'linux',
        'win32-x64': 'windows',
    });
});

// 日志器曾在 userData 改到 ~/.fntv 之前取目录，日志落进 Electron 默认的 userData（#87）。冒烟测试要能看出
// 这个差别，所以每个目标的 Electron 默认 userData 都要是 ~/.fntv 以外的目录。
test('every POSIX smoke target keeps logs in ~/.fntv/logs, apart from the Electron default userData', () => {
    const home = path.join(os.tmpdir(), 'fntv-smoke-home');
    const defaults = {
        'linux-x64': path.join(home, '.config', 'fntv'),
        'linux-arm64': path.join(home, '.config', 'fntv'),
        'darwin-arm64': path.join(home, 'Library', 'Application Support', 'fntv'),
        'darwin-x64': path.join(home, 'Library', 'Application Support', 'fntv'),
    };
    for (const [id, electronUserDataDir] of Object.entries(defaults)) {
        const isolation = resolveTarget(id, {}).isolation(home);
        assert.deepEqual(isolation, {
            userDataDir: path.join(home, '.fntv'),
            logDir: path.join(home, '.fntv', 'logs'),
            electronUserDataDir,
            args: [],
            realProfile: false,
        }, id);
    }
});

test('the Windows smoke test on CI runs against the real profile so the Electron default userData is a separate directory', () => {
    // app.getPath('home') 在 Windows 上不认 USERPROFILE，带 --user-data-dir 时 Electron 默认 userData
    // 又和 ~/.fntv 是同一个目录，看不出日志写错了地方。CI 机器是一次性的，直接用真实的用户目录。
    const env = { CI: 'true', USERPROFILE: 'C:\Users\runneradmin', APPDATA: 'C:\Users\runneradmin\AppData\Roaming' };
    const isolation = resolveTarget('win32-x64', env).isolation(path.join(os.tmpdir(), 'fntv-smoke-home'));
    assert.deepEqual(isolation, {
        userDataDir: path.join('C:\Users\runneradmin', '.fntv'),
        logDir: path.join('C:\Users\runneradmin', '.fntv', 'logs'),
        electronUserDataDir: path.join('C:\Users\runneradmin\AppData\Roaming', 'fntv'),
        args: [],
        realProfile: true,
    });
});

test('a local Windows smoke test keeps user data in the temporary home through --user-data-dir', () => {
    const home = path.join(os.tmpdir(), 'fntv-smoke-home');
    const isolation = resolveTarget('win32-x64', {}).isolation(home);
    assert.deepEqual(isolation, {
        userDataDir: path.join(home, '.fntv'),
        logDir: path.join(home, '.fntv', 'logs'),
        // Electron 跟着 --user-data-dir 改 userData，默认目录和 ~/.fntv 重合，这条检查在本地做不了。
        electronUserDataDir: null,
        args: [`--user-data-dir=${path.join(home, '.fntv')}`],
        realProfile: false,
    });
});
