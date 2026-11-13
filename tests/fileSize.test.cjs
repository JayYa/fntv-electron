const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'check-file-size.cjs');
const LIMIT_BYTES = 20000;

function createRepo(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-size-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    git(dir, 'init', '-q');
    git(dir, 'config', 'core.autocrlf', 'false');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'user.email', 'test@example.com');
    return dir;
}

function git(dir, ...args) {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function write(dir, file, content) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
}

function stage(dir, file, content) {
    write(dir, file, content);
    git(dir, 'add', '--', file);
}

function check(dir, ...args) {
    return spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
}

test('allows a staged file of exactly 5000 tokens', t => {
    const dir = createRepo(t);
    stage(dir, 'a.ts', 'a'.repeat(LIMIT_BYTES));

    assert.equal(check(dir).status, 0);
});

test('rejects a staged file over 5000 tokens and explains how to split it', t => {
    const dir = createRepo(t);
    stage(dir, 'src/a.ts', 'a'.repeat(LIMIT_BYTES + 1));

    const result = check(dir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/a\.ts: 5001 tokens/);
    assert.match(result.stderr, /按职责拆分/);
    assert.match(result.stderr, /git add/);
    assert.match(result.stderr, /--no-verify/);
});

test('counts bytes, not characters', t => {
    const dir = createRepo(t);
    stage(dir, 'a.md', '中'.repeat(7000));

    assert.equal(check(dir).status, 1);
});

test('reads the staged content, not the working tree', t => {
    const dir = createRepo(t);
    stage(dir, 'small.ts', 'a');
    write(dir, 'small.ts', 'a'.repeat(LIMIT_BYTES + 1));
    stage(dir, 'big.ts', 'a'.repeat(LIMIT_BYTES + 1));
    write(dir, 'big.ts', 'a');

    const result = check(dir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /big\.ts/);
    assert.doesNotMatch(result.stderr, /small\.ts/);
});

test('ignores unstaged files and staged deletions', t => {
    const dir = createRepo(t);
    stage(dir, 'old.ts', 'a'.repeat(LIMIT_BYTES + 1));
    git(dir, 'commit', '-q', '--no-verify', '-m', 'old');
    git(dir, 'rm', '-q', 'old.ts');
    write(dir, 'untracked.ts', 'a'.repeat(LIMIT_BYTES + 1));

    assert.equal(check(dir).status, 0);
});

test('ignores binary files', t => {
    const dir = createRepo(t);
    stage(dir, 'a.png', Buffer.concat([Buffer.from([0x89, 0x00]), Buffer.alloc(LIMIT_BYTES + 1, 1)]));

    assert.equal(check(dir).status, 0);
});

test('ignores files marked -agent-authored in the staged .gitattributes', t => {
    const dir = createRepo(t);
    stage(dir, '.gitattributes', 'pnpm-lock.yaml -agent-authored\ndest/** -agent-authored\n');
    stage(dir, 'pnpm-lock.yaml', 'a'.repeat(LIMIT_BYTES + 1));
    stage(dir, 'dest/main.js', 'a'.repeat(LIMIT_BYTES + 1));

    assert.equal(check(dir).status, 0);
});

test('handles non-ASCII file names', t => {
    const dir = createRepo(t);
    stage(dir, '文档 说明.md', 'a'.repeat(LIMIT_BYTES + 1));

    const result = check(dir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /文档 说明\.md/);
});

test('the installed hook blocks a real commit', t => {
    const dir = createRepo(t);
    write(dir, 'scripts/check-file-size.cjs', fs.readFileSync(script));
    write(dir, '.githooks/pre-commit', fs.readFileSync(path.join(root, '.githooks', 'pre-commit')));
    fs.chmodSync(path.join(dir, '.githooks', 'pre-commit'), 0o755);
    git(dir, 'config', 'core.hooksPath', '.githooks');
    stage(dir, 'a.ts', 'a'.repeat(LIMIT_BYTES + 1));

    const result = spawnSync('git', ['commit', '-q', '-m', 'big'], { cwd: dir, encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /a\.ts: 5001 tokens/);
});

test('pnpm install points git at the tracked hooks and lockfiles stay exempt', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts.prepare, 'git config core.hooksPath .githooks');

    const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
    assert.match(attributes, /^pnpm-lock\.yaml -agent-authored$/m);
});

const WARN_BYTES = LIMIT_BYTES * 0.85;

function commit(dir, message) {
    git(dir, 'commit', '-q', '--no-verify', '-m', message);
}

