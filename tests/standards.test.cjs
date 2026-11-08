const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workflowDir = path.join(root, '.github', 'workflows');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function workflows() {
    return fs.readdirSync(workflowDir)
        .filter(name => /\.ya?ml$/.test(name))
        .map(name => ({
            name,
            lines: fs.readFileSync(path.join(workflowDir, name), 'utf8').split(/\r?\n/)
        }));
}

function isComment(line) {
    return line.trimStart().startsWith('#');
}

// Windows 上 PATH 里的 bash 可能是 WSL，这里用 Git 自带的。
function posixShell() {
    if (process.platform !== 'win32') return { file: 'bash', prefix: '' };
    const gitCore = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    return {
        file: path.resolve(gitCore, '..', '..', '..', 'usr', 'bin', 'bash.exe'),
        prefix: 'PATH=/usr/bin:$PATH; '
    };
}

function runInShell(command) {
    const shell = posixShell();
    return spawnSync(shell.file, ['-c', shell.prefix + command], { cwd: root, encoding: 'utf8' });
}

// grep 和 git grep 用 0 和 1 表示有无结果，其它退出码说明命令本身坏了。
function commandWorks(result) {
    return result.status === 0 || result.status === 1;
}

test('workflows install dependencies with a frozen lockfile', () => {
    const installs = workflows().flatMap(({ name, lines }) => lines
        .filter(line => line.includes('pnpm install') && !isComment(line))
        .map(line => ({ name, line })));

    assert.ok(installs.length > 0, 'no pnpm install found in workflows');
    for (const { name, line } of installs) {
        assert.match(line, /--frozen-lockfile/, `${name}: ${line.trim()}`);
    }
});

test('third-party actions are pinned to a commit SHA with a version comment', () => {
    const actions = workflows().flatMap(({ name, lines }) => lines
        .filter(line => /^\s*(- )?uses:/.test(line))
        .map(line => ({ name, line: line.trim() })));

    assert.ok(actions.length > 0, 'no actions found in workflows');
    for (const { name, line } of actions) {
        // 本仓库的可复用 workflow 随提交一起变，不固定 SHA，但文件必须存在。
        const local = line.match(/uses: \.\/(\S+)$/);
        if (local) {
            assert.ok(fs.existsSync(path.join(root, local[1])), `${name}: ${line}`);
            continue;
        }
        assert.match(line, /uses: [^@\s]+@[0-9a-f]{40} # v\d/, `${name}: ${line}`);
    }
});

test('pnpm/action-setup reads the pnpm version from packageManager', () => {
    let steps = 0;
    for (const { name, lines } of workflows()) {
        lines.forEach((line, index) => {
            if (!line.includes('pnpm/action-setup')) return;
            steps += 1;
            const rest = lines.slice(index + 1);
            const nextStep = rest.findIndex(next => /^\s*- /.test(next));
            const step = nextStep === -1 ? rest : rest.slice(0, nextStep);
            assert.equal(step.some(next => /^\s*version:/.test(next)), false, `${name}:${index + 1}`);
        });
    }
    assert.ok(steps > 0, 'no pnpm/action-setup found in workflows');
});

test('every electron-builder script disables publishing', () => {
    const { scripts } = JSON.parse(read('package.json'));
    const commands = Object.entries(scripts).flatMap(([name, script]) => script
        .split('&&')
        .filter(command => command.includes('electron-builder'))
        .map(command => ({ name, command: command.trim() })));

    assert.ok(commands.length > 0, 'no electron-builder script found');
    for (const { name, command } of commands) {
        assert.match(command, /--publish never\b/, `${name}: ${command}`);
    }
});

test('workflows do not use untrusted refs, the latest release or secrets', () => {
    for (const { name, lines } of workflows()) {
        lines.forEach((line, index) => {
            assert.doesNotMatch(line, /head_commit|releases\/latest|secrets\./, `${name}:${index + 1}`);
        });
    }
});

test('source does not call native browser dialogs', () => {
    const result = spawnSync('git', ['grep', '-n', '-E', '\\b(alert|confirm|prompt)\\(', '--', 'src', 'resource'], {
        cwd: root,
        encoding: 'utf8'
    });

    assert.equal(result.status, 1, result.stdout || result.stderr);
});

test('original author attribution stays in the package, README and login page', () => {
    for (const file of ['package.json', 'README.md', 'resource/login/index.html']) {
        assert.ok(read(file).includes('Tag mig hånden'), file);
    }
});

test('pnpm uses the hoisted node linker', () => {
    const result = spawnSync('pnpm config get nodeLinker', { cwd: root, encoding: 'utf8', shell: true });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'hoisted');
});

test('electron finished extracting its binary', () => {
    assert.ok(fs.existsSync(path.join(root, 'node_modules', 'electron', 'path.txt')));
});

test('a verification command with a broken regex is reported as broken', () => {
    // 46340cc 写进文档的就是这条命令。
    const result = runInShell("git grep -n -E '(alert|confirm|prompt)(' -- src resource");

    assert.equal(commandWorks(result), false);
});

test('verification commands in the standards documents still run', () => {
    const commands = ['CODING_STANDARDS.md', 'TESTING_STANDARDS.md']
        .flatMap(file => [...read(file).matchAll(/验证：`([^`]+)`/g)].map(match => match[1]));

    assert.ok(commands.length > 0, 'no verification command found');
    for (const command of commands) {
        const result = runInShell(command);
        assert.ok(commandWorks(result), `${command}\nexit ${result.status}\n${result.stderr}`);
    }
});

test('every script that produces dest also bundles the preload', () => {
    const { scripts } = JSON.parse(read('package.json'));

    assert.match(scripts.compile, /build:preload/);
    assert.match(scripts.start, /build:preload/);
    assert.match(scripts.watch, /build-preload\.cjs --watch/);
});

test('workflow steps and jobs named in the standards documents exist', () => {
    // 文档写“`<文件>.yml` 的 `<名字>`”时，名字是那个 workflow 的触发事件、job id 或 step 的 name。
    const yaml = require('js-yaml');
    const references = [];
    for (const doc of ['CODING_STANDARDS.md', 'TESTING_STANDARDS.md']) {
        for (const match of read(doc).matchAll(/`([\w-]+\.yml)` 的 `([^`]+)`/g)) {
            references.push({ doc, file: match[1], name: match[2] });
        }
    }
    assert.ok(references.some(reference => reference.file === 'release.yml'), 'no workflow step references found');
    for (const { doc, file, name } of references) {
        const parsed = yaml.load(fs.readFileSync(path.join(workflowDir, file), 'utf8'));
        const jobs = Object.entries(parsed.jobs);
        const names = new Set([
            ...Object.keys(parsed.on),
            ...jobs.map(([id]) => id),
            ...jobs.flatMap(([, job]) => (job.steps ?? []).map(step => step.name)),
        ]);
        assert.ok(names.has(name), `${doc} refers to ${file} ${name}, which does not exist`);
    }
});
