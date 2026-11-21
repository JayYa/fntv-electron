const { spawn } = require('node:child_process');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

const options = {
    absWorkingDir: root,
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dest/preload/bundle.js',
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'chrome156',
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
