'use strict';

// 冒烟测试的目标平台。每个目标说明：在哪个 workflow 平台上构建（platform）、安装包叫什么、
// 怎样按用户的方式变成可执行文件、怎样把用户数据隔离到临时目录。断言在 installer.smoke.cjs 里，
// 所有目标共用一套。
//
// 这里是目标的唯一来源。加平台或架构时在这里加一项，再同步 workflow 里的这几处，漏改哪一处
// tests/releaseGate.test.cjs 都会失败：
// - build-and-smoke.yml 的 select-targets：平台的构建机器和冒烟目标；
// - release.yml 的 Select platforms 和 workflow_dispatch 选项，publish 的 Check installers 安装包名；
// - smoke-test.yml 的平台列表和 workflow_dispatch 选项。

const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 用 HOME 和 XDG 目录隔离：userData 是 app.getPath('home') 下的 .fntv
// （src/public/constants.ts），MPV 用户配置在 ~/.config/mpv。
function posixHomeEnvironment(home) {
    return {
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
    };
}

// 挂载后的 dmg 根目录里有唯一一个 .app，Electron 应用的 Contents/MacOS 下只有主可执行文件。
function findAppExecutable(volume) {
    const entries = fs.readdirSync(volume);
    const apps = entries.filter(name => name.endsWith('.app'));
    if (apps.length !== 1) {
        throw new Error(`${volume} 里应有且只有一个 .app，实际内容：${entries.join(', ')}`);
    }
    const macosDir = path.join(volume, apps[0], 'Contents', 'MacOS');
    const executables = fs.readdirSync(macosDir);
    if (executables.length !== 1) {
        throw new Error(`${macosDir} 里应有且只有一个可执行文件，实际内容：${executables.join(', ')}`);
    }
    return path.join(macosDir, executables[0]);
}

function detachDmg(mountPoint) {
    try {
        execFileSync('hdiutil', ['detach', mountPoint], { stdio: 'inherit' });
    } catch {
        execFileSync('hdiutil', ['detach', '-force', mountPoint], { stdio: 'inherit' });
    }
    fs.rmSync(mountPoint, { recursive: true, force: true });
}

// macOS：挂载 dmg，启动里面 .app 的可执行文件，和用户双击 dmg 里的应用一样。builderArch 是打包
// 工具写进文件名的架构名。两个目标都在 Apple Silicon 机器上跑，x64 包经 Rosetta 运行。
function macDmgTarget(builderArch) {
    return {
        platform: 'macos',
        installerPattern: new RegExp(`^FNMedia_.+_mac_${builderArch}\\.dmg$`),
        install(installerPath) {
            // 挂到自己的临时目录，不进 /Volumes，不会和同名卷或构建残留冲突。
            const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-dmg-'));
            execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint, installerPath], { stdio: 'inherit' });
            try {
                return { executablePath: findAppExecutable(mountPoint), uninstall: () => detachDmg(mountPoint) };
            } catch (error) {
                detachDmg(mountPoint);
                throw error;
            }
        },
        // CFFIXED_USER_HOME 让 Foundation 的目录查询（Electron 默认 userData 靠它）也落在临时目录。
        environment: home => ({ ...posixHomeEnvironment(home), CFFIXED_USER_HOME: home }),
        // 和 Linux 一样，日志落在 Electron 默认的 userData，macOS 是 ~/Library/Application Support/<name>。
        logDir: home => path.join(home, 'Library', 'Application Support', 'fntv', 'logs'),
    };
}

// electron-builder 的 NSIS 安装包以 appId 的 UUID v5 作为卸载注册表项名，命名空间取自
// app-builder-lib 的 NsisTarget（ELECTRON_BUILDER_NS_UUID）。相同 appId 的安装包会先卸载已装的那份。
const NSIS_GUID_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3';
const UNINSTALL_KEYS = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

