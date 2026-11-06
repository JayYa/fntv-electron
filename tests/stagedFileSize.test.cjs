const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'check-staged-file-size.cjs');
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

function check(dir) {
    return spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
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
    write(dir, 'scripts/check-staged-file-size.cjs', fs.readFileSync(script));
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
