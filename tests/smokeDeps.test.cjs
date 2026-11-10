const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { builtinModules } = require('node:module');
const path = require('node:path');

const { SMOKE_PACKAGES, assertIntegrity, assertPinned, lockedPackage, tarballUrl } = require('../scripts/install-smoke-deps.cjs');
const { workflow } = require('./helpers/workflowSteps.cjs');

// 冒烟测试 job 不跑完整的 pnpm install，只装 tests/smoke/ 用到的包，版本和 integrity 取自锁文件（2026-11-10）。

const root = path.resolve(__dirname, '..');
const lockfile = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function integrityOf(data) {
    return `sha512-${crypto.createHash('sha512').update(data).digest('base64')}`;
}

test('the smoke job installs only the locked smoke test packages, without pnpm', () => {
    const steps = workflow('build-and-smoke.yml').jobs.smoke.steps;
    for (const step of steps) {
        assert.doesNotMatch(step.run ?? '', /pnpm/, `${step.name} runs pnpm`);
        assert.doesNotMatch(step.uses ?? '', /pnpm\/action-setup/, `${step.name} sets up pnpm`);
    }
    const node = steps.find(step => /^actions\/setup-node@/.test(step.uses ?? ''));
    assert.equal(node.with.cache, undefined, 'setup-node restores a package manager cache');
    assert.equal(node.with['package-manager-cache'], false);
    const install = steps.find(step => step.name === 'Install dependencies');
    assert.equal(install.run, 'node scripts/install-smoke-deps.cjs');
    assert.ok(steps.indexOf(install) < steps.findIndex(step => step.name === 'Run smoke test'));
    // 改了安装脚本的 PR 也要跑冒烟测试。
    assert.ok(workflow('smoke-test.yml').on.pull_request.paths.includes('scripts/install-smoke-deps.cjs'));
});

test('the smoke test packages are every non-builtin module tests/smoke/ requires', () => {
    const dir = path.join(root, 'tests', 'smoke');
    const required = new Set();
    for (const file of fs.readdirSync(dir)) {
        const source = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const [, name] of source.matchAll(/require\(\s*'([^']+)'\s*\)/g)) {
            if (name.startsWith('.') || name.startsWith('node:') || builtinModules.includes(name)) continue;
            required.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);
        }
    }
    assert.deepEqual([...required].sort(), [...SMOKE_PACKAGES].sort());
});

test('smoke test packages come from pnpm-lock.yaml and match package.json', () => {
    for (const name of SMOKE_PACKAGES) {
        const locked = lockedPackage(lockfile, name);
        assert.equal(locked.version, packageJson.devDependencies[name]);
        assert.match(locked.integrity, /^sha512-/);
        assert.doesNotThrow(() => assertPinned(packageJson, locked));
    }
    assert.throws(() => assertPinned({ devDependencies: { 'playwright-core': '1.0.0' } }, { name: 'playwright-core', version: '1.65.0' }), /1\.65\.0/);
});

test('lockedPackage refuses packages it cannot install exactly as locked', () => {
    const entry = key => `  ${key}:\n    resolution: {integrity: sha512-AAAA}\n\n`;
    const lock = (packages, snapshots) => `packages:\n\n${packages}snapshots:\n\n${snapshots}`;

    assert.deepEqual(lockedPackage(lock(entry('a@1.0.0'), '  a@1.0.0: {}\n'), 'a'), { name: 'a', version: '1.0.0', integrity: 'sha512-AAAA' });
    assert.deepEqual(lockedPackage(lock(entry("'@s/a@2.0.0'"), "  '@s/a@2.0.0': {}\n"), '@s/a').version, '2.0.0');
    assert.throws(() => lockedPackage(lock('', ''), 'a'), /expected one a version, got none/);
    assert.throws(() => lockedPackage(lock(entry('a@1.0.0') + entry('a@1.1.0'), '  a@1.0.0: {}\n  a@1.1.0: {}\n'), 'a'), /got 1\.0\.0, 1\.1\.0/);
    assert.throws(() => lockedPackage(lock(entry('a@1.0.0'), '  a@1.0.0:\n    dependencies:\n      b: 1.0.0\n'), 'a'), /has dependencies/);
});

test('a downloaded tarball must match the integrity in the lockfile', () => {
    const data = Buffer.from('tarball');
    const locked = { name: 'a', version: '1.0.0', integrity: integrityOf(data) };
    assert.doesNotThrow(() => assertIntegrity(data, locked));
    assert.throws(() => assertIntegrity(Buffer.from('tampered'), locked), /does not match pnpm-lock\.yaml/);
});

test('tarball URLs follow the npm registry layout', () => {
    assert.equal(tarballUrl('https://registry.npmjs.org/', { name: 'playwright-core', version: '1.65.0' }),
        'https://registry.npmjs.org/playwright-core/-/playwright-core-1.65.0.tgz');
    assert.equal(tarballUrl('https://registry.npmjs.org', { name: '@s/a', version: '2.0.0' }),
        'https://registry.npmjs.org/@s/a/-/a-2.0.0.tgz');
});
