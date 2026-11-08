'use strict';

// 冒烟测试的目标平台。每个目标说明：安装包叫什么、怎样按用户的方式变成可执行文件、
// 怎样把用户数据隔离到临时目录。断言在 installer.smoke.cjs 里，所有目标共用一套。
// 加平台时只在这里加一项，并在 .github/workflows/build-and-smoke.yml 的目标表里加一行。

const fs = require('node:fs');
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

const TARGETS = {
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
};

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

module.exports = { TARGETS, resolveTarget, findInstaller };
