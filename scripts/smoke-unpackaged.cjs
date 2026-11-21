#!/usr/bin/env node
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
        '--test-reporter=spec',
        '--test-timeout=120000',
        path.join('tests', 'smoke', 'installer.smoke.cjs'),
    ], {
        cwd: root,
        stdio: 'inherit',
        env: {
            ...process.env,
            FNTV_SMOKE_APP_DIR: root,
            FNTV_SMOKE_EXECUTABLE: process.env.FNTV_SMOKE_EXECUTABLE || require('electron'),
            FNTV_SMOKE_ARTIFACTS: process.env.FNTV_SMOKE_ARTIFACTS || path.join(root, 'smoke-artifacts', `unpackaged-${target}`),
        },
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

process.exitCode = main();
