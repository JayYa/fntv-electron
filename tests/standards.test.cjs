const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { assertExitedCleanly } = require('./helpers/childProcess.cjs');

const root = path.resolve(__dirname, '..');
const workflowDir = path.join(root, '.github', 'workflows');
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

test('run scripts read event payloads and branch names through env', () => {
    const yaml = require('js-yaml');
    const untrusted = /\$\{\{[^}]*github\.(event|head_ref)/;
    for (const { name, lines } of workflows()) {
        const parsed = yaml.load(lines.join('\n'));
        const steps = parsed.jobs
            ? Object.values(parsed.jobs).flatMap(job => job.steps ?? [])
            : parsed.runs?.steps ?? [];
        for (const step of steps) {
            if (step.run) assert.doesNotMatch(step.run, untrusted, `${name}: ${step.name ?? step.run.split('\n')[0]}`);
        }
    }
});

test('ci.yml runs for pull requests against any base branch', () => {
    const yaml = require('js-yaml');
    const parsed = yaml.load(read('.github/workflows/ci.yml'));
    assert.ok('pull_request' in parsed.on, 'ci.yml has no pull_request trigger');
    const filter = parsed.on.pull_request ?? {};
    assert.equal(filter.branches, undefined);
    assert.equal(filter['branches-ignore'], undefined);
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

    assertExitedCleanly(result);
    assert.equal(result.stdout.trim(), 'hoisted');
});

test('electron finished extracting its binary', () => {
    const electronDir = path.join(root, 'node_modules', 'electron');
    const resolved = spawnSync(process.execPath, ['-p', "require('electron')"], { cwd: root, encoding: 'utf8' });
    assertExitedCleanly(resolved);
    const executable = resolved.stdout.trim().split(/\r?\n/).pop();
    assert.ok(fs.existsSync(path.join(electronDir, 'path.txt')), 'path.txt missing');
    assert.ok(fs.existsSync(executable), `${executable} missing`);
    const { version } = JSON.parse(read('node_modules/electron/package.json'));
    assert.equal(fs.readFileSync(path.join(electronDir, 'dist', 'version'), 'utf8').trim().replace(/^v/, ''), version);
});

test('a verification command with a broken regex is reported as broken', () => {
    const result = runInShell("git grep -n -E '(alert|confirm|prompt)(' -- src resource");

    assert.equal(commandWorks(result), false);
});

test('standards documents contain no control characters', () => {
    for (const doc of standardsDocs) {
        assert.doesNotMatch(read(doc), /[\u0000-\u0008\u000B-\u001F]/, doc);
    }
});

test('verification commands in the standards documents still run', () => {
    const commands = standardsDocs
        .flatMap(file => [...read(file).matchAll(/验证：`([^`]+)`/g)].map(match => match[1]));

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

test('pnpm test installs the electron binary before the test files run in parallel', () => {
    const { scripts } = JSON.parse(read('package.json'));
    const install = scripts.test.indexOf('node node_modules/electron/install.js');

    assert.notEqual(install, -1, scripts.test);
    assert.ok(install < scripts.test.indexOf('node --test'), scripts.test);
});

test('workflow steps and jobs named in the standards documents exist', () => {
    const yaml = require('js-yaml');
    const references = [];
    for (const doc of standardsDocs) {
        for (const match of read(doc).matchAll(/`([\w-]+\.yml)` 的 `([^`]+)`/g)) {
            references.push({ doc, file: match[1], name: match[2] });
        }
    }
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

function packagedPath(extraFiles, source) {
    for (const { from, to, filter } of extraFiles) {
        if (from === source && filter === undefined) return to;
        const inside = path.posix.relative(from, source);
        if (!inside.startsWith('..') && JSON.stringify(filter) === '["**/*"]') return path.posix.join(to, inside);
    }
    return undefined;
}

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
