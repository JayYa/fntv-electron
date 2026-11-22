'use strict';

const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function posixHomeEnvironment(home) {
    return {
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
    };
}

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

function macDmgTarget(builderArch) {
    return {
        platform: 'macos',
        installerPattern: new RegExp(`^FNMedia_.+_mac_${builderArch}\\.dmg$`),
        install(installerPath) {
            const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-dmg-'));
            execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint, installerPath], { stdio: 'inherit' });
            try {
                return { executablePath: findAppExecutable(mountPoint), uninstall: () => detachDmg(mountPoint) };
            } catch (error) {
                detachDmg(mountPoint);
                throw error;
            }
        },
        environment: home => ({ ...posixHomeEnvironment(home), CFFIXED_USER_HOME: home }),
        isolation: home => posixIsolation(home, path.join(home, 'Library', 'Application Support', 'fntv')),
    };
}

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

function checkWindowsInstallAllowed({ env, appId, isInstalled }) {
    if (env.CI === 'true' || env.FNTV_SMOKE_ALLOW_INSTALL === '1') return;
    if (!isInstalled(nsisUninstallKeyName(appId))) return;
    throw new Error(
        `本机已经装了 appId 为 ${appId} 的客户端，测试用的安装包会先卸载它并删掉同名快捷方式。` +
        '按 tests/smoke/README.md 的“在本地跑”改 appId 和 productName 重新构建后，' +
        '设 FNTV_SMOKE_ALLOW_INSTALL=1 再运行；或者先卸载本机的客户端。'
    );
}

function packagedAppId() {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')).build.appId;
}

function runUninstaller(installDir, uninstaller) {
    try {
        if (uninstaller) run(path.join(installDir, uninstaller), ['/S', '/currentuser', `_?=${installDir}`]);
    } finally {
        fs.rmSync(installDir, { recursive: true, force: true, maxRetries: 5 });
    }
}

const TARGETS = {
    'darwin-arm64': macDmgTarget('arm64'),
    'darwin-x64': macDmgTarget('x64'),
    'linux-x64': {
        platform: 'linux',
        installerPattern: /^FNMedia_.+_linux_x86_64\.AppImage$/,
        install(installerPath) {
            fs.chmodSync(installerPath, 0o755);
            return { executablePath: installerPath, uninstall() {} };
        },
        environment: posixHomeEnvironment,
        isolation: home => posixIsolation(home, path.join(home, '.config', 'fntv')),
    },
    'win32-x64': {
        platform: 'windows',
        installerPattern: /^FNMedia_.+_win_x64\.exe$/,
        install(installerPath) {
            checkWindowsInstallAllowed({ env: process.env, appId: packagedAppId(), isInstalled: uninstallKeyExists });
            const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-install-'));
            run(installerPath, ['/S', '/currentuser', `/D=${installDir}`]);
            const names = fs.readdirSync(installDir);
            const executables = names.filter(name => name.endsWith('.exe') && !name.startsWith('Uninstall '));
            const uninstaller = names.find(name => name.startsWith('Uninstall ') && name.endsWith('.exe'));
            if (executables.length !== 1 || !uninstaller) {
                runUninstaller(installDir, uninstaller);
                throw new Error(`安装目录 ${installDir} 里应有一个客户端和一个卸载程序，实际是：${names.join(', ')}`);
            }
            return {
                executablePath: path.join(installDir, executables[0]),
                uninstall: () => runUninstaller(installDir, uninstaller),
            };
        },
        environment: home => {
            fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true });
            return { USERPROFILE: home };
        },
        isolation: windowsIsolation,
    },
};

TARGETS['linux-arm64'] = {
    ...TARGETS['linux-x64'],
    installerPattern: /^FNMedia_.+_linux_arm64\.AppImage$/,
};

function posixIsolation(home, electronUserDataDir) {
    return { userDataDir: path.join(home, '.fntv'), electronUserDataDir, args: [], realProfile: false };
}

function windowsIsolation(home, env) {
    if (env.CI === 'true') {
        return {
            userDataDir: path.join(env.USERPROFILE, '.fntv'),
            electronUserDataDir: path.join(env.APPDATA, 'fntv'),
            args: [],
            realProfile: true,
        };
    }
    const userDataDir = path.join(home, '.fntv');
    return { userDataDir, electronUserDataDir: null, args: [`--user-data-dir=${userDataDir}`], realProfile: false };
}

function run(file, args) {
    const result = spawnSync(file, args, { stdio: 'inherit', timeout: 120000 });
    if (result.error || result.status !== 0) {
        throw new Error(`${file} ${args.join(' ')} 失败：${result.error ? result.error.message : `退出码 ${result.status}`}`);
    }
}

function resolveTarget(id, env = process.env) {
    const target = TARGETS[id];
    if (!target) {
        throw new Error(`没有冒烟测试目标 ${id}，已有：${Object.keys(TARGETS).join(', ')}`);
    }
    return {
        id,
        ...target,
        isolation(home) {
            const { userDataDir, electronUserDataDir, args, realProfile } = target.isolation(home, env);
            return { userDataDir, logDir: path.join(userDataDir, 'logs'), electronUserDataDir, args, realProfile };
        },
    };
}

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
