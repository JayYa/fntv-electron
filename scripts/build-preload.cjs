// 把 preload 打成单文件。主窗口开了 sandbox，preload 只能 require('electron')。
// 输出到 bundle.js，不覆盖 tsc 的 index.js：tsc --watch 重新输出时会盖掉打包结果。
// 用法：node scripts/build-preload.cjs [--watch]，--watch 同时运行 tsc --watch。
const { spawn } = require('node:child_process');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

const options = {
    absWorkingDir: root,
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dest/preload/bundle.js',
    bundle: true,
    // browser 平台下导入 Node 内置模块会在构建时报错，不用等到运行时才发现。
    platform: 'browser',
    format: 'cjs',
    target: 'chrome140', // Electron 38
    external: ['electron'],
    logLevel: 'info',
};

async function watch() {
    const context = await esbuild.context(options);
    await context.watch();

    const tsc = spawn(process.execPath, [require.resolve('typescript/bin/tsc'), '--watch'], {
        cwd: root,
        stdio: 'inherit',
    });
    tsc.on('exit', async (code) => {
        await context.dispose();
        process.exit(code ?? 0);
    });
}

const run = process.argv.includes('--watch') ? watch() : esbuild.build(options);

run.catch((error) => {
    console.error(error);
    process.exit(1);
});
