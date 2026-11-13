const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

// 读 .github/workflows 下的 workflow 和 .github/actions 下的 composite action，在临时目录里实际运行某个 step，检查缓存步骤的约定。

const root = path.resolve(__dirname, '..', '..');

function workflow(name) {
    return yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8'));
}

// 本仓库的 composite action。返回值带 steps，可以和 job 一样交给 runStep。
function action(name) {
    const metadata = yaml.load(fs.readFileSync(path.join(root, '.github', 'actions', name, 'action.yml'), 'utf8'));
    return { ...metadata, steps: metadata.runs.steps };
}

function asList(value) {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

// Windows 上 PATH 里的 bash 可能是 WSL，这里用 Git 自带的。
function bash() {
    if (process.platform !== 'win32') return 'bash';
    const gitCore = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    return path.resolve(gitCore, '..', '..', '..', 'usr', 'bin', 'bash.exe');
}

// 按 GitHub 的方式在临时工作目录里运行 job 的某个 step，返回进程结果和它写进 $GITHUB_OUTPUT 的值。
// prepare 在运行前往工作目录里放文件。
function runStep(t, job, find, env, prepare = () => {}) {
    const step = job.steps.find(find);
    assert.ok(step, `step not found: ${find}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-release-gate-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const output = path.join(dir, 'output');
    fs.writeFileSync(output, '');
    const cwd = path.join(dir, 'workspace');
    fs.mkdirSync(cwd);
    prepare(cwd);
    const result = spawnSync(bash(), ['-eo', 'pipefail', '-c', step.run], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, PATH: process.platform === 'win32' ? `/usr/bin:${process.env.PATH}` : process.env.PATH, ...env, GITHUB_OUTPUT: output },
    });
    const outputs = Object.fromEntries(fs.readFileSync(output, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
    }));
    return { ...result, outputs };
}

// 缓存的 restore 和 save 分开写，save 只在未命中时运行，紧跟在产生缓存内容的步骤后面；两步都不能让构建失败。
function assertRestoreAndSave(job, restore, save, after) {
    assert.ok(restore && save, 'cache restore or save step missing');
    assert.match(restore.uses, /^actions\/cache\/restore@[0-9a-f]{40}$/);
    assert.match(save.uses, /^actions\/cache\/save@[0-9a-f]{40}$/);
    assert.equal(restore.uses.split('@')[1], save.uses.split('@')[1]);
    assert.equal(restore['continue-on-error'], true);
    assert.equal(save['continue-on-error'], true);
    assert.equal(save.if, `steps.${restore.id}.outputs.cache-hit != 'true'`);
    assert.equal(save.with.key, `\${{ steps.${restore.id}.outputs.cache-primary-key }}`);
    assert.equal(save.with.path, restore.with.path);
    assert.equal(job.steps.indexOf(save), job.steps.indexOf(after) + 1, `${save.name} must run right after ${after.name}`);
}

function posixPath(file) {
    return process.platform === 'win32'
        ? file.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/')
        : file;
}

module.exports = { action, asList, assertRestoreAndSave, posixPath, root, runStep, workflow };
