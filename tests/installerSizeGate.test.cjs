const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TARGETS } = require('./smoke/targets.cjs');
const { runStep, workflow } = require('./helpers/workflowSteps.cjs');

// 体积门禁：build.yml 打包后、上传前核对每个安装包不超过 scripts/installer-size-budget.json 的预算。
// 发版门禁和改构建的 PR 的冒烟测试都经 build.yml 构建，超预算的安装包既发布不了，PR 的检查也会失败。
// 和 tests/releaseGate.test.cjs 一样读 workflow 文件，锁住这一步存在、预算覆盖 tests/smoke/targets.cjs 的全部目标。

const root = path.resolve(__dirname, '..');
const SIZE_CHECK = 'Check installer size';
const BUDGETS = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'installer-size-budget.json'), 'utf8'));
const INSTALLER_NAMES = {
    'win32-x64': 'FNMedia_9.9.9_win_x64.exe',
    'darwin-arm64': 'FNMedia_9.9.9_mac_arm64.dmg',
    'darwin-x64': 'FNMedia_9.9.9_mac_x64.dmg',
    'linux-x64': 'FNMedia_9.9.9_linux_x86_64.AppImage',
    'linux-arm64': 'FNMedia_9.9.9_linux_arm64.AppImage',
};

function platformsOfTargets() {
    return [...new Set(Object.values(TARGETS).map(target => target.platform))].sort();
}

function targetsOn(platform) {
    return Object.keys(TARGETS).filter(id => TARGETS[id].platform === platform);
}

// 按 GitHub 的方式运行 build.yml 的体积检查。工作目录里放好脚本、预算和 targets.cjs，
// installers 是 release/ 下的文件名和字节数（稀疏文件，不真的写这么多数据）。
function runSizeCheck(t, platform, installers) {
    const job = workflow('build.yml').jobs.build;
    return runStep(t, job, step => step.name === SIZE_CHECK, { PLATFORM: platform, GH_TOKEN: '' }, cwd => {
        for (const file of ['scripts/check-installer-size.cjs', 'scripts/installer-size-budget.json', 'tests/smoke/targets.cjs']) {
            fs.mkdirSync(path.join(cwd, path.dirname(file)), { recursive: true });
            fs.copyFileSync(path.join(root, file), path.join(cwd, file));
        }
        fs.mkdirSync(path.join(cwd, 'release'));
        for (const [name, size] of Object.entries(installers)) {
            fs.writeFileSync(path.join(cwd, 'release', name), '');
            fs.truncateSync(path.join(cwd, 'release', name), size);
        }
    });
}

// 平台上每个目标一个安装包，大小取 sizeOf(目标)。
function installersOn(platform, sizeOf) {
    return Object.fromEntries(targetsOn(platform).map(id => {
        assert.match(INSTALLER_NAMES[id], TARGETS[id].installerPattern, id);
        return [INSTALLER_NAMES[id], sizeOf(id)];
    }));
}

test('build.yml checks installer sizes after packaging and before uploading', () => {
    const steps = workflow('build.yml').jobs.build.steps;
    const index = name => steps.findIndex(step => step.name === name);
    const check = steps[index(SIZE_CHECK)];
    assert.ok(check, `build.yml has no "${SIZE_CHECK}" step`);
    assert.ok(index('Build application') < index(SIZE_CHECK), 'the size check must run after packaging');
    assert.ok(index(SIZE_CHECK) < index('Upload build artifacts'), 'the size check must run before uploading');
    // 和上传同一条件：发版和冒烟测试都检查，cache-warm.yml 不上传也不检查。
    assert.equal(check.if, 'inputs.upload');
    assert.equal(check['continue-on-error'], undefined);
    assert.equal(check.env.PLATFORM, '${{ inputs.platform }}');
});

test('the installer size budget covers exactly the smoke targets', () => {
    assert.deepEqual(Object.keys(BUDGETS).sort(), Object.keys(TARGETS).sort());
    for (const [id, budget] of Object.entries(BUDGETS)) {
        assert.ok(Number.isInteger(budget) && budget > 0, `${id}: ${budget}`);
    }
});

test('installers within their budgets pass the size check and are listed in the summary', t => {
    for (const platform of platformsOfTargets()) {
        const result = runSizeCheck(t, platform, installersOn(platform, id => BUDGETS[id]));
        assert.equal(result.status, 0, result.stdout + result.stderr);
        for (const id of targetsOn(platform)) {
            assert.match(result.stdout, new RegExp(`^\\| ✅ \\| ${id} \\| \`${INSTALLER_NAMES[id]}\``, 'm'), platform);
        }
    }
});

test('an installer one byte over its budget fails the size check', t => {
    for (const platform of platformsOfTargets()) {
        const [over] = targetsOn(platform);
        const result = runSizeCheck(t, platform, installersOn(platform, id => BUDGETS[id] + (id === over ? 1 : 0)));
        assert.notEqual(result.status, 0, platform);
        assert.match(result.stdout, new RegExp(`^::error::.+ over the ${over} budget`, 'm'), platform);
    }
});

test('a missing installer or an installer without a smoke target fails the size check', t => {
    const missing = runSizeCheck(t, 'linux', { [INSTALLER_NAMES['linux-x64']]: 1 });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stdout, /^::error::linux-arm64: expected one installer/m);

    const unknown = runSizeCheck(t, 'windows', { ...installersOn('windows', () => 1), 'FNMedia_9.9.9_win_arm64.exe': 1 });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stdout, /^::error::FNMedia_9\.9\.9_win_arm64\.exe matches no smoke target/m);
});