function nsisUninstallKeyName(appId) {
    const hash = crypto.createHash('sha1')
        .update(Buffer.from(NSIS_GUID_NAMESPACE.replace(/-/g, ''), 'hex'))
        .update(appId, 'utf8')
        .digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uninstallKeyExists(name) {
    return UNINSTALL_KEYS.some(parent => spawnSync('reg', ['query', `${parent}\\${name}`], { stdio: 'ignore' }).status === 0);
}

// 本机已装同一 appId 的客户端时，测试安装会先静默卸载它，测试结束的卸载还会删掉同名快捷方式。
// CI 机器是一次性的，不拦；本地要么用测试专用 appId 构建，要么明确设 FNTV_SMOKE_ALLOW_INSTALL=1。
function checkWindowsInstallAllowed({ env, appId, isInstalled }) {
    if (env.CI === 'true' || env.FNTV_SMOKE_ALLOW_INSTALL === '1') return;
    if (!isInstalled(nsisUninstallKeyName(appId))) return;
    throw new Error(
        `本机已经装了 appId 为 ${appId} 的客户端，测试用的安装包会先卸载它并删掉同名快捷方式。` +
        '按 TESTING_STANDARDS.md 的“在本地跑”改 appId 和 productName 重新构建后，' +
        '设 FNTV_SMOKE_ALLOW_INSTALL=1 再运行；或者先卸载本机的客户端。'
    );
}

function packagedAppId() {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')).build.appId;
}

function runUninstaller(installDir, uninstaller) {
    // _?= 让卸载程序在原地同步运行，否则它复制到临时目录后立即返回。它不删自己，目录随后删掉。
    try {
        if (uninstaller) run(path.join(installDir, uninstaller), ['/S', '/currentuser', `_?=${installDir}`]);
    } finally {
        fs.rmSync(installDir, { recursive: true, force: true, maxRetries: 5 });
    }
}

const TARGETS = {
    'darwin-arm64': macDmgTarget('arm64'),
    'darwin-x64': {
        ...macDmgTarget('x64'),
        // Rosetta 第一次运行 x64 Electron 时要先转译，只在这台机器上发生一次。#92 在同一台 macos-latest
        // 上连续直接启动 3 次，DevTools listening 分别在 51952ms、5552ms、6733ms，转译缓存 /var/db/oah
        // 从 2.7M 涨到 255M；darwin-arm64 三次是 2304ms、192ms、216ms，缓存不变。约 50 秒的首次转译加上
        // Playwright 自己的开销会贴着或超过 electron.launch 的 60 秒，所以正式测试前先启动一次把转译做完。
        // 上限取首次实测的两倍多。
        warmup: { timeoutMs: 120000 },
    },
    'linux-x64': {
        platform: 'linux',
        // 打包工具给 Linux x64 的架构名是 x86_64（CODING_STANDARDS.md 的更新检查一节）。
        installerPattern: /^FNMedia_.+_linux_x86_64\.AppImage$/,
        // 直接运行用户下载的那个 AppImage。artifact 下载后丢失可执行位，这里补上。
        install(installerPath) {
            fs.chmodSync(installerPath, 0o755);
            return { executablePath: installerPath, uninstall() {} };
        },
        environment: posixHomeEnvironment,
        // 日志器在 config.ts 把 userData 改到 ~/.fntv 之前就取了路径，日志落在 Electron 默认的
        // userData（Linux 是 ~/.config/<name>），不在 ~/.fntv/logs。
        logDir: home => path.join(home, '.config', 'fntv', 'logs'),
    },
    'win32-x64': {
        platform: 'windows',
        installerPattern: /^FNMedia_.+_win_x64\.exe$/,
        // NSIS 安装包 /S 静默安装到临时目录，从安装目录启动。/D 必须是最后一个参数，路径不加引号。
        install(installerPath) {
            checkWindowsInstallAllowed({ env: process.env, appId: packagedAppId(), isInstalled: uninstallKeyExists });
            const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-install-'));
            run(installerPath, ['/S', '/currentuser', `/D=${installDir}`]);
            const names = fs.readdirSync(installDir);
            const executables = names.filter(name => name.endsWith('.exe') && !name.startsWith('Uninstall '));
            const uninstaller = names.find(name => name.startsWith('Uninstall ') && name.endsWith('.exe'));
            if (executables.length !== 1 || !uninstaller) {
                // 安装已经写了注册表和快捷方式，先卸载再报错。
                runUninstaller(installDir, uninstaller);
                throw new Error(`安装目录 ${installDir} 里应有一个客户端和一个卸载程序，实际是：${names.join(', ')}`);
            }
            return {
                executablePath: path.join(installDir, executables[0]),
                uninstall: () => runUninstaller(installDir, uninstaller),
            };
        },
        // app.getPath('home') 在 Windows 上不认 USERPROFILE，~/.fntv 靠 --user-data-dir 改到临时目录
        // （src/public/constants.ts），日志也随之落在这里。USERPROFILE 隔离 os.homedir() 下的 MPV 用户配置。
        environment: home => ({ USERPROFILE: home }),
        args: home => [`--user-data-dir=${path.join(home, '.fntv')}`],
        logDir: home => path.join(home, '.fntv', 'logs'),
    },
};

// Linux arm64 和 x64 的安装、隔离、日志位置都一样，只有安装包名不同：arm64 的产物名就是 arm64。
// 在原生 arm64 机器上运行，Proxy 二进制架构不对时启动不了，由 Proxy 健康检查那条断言发现。
TARGETS['linux-arm64'] = {
    ...TARGETS['linux-x64'],
    installerPattern: /^FNMedia_.+_linux_arm64\.AppImage$/,
};

function run(file, args) {
    const result = spawnSync(file, args, { stdio: 'inherit', timeout: 120000 });
    if (result.error || result.status !== 0) {
        throw new Error(`${file} ${args.join(' ')} 失败：${result.error ? result.error.message : `退出码 ${result.status}`}`);
    }
}

// 没写的项取默认值：userData 都是临时 home 下的 .fntv，没有额外启动参数。
function resolveTarget(id) {
    const target = TARGETS[id];
    if (!target) {
        throw new Error(`没有冒烟测试目标 ${id}，已有：${Object.keys(TARGETS).join(', ')}`);
    }
    return { id, userDataDir: home => path.join(home, '.fntv'), args: () => [], ...target };
}

// 在目录里找唯一一个匹配的安装包。找到 0 个或多个都报错，避免测到旧版本。
function findInstaller(target, directory) {
    const names = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
    const matches = names.filter(name => target.installerPattern.test(name));
    if (matches.length !== 1) {
        throw new Error(
            `${directory} 里应有且只有一个 ${target.installerPattern} 安装包，实际找到 ${matches.length} 个：${matches.join(', ')}`
        );
    }
    return path.join(directory, matches[0]);
}

module.exports = { TARGETS, resolveTarget, findInstaller, findAppExecutable, checkWindowsInstallAllowed };
