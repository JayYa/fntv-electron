'use strict';

// 冒烟测试要启动的客户端从哪来。installer.smoke.cjs 按返回值启动，断言两种模式共用：
// - 安装包：按用户的方式装好或打开（targets.cjs 的 install）；
// - FNTV_SMOKE_EXECUTABLE：跳过安装，直接启动这个可执行文件（本地调试用）；
// - 未打包：设 FNTV_SMOKE_APP_DIR 时，用 FNTV_SMOKE_EXECUTABLE 指定的 Electron 启动应用目录（electron <目录>）。
//
// 返回 { executablePath, args?, env?, logDir?, uninstall }：args 接在隔离参数后面，env 盖在隔离环境上，
// logDir 是客户端写 app.log 的目录，不给时用 targets.cjs 隔离出的 ~/.fntv/logs。

const fs = require('node:fs');
const path = require('node:path');
const { findInstaller } = require('./targets.cjs');

// 日志器在未打包时写到 <应用目录>/log（src/modules/logger/logger.ts），不随 HOME 隔离，启动前清空，
// 免得读到上一次运行的“Proxy 已就绪”和图标路径。
// 启动 3 秒后的更新检查用 axios 访问 GitHub（src/modules/updater），axios 认 HTTPS_PROXY。指向本机不监听的端口，
// 请求立即失败，检查失败只记日志、不弹框，不受 GitHub 网络波动影响；NO_PROXY 放行本机，Proxy 的探测照常。
// Linux 的 node_modules 里 chrome-sandbox 不是 root 所有的 setuid 程序，Ubuntu 24.04 又限制非特权用户命名空间，
// 不加 --no-sandbox 时 Electron 启动即退出。
// Electron 可执行文件由 scripts/smoke-unpackaged.cjs 解析好经 FNTV_SMOKE_EXECUTABLE 传进来：安装包冒烟 job 只装
// playwright-core（scripts/install-smoke-deps.cjs），这里不能加载 electron 包。
function unpackagedLaunch(appDir, executable) {
    if (!executable) throw new Error('未打包模式要设 FNTV_SMOKE_EXECUTABLE，用 scripts/smoke-unpackaged.cjs 运行');
    const logDir = path.join(appDir, 'log');
    fs.rmSync(logDir, { recursive: true, force: true });
    const unreachable = 'http://127.0.0.1:9';
    return {
        executablePath: path.resolve(executable),
        args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), appDir],
        env: { HTTPS_PROXY: unreachable, HTTP_PROXY: unreachable, NO_PROXY: '127.0.0.1,localhost' },
        logDir,
        uninstall() {},
    };
}

function resolveLaunch({ target, appDir, root, env = process.env }) {
    if (appDir) return unpackagedLaunch(appDir, env.FNTV_SMOKE_EXECUTABLE);
    if (env.FNTV_SMOKE_EXECUTABLE) return { executablePath: path.resolve(env.FNTV_SMOKE_EXECUTABLE), uninstall() {} };
    return target.install(findInstaller(target, path.resolve(env.FNTV_SMOKE_INSTALLER_DIR || path.join(root, 'release'))));
}

module.exports = { resolveLaunch };
