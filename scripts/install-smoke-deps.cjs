#!/usr/bin/env node
// 冒烟测试 job（build-and-smoke.yml 的 smoke）只装 tests/smoke/ 用到的 npm 包，不跑完整的 pnpm install。
// 版本和 integrity 取自 pnpm-lock.yaml：从 registry 下载锁定版本的 tarball，核对 sha512 与锁文件一致后
// 解压到 node_modules/<包名>。只接受锁文件里没有依赖的包，有依赖时报错，免得装出锁文件之外的版本。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

// tests/smoke/ 里 require 的全部非内置模块。
const SMOKE_PACKAGES = ['playwright-core'];

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 从锁文件读出包的唯一版本和 integrity，并确认它在 snapshots 段没有依赖。
function lockedPackage(lockfile, name) {
    const escaped = escapeRegExp(name);
    const entries = [...lockfile.matchAll(new RegExp(`^ {2}'?${escaped}@(\\d[^:'(\\s]*)'?:\\r?\\n {4}resolution: \\{integrity: (sha512-[A-Za-z0-9+/=]+)\\}`, 'gm'))];
    if (entries.length !== 1) {
        throw new Error(`pnpm-lock.yaml: expected one ${name} version, got ${entries.map(entry => entry[1]).join(', ') || 'none'}`);
    }
    const [, version, integrity] = entries[0];
    const snapshot = new RegExp(`^ {2}'?${escaped}@${escapeRegExp(version)}'?:(.*)$`, 'gm');
    const snapshots = [...lockfile.matchAll(snapshot)].map(match => match[1].trim()).filter(rest => rest !== '');
    if (snapshots.length !== 1 || snapshots[0] !== '{}') {
        throw new Error(`pnpm-lock.yaml: ${name}@${version} has dependencies; install-smoke-deps only installs packages without dependencies`);
    }
    return { name, version, integrity };
}

// package.json 里写的版本必须是锁文件里那个，防止锁文件过期时装错版本。
function assertPinned(packageJson, locked) {
    const declared = packageJson.devDependencies?.[locked.name] ?? packageJson.dependencies?.[locked.name];
    if (declared !== locked.version) {
        throw new Error(`package.json: ${locked.name} is ${declared}, pnpm-lock.yaml has ${locked.version}`);
    }
}

function assertIntegrity(tarball, locked) {
    const actual = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;
    if (actual !== locked.integrity) {
        throw new Error(`${locked.name}@${locked.version}: tarball integrity ${actual} does not match pnpm-lock.yaml ${locked.integrity}`);
    }
}

// registry 上 tarball 的固定地址：<registry>/<name>/-/<不带 scope 的名字>-<版本>.tgz。
function tarballUrl(registry, locked) {
    const base = locked.name.split('/').pop();
    return `${registry.replace(/\/+$/, '')}/${locked.name}/-/${base}-${locked.version}.tgz`;
}

async function download(url, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            if (attempt >= attempts) throw error;
            console.warn(`${error.message}; retrying (${attempt}/${attempts - 1})`);
            await new Promise(resolve => setTimeout(resolve, attempt * 5000));
        }
    }
}

async function install(locked, dir, registry) {
    // 临时目录放在 node_modules 下，和目标同盘：Git 自带的 GNU tar 把 `D:\…` 这样的盘符路径当成远程主机，只能给相对路径。
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    const work = fs.mkdtempSync(path.join(dir, 'node_modules', '.install-smoke-deps-'));
    try {
        const data = await download(tarballUrl(registry, locked));
        assertIntegrity(data, locked);
        const tarball = path.join(work, 'package.tgz');
        fs.writeFileSync(tarball, data);
        const target = path.join(dir, 'node_modules', locked.name);
        fs.rmSync(target, { recursive: true, force: true });
        fs.mkdirSync(target, { recursive: true });
        // npm 的 tarball 里文件都在 package/ 下。
        execFileSync('tar', ['-xzf', path.basename(tarball), '-C', path.relative(work, target), '--strip-components=1'], { cwd: work, stdio: 'inherit' });
        const installed = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version;
        if (installed !== locked.version) throw new Error(`${locked.name}: installed ${installed}, expected ${locked.version}`);
        console.log(`Installed ${locked.name}@${locked.version} (${locked.integrity})`);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

async function main(dir = root) {
    const lockfile = fs.readFileSync(path.join(dir, 'pnpm-lock.yaml'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    // 不读 .npmrc（CI 上已删掉）；本地要用镜像时设 npm_config_registry。
    const registry = process.env.npm_config_registry || DEFAULT_REGISTRY;
    for (const name of SMOKE_PACKAGES) {
        const locked = lockedPackage(lockfile, name);
        assertPinned(packageJson, locked);
        await install(locked, dir, registry);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = { SMOKE_PACKAGES, assertIntegrity, assertPinned, lockedPackage, tarballUrl };
