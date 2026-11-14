#!/usr/bin/env node
// CI 的 Electron 下载缓存：算缓存 key，打包前写入离线校验用的 SHASUMS256.txt。
// 由 .github/actions/install-dependencies（keys）和 build.yml（seed-checksums）调用。
// key 只取 package.json 里的版本号，安装依赖之前也能算出来。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function exactVersion(packageJson, name) {
    const version = packageJson.devDependencies?.[name] ?? packageJson.dependencies?.[name];
    if (!EXACT_VERSION.test(version ?? '')) {
        throw new Error(`package.json: ${name} must be pinned to an exact version, got ${version}`);
    }
    return version;
}

// runner 是 { os, arch }，取自 Actions 的 runner.os（Linux、Windows、macOS）和 runner.arch（X64、ARM64）。
// Electron zip 只对一种架构有用，key 带架构。
function cacheKeys({ os: runnerOs, arch } = {}, dir = root) {
    if (!runnerOs) throw new Error('RUNNER_OS is not set');
    if (!arch) throw new Error('RUNNER_ARCH is not set');
    const packageJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const electron = exactVersion(packageJson, 'electron');
    return {
        'electron-version': electron,
        'electron-key': `electron-${runnerOs}-${arch}-${electron}`,
    };
}

// @electron/get 不传 cacheRoot 时的默认目录（env-paths('electron').cache），和 app-builder-lib 的
// defaultElectronGetCacheRoot 相同。install-dependencies 缓存的三个目录就是它在三个平台上的值。
function electronCacheRoot(platform = process.platform, home = os.homedir(), env = process.env) {
    if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'electron');
    if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache');
    return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron');
}

// @electron/get 即使命中缓存的 zip，也每次联网重新下载 SHASUMS256.txt 来校验（cacheMode Bypass），
// GitHub 504 时打包照样失败。app-builder-lib 26.18.0 会读缓存根目录下的 SHASUMS256.txt-<版本>，
// 有对应条目时离线校验。内容取自 electron 包自带的 checksums.json，和 postinstall 校验用的是同一份。
function seedChecksums(cacheRoot, checksumsFile) {
    const version = JSON.parse(fs.readFileSync(path.join(path.dirname(checksumsFile), 'package.json'), 'utf8')).version;
    const checksums = JSON.parse(fs.readFileSync(checksumsFile, 'utf8'));
    const lines = Object.entries(checksums).map(([file, sha256]) => `${sha256} *${file}`);
    if (lines.length === 0) throw new Error(`${checksumsFile} has no checksums`);
    const file = path.join(cacheRoot, `SHASUMS256.txt-${version}`);
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return { file, version };
}

function writeOutputs(outputs) {
    const text = Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join('');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text);
    process.stdout.write(text);
}

function main(command) {
    if (command === 'keys') {
        writeOutputs(cacheKeys({ os: process.env.RUNNER_OS, arch: process.env.RUNNER_ARCH }));
    } else if (command === 'seed-checksums') {
        const checksumsFile = require.resolve('electron/checksums.json', { paths: [process.cwd()] });
        const { file } = seedChecksums(electronCacheRoot(), checksumsFile);
        console.log(`Seeded ${file}`);
    } else {
        throw new Error(`usage: ci-download-cache.cjs keys|seed-checksums, got ${command}`);
    }
}

if (require.main === module) main(process.argv[2]);

module.exports = { cacheKeys, electronCacheRoot, seedChecksums };
