const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workflowDir = path.join(root, '.github', 'workflows');
// 写着规则、“验证：”命令或 workflow 名的文档。
const standardsDocs = [
    'CODING_STANDARDS.md',
    'TESTING_STANDARDS.md',
    'tests/smoke/README.md',
    ...fs.readdirSync(path.join(root, 'docs', 'adr')).filter(name => name.endsWith('.md')).map(name => `docs/adr/${name}`),
];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const actionDir = path.join(root, '.github', 'actions');

// workflow 和本仓库的 composite action（.github/actions/<名字>/action.yml）按同样的规则检查。
function workflows() {
    const files = [
        ...fs.readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name)).map(name => path.join(workflowDir, name)),
        ...fs.readdirSync(actionDir).map(name => path.join(actionDir, name, 'action.yml')).filter(file => fs.existsSync(file)),
    ];
    return files.map(file => ({
        name: path.relative(root, file),
        lines: fs.readFileSync(file, 'utf8').split(/\r?\n/)
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
    // electron 42 起 pnpm install 不下载二进制，第一次 require('electron') 时按需下载并解压，解压完才写 path.txt。
    // 曾经解压器在 Node 26 上读不出 zip 内容却以 0 退出，dist 里只剩空的 locales，这里核对可执行文件和版本都在。
    const electronDir = path.join(root, 'node_modules', 'electron');
    const resolved = spawnSync(process.execPath, ['-p', "require('electron')"], { cwd: root, encoding: 'utf8' });
    assert.equal(resolved.status, 0, resolved.stderr);
    // 按需下载时 index.js 先往 stdout 打下载信息，路径在最后一行。
    const executable = resolved.stdout.trim().split(/\r?\n/).pop();
    assert.ok(fs.existsSync(path.join(electronDir, 'path.txt')), 'path.txt missing');
    assert.ok(fs.existsSync(executable), `${executable} missing`);
    const { version } = JSON.parse(read('node_modules/electron/package.json'));
    assert.equal(fs.readFileSync(path.join(electronDir, 'dist', 'version'), 'utf8').trim().replace(/^v/, ''), version);
});

test('a verification command with a broken regex is reported as broken', () => {
    // 46340cc 写进文档的就是这条命令。
    const result = runInShell("git grep -n -E '(alert|confirm|prompt)(' -- src resource");

    assert.equal(commandWorks(result), false);
});

test('standards documents contain no control characters', () => {
    // 反斜杠转义被写成过控制字符，肉眼看不出（CODING_STANDARDS.md 里的 \b，冒烟测试说明里的 %APPDATA%\fntv）。
    for (const doc of standardsDocs) {
        assert.doesNotMatch(read(doc), /[\u0000-\u0008\u000B-\u001F]/, doc);
    }
});

test('verification commands in the standards documents still run', () => {
    const commands = standardsDocs
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
    for (const doc of standardsDocs) {
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

// electron-builder 的 extraFiles 把仓库里的 from 复制到安装目录的 to。这里只认本仓库用的两种写法：
// 单个文件（没有 filter），或目录加 filter ["**/*"]。返回源文件在安装目录里的相对路径，没带上时返回 undefined。
function packagedPath(extraFiles, source) {
    for (const { from, to, filter } of extraFiles) {
        if (from === source && filter === undefined) return to;
        const inside = path.posix.relative(from, source);
        if (!inside.startsWith('..') && JSON.stringify(filter) === '["**/*"]') return path.posix.join(to, inside);
    }
    return undefined;
}

// 清单在便携配置的上一级（resolveManifestPath），同步和启动时的能力检查都从那里读（#221）。
test('every platform packages the MPV archive manifest next to the portable config', () => {
    const { build } = JSON.parse(read('package.json'));
    const portable = 'third_party/fntv-mpv/portable_config';
    const manifest = 'third_party/fntv-mpv/fntv-manifest.json';
    for (const platform of ['win', 'mac', 'linux']) {
        const extraFiles = build[platform].extraFiles;
        assert.equal(packagedPath(extraFiles, `${portable}/mpv.conf`), `${portable}/mpv.conf`, `${platform} packages the portable config`);
        assert.equal(packagedPath(extraFiles, manifest), manifest, `${platform} packages the manifest`);
    }
});

test('build.yml checks the pinned MPV archive manifest after compiling and before packaging', () => {
    const { workflow } = require('./helpers/workflowSteps.cjs');
    const { steps } = workflow('build.yml').jobs.build;
    const index = name => steps.findIndex(step => step.name === name);
    const check = steps[index('Check MPV archive manifest')];
    assert.ok(check, 'build.yml has no Check MPV archive manifest step');
    assert.equal(check.run.trim(), 'node scripts/check-mpv-manifest.cjs');
    assert.equal(check['continue-on-error'], undefined, 'the manifest check must fail the build');
    assert.ok(index('Download third-party dependencies') < index('Check MPV archive manifest'));
    assert.ok(index('Compile TypeScript') < index('Check MPV archive manifest'), 'the check requires the compiled sync module');
    assert.ok(index('Check MPV archive manifest') < index('Build application'));
});

// CI 经 pnpm run check 跑 knip、文件大小检查等，见 tests/checkCommand.test.cjs。

// Proxy 改用 TypeScript 后（ADR-0004），构建和 CI 只要 Node 和 pnpm。
test('the repository has no Go code and neither builds nor CI install or run Go', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    assert.deepEqual(tracked.filter(file => /(^|\/)go\.(mod|sum)$|\.go$/.test(file)), []);

    const yaml = require('js-yaml');
    for (const { name, lines } of workflows()) {
        const parsed = yaml.load(lines.join('\n'));
        const steps = [...Object.values(parsed.jobs ?? {}).flatMap(job => job.steps ?? []), ...(parsed.runs?.steps ?? [])];
        for (const step of steps) {
            assert.doesNotMatch(step.uses ?? '', /setup-go/, `${name} installs Go`);
            assert.doesNotMatch(step.run ?? '', /\bgo (build|test|mod)\b/, `${name} runs Go`);
        }
    }
    const { scripts } = JSON.parse(read('package.json'));
    for (const [script, command] of Object.entries(scripts)) {
        assert.doesNotMatch(command, /\bgo build\b|third_party\/proxy/, `package.json script ${script} builds the Go Proxy`);
    }
});
