'use strict';

// 冒烟测试的目标平台。每个目标说明：安装包叫什么、怎样按用户的方式变成可执行文件、
// 怎样把用户数据隔离到临时目录。断言在 installer.smoke.cjs 里，所有目标共用一套。
// 加平台时只在这里加一项，并在 .github/workflows/build-and-smoke.yml 的目标表里加一行。

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
        userDataDir: home => path.join(home, '.fntv'),
        // 和 Linux 一样，日志落在 Electron 默认的 userData，macOS 是 ~/Library/Application Support/<name>。
        logDir: home => path.join(home, 'Library', 'Application Support', 'fntv', 'logs'),
    };
}

const TARGETS = {
    'darwin-arm64': macDmgTarget('arm64'),
    'darwin-x64': macDmgTarget('x64'),
    'linux-x64': {
        // 打包工具给 Linux x64 的架构名是 x86_64（CODING_STANDARDS.md 的更新检查一节）。
        installerPattern: /^FNMedia_.+_linux_x86_64\.AppImage$/,
        // 直接运行用户下载的那个 AppImage。artifact 下载后丢失可执行位，这里补上。
        install(installerPath) {
            fs.chmodSync(installerPath, 0o755);
            return { executablePath: installerPath, uninstall() {} };
        },
        environment: posixHomeEnvironment,
        userDataDir: home => path.join(home, '.fntv'),
        // 日志器在 config.ts 把 userData 改到 ~/.fntv 之前就取了路径，日志落在 Electron 默认的
        // userData（Linux 是 ~/.config/<name>），不在 ~/.fntv/logs。
        logDir: home => path.join(home, '.config', 'fntv', 'logs'),
    },
    'win32-x64': {
        installerPattern: /^FNMedia_.+_win_x64\.exe$/,
        // NSIS 安装包 /S 静默安装到临时目录，从安装目录启动。/D 必须是最后一个参数，路径不加引号。
        install(installerPath) {
            const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-install-'));
            run(installerPath, ['/S', '/currentuser', `/D=${installDir}`]);
            const names = fs.readdirSync(installDir);
            const executables = names.filter(name => name.endsWith('.exe') && !name.startsWith('Uninstall '));
            const uninstaller = names.find(name => name.startsWith('Uninstall ') && name.endsWith('.exe'));
            if (executables.length !== 1 || !uninstaller) {
                throw new Error(`安装目录 ${installDir} 里应有一个客户端和一个卸载程序，实际是：${names.join(', ')}`);
            }
            return {
                executablePath: path.join(installDir, executables[0]),
                // _?= 让卸载程序在原地同步运行，否则它复制到临时目录后立即返回。它不删自己，目录随后删掉。
                uninstall() {
                    run(path.join(installDir, uninstaller), ['/S', '/currentuser', `_?=${installDir}`]);
                    fs.rmSync(installDir, { recursive: true, force: true, maxRetries: 5 });
                },
            };
        },
        // app.getPath('home') 在 Windows 上不认 USERPROFILE，~/.fntv 靠 --user-data-dir 改到临时目录
        // （src/public/constants.ts），日志也随之落在这里。USERPROFILE 隔离 os.homedir() 下的 MPV 用户配置。
        environment: home => ({ USERPROFILE: home }),
        args: home => [`--user-data-dir=${path.join(home, '.fntv')}`],
        userDataDir: home => path.join(home, '.fntv'),
        logDir: home => path.join(home, '.fntv', 'logs'),
    },
};

function run(file, args) {
    const result = spawnSync(file, args, { stdio: 'inherit', timeout: 120000 });
    if (result.error || result.status !== 0) {
        throw new Error(`${file} ${args.join(' ')} 失败：${result.error ? result.error.message : `退出码 ${result.status}`}`);
    }
}

function resolveTarget(id) {
    const target = TARGETS[id];
    if (!target) {
        throw new Error(`没有冒烟测试目标 ${id}，已有：${Object.keys(TARGETS).join(', ')}`);
    }
    return { id, ...target };
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

module.exports = { TARGETS, resolveTarget, findInstaller, findAppExecutable };
