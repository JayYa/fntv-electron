'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { findInstaller } = require('./targets.cjs');

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
