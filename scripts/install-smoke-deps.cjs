#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

const SMOKE_PACKAGES = ['playwright-core'];

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