// 模拟 PR：main 是 base，feature 分支是 head。
function createPullRequest(t, baseFiles) {
    const dir = createRepo(t);
    git(dir, 'checkout', '-q', '-b', 'main');
    stage(dir, 'README.md', 'base');
    for (const [file, content] of Object.entries(baseFiles)) stage(dir, file, content);
    commit(dir, 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    return dir;
}

test('warns about a staged file over 80% of the limit but still passes', t => {
    const dir = createRepo(t);
    stage(dir, 'src/near.ts', 'a'.repeat(WARN_BYTES));

    const result = check(dir);

    assert.equal(result.status, 0);
    assert.match(result.stderr, /src\/near\.ts: 4250 tokens（85%）/);
});

test('does not warn about a staged file at exactly 80% of the limit', t => {
    const dir = createRepo(t);
    stage(dir, 'a.ts', 'a'.repeat(LIMIT_BYTES * 0.8));

    const result = check(dir);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
});

test('neither warns nor fails for exempt and binary files in either mode', t => {
    const files = {
        '.gitattributes': 'big.lock -agent-authored\nnear.lock -agent-authored\n',
        'big.lock': 'a'.repeat(LIMIT_BYTES + 1),
        'near.lock': 'a'.repeat(WARN_BYTES),
        'big.png': Buffer.concat([Buffer.from([0x89, 0x00]), Buffer.alloc(LIMIT_BYTES + 1, 1)]),
        'near.png': Buffer.concat([Buffer.from([0x89, 0x00]), Buffer.alloc(WARN_BYTES, 1)]),
    };
    const staged = createRepo(t);
    const pr = createPullRequest(t, {});
    for (const [file, content] of Object.entries(files)) {
        stage(staged, file, content);
        stage(pr, file, content);
    }
    commit(pr, 'head');

    for (const result of [check(staged), check(pr, '--base', 'main')]) {
        assert.equal(result.status, 0);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout, '');
    }
});

test('PR mode skips large files that exist in the base and were not changed', t => {
    const dir = createPullRequest(t, { 'old-big.ts': 'a'.repeat(LIMIT_BYTES + 1), 'old-near.ts': 'a'.repeat(WARN_BYTES) });
    stage(dir, 'README.md', 'changed');
    commit(dir, 'head');

    const result = check(dir, '--base', 'main');

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '');
});

test('PR mode checks added, modified and renamed files in the head commit, not the index', t => {
    const dir = createPullRequest(t, { 'modified.ts': 'a', 'renamed-from.ts': 'b'.repeat(LIMIT_BYTES + 1) });
    stage(dir, 'added.ts', 'a'.repeat(LIMIT_BYTES + 1));
    stage(dir, 'modified.ts', 'a'.repeat(WARN_BYTES));
    git(dir, 'mv', 'renamed-from.ts', 'renamed-to.ts');
    commit(dir, 'head');
    stage(dir, 'added.ts', 'a');
    stage(dir, 'staged-only.ts', 'a'.repeat(LIMIT_BYTES + 1));

    const result = check(dir, '--base', 'main');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /added\.ts: 5001 tokens/);
    assert.match(result.stderr, /renamed-to\.ts: 5001 tokens/);
    assert.match(result.stderr, /modified\.ts: 4250 tokens（85%）/);
    assert.doesNotMatch(result.stderr, /staged-only\.ts|renamed-from\.ts/);
});

test('PR mode ignores changes the base branch made after the PR branched off', t => {
    const dir = createPullRequest(t, {});
    stage(dir, 'feature.ts', 'a');
    commit(dir, 'head');
    git(dir, 'checkout', '-q', 'main');
    stage(dir, 'main-big.ts', 'a'.repeat(LIMIT_BYTES + 1));
    commit(dir, 'main moved on');
    git(dir, 'checkout', '-q', 'feature');

    assert.equal(check(dir, '--base', 'main').status, 0);
});

test('PR mode reads agent-authored from the head .gitattributes, not the base or the index', t => {
    const dir = createPullRequest(t, { '.gitattributes': 'gen.js -agent-authored\n' });
    stage(dir, '.gitattributes', 'other.js -agent-authored\n');
    stage(dir, 'gen.js', 'a'.repeat(LIMIT_BYTES + 1));
    commit(dir, 'head');
    stage(dir, '.gitattributes', 'gen.js -agent-authored\n');

    const result = check(dir, '--base', 'main');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /gen\.js: 5001 tokens/);
});

test('PR mode emits GitHub error and warning annotations', t => {
    const dir = createPullRequest(t, {});
    stage(dir, 'src/big.ts', 'a'.repeat(LIMIT_BYTES + 1));
    stage(dir, 'src/near.ts', 'a'.repeat(WARN_BYTES));
    stage(dir, 'odd,name%.ts', 'a'.repeat(WARN_BYTES));
    commit(dir, 'head');

    const result = check(dir, '--base', 'main');

    assert.equal(result.status, 1);
    assert.match(result.stdout, /^::error file=src\/big\.ts::5001 tokens，超过上限 5000 tokens$/m);
    assert.match(result.stdout, /^::warning file=src\/near\.ts::4250 tokens，已到上限 5000 tokens 的 85%25$/m);
    assert.match(result.stdout, /^::warning file=odd%2Cname%25\.ts::/m);
});

test('staged mode emits no annotations', t => {
    const dir = createRepo(t);
    stage(dir, 'big.ts', 'a'.repeat(LIMIT_BYTES + 1));
    stage(dir, 'near.ts', 'a'.repeat(WARN_BYTES));

    assert.equal(check(dir).stdout, '');
});
