#!/usr/bin/env node
// 未打包启动检查：用 node_modules 里的 Electron 启动仓库（electron .），跑 tests/smoke/installer.smoke.cjs 的同一套断言，
// 只对安装包成立的几条跳过。要先编译到 dest/：CI 在 pnpm run check 之后跑（ci.yml），本地用 pnpm run test:smoke:unpackaged，
// 它先 compile 再调这里。Linux 没有显示器时套 xvfb-run。
//
// 截图、主进程输出和 app.log 写到 smoke-artifacts/unpackaged-<平台>-<架构>/，FNTV_SMOKE_ARTIFACTS 可改。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function main() {
    const entry = path.join(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).main);
    if (!fs.existsSync(entry)) {
        console.error(`${path.relative(root, entry)} 不存在，先运行 pnpm run compile`);
        return 1;
    }
    const target = `${process.platform}-${process.arch}`;
    const result = spawnSync(process.execPath, [
        '--test',
        // 和 test:smoke 一样固定 spec reporter，::notice:: 注解才不会被加上 "# " 前缀（tests/smoke/README.md）。
        '--test-reporter=spec',
        // 单条断言内部的等待都不超过 60 秒（启动 60 秒、主窗口 30 秒），这里只兜底。
        '--test-timeout=120000',
        path.join('tests', 'smoke', 'installer.smoke.cjs'),
    ], {
        cwd: root,
        stdio: 'inherit',
        env: {
            ...process.env,
            FNTV_SMOKE_APP_DIR: root,
            // electron 包在 Node 里 require 时导出可执行文件路径。冒烟脚本自己不 require 它（见 unpackagedLaunch）。
            FNTV_SMOKE_EXECUTABLE: process.env.FNTV_SMOKE_EXECUTABLE || require('electron'),
            FNTV_SMOKE_ARTIFACTS: process.env.FNTV_SMOKE_ARTIFACTS || path.join(root, 'smoke-artifacts', `unpackaged-${target}`),
        },
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

process.exitCode = main();
