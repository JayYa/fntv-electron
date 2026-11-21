#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PIN_JSON = 'mpv-archive.json';
const README = 'README.md';
const RUNTIME_DOC = 'docs/external-runtime.md';
const TAG_PATTERN = /^fntv-mpv-v(\d{8}_\d{6})$/;
const ASSET_PATTERN = /^[A-Za-z0-9._-]+\.zip$/;

function read(root, file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

function readPinnedArchive(root = ROOT) {
    const pinned = JSON.parse(read(root, PIN_JSON));
    for (const key of ['repo', 'tag', 'asset', 'sha256']) {
        if (typeof pinned[key] !== 'string' || !pinned[key]) throw new Error(`${PIN_JSON} 缺少 ${key}`);
    }
    return pinned;
}

function tagTime(tag) {
    const match = tag.match(TAG_PATTERN);
    if (!match) throw new Error(`tag 格式不是 fntv-mpv-v<yyyyMMdd_HHmmss>：${tag}`);
    return match[1];
}

function isNewerTag(candidate, pinned) {
    return tagTime(candidate) > tagTime(pinned);
}

function archiveFromRelease(release) {
    const tag = release.tag_name;
    tagTime(tag);
    const zips = (release.assets ?? []).filter(asset => asset.name.endsWith('.zip'));
    if (zips.length !== 1) {
        throw new Error(`${tag} 应恰好有一个 .zip 资产，实际：${zips.map(asset => asset.name).join(', ') || '无'}`);
    }
    const [asset] = zips;
    if (!ASSET_PATTERN.test(asset.name)) throw new Error(`资产名含不允许的字符：${asset.name}`);
    const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '');
    if (!digest) throw new Error(`${tag} 的资产 ${asset.name} 没有 sha256 digest：${asset.digest}`);
    return { tag, asset: asset.name, sha256: digest[1] };
}

function replaceAll(text, from, to, file, what) {
    const count = text.split(from).length - 1;
    if (count === 0) throw new Error(`${file} 里找不到${what} ${from}`);
    return text.split(from).join(to);
}

function pinArchive(root, next) {
    const current = readPinnedArchive(root);
    const pinned = `${JSON.stringify({ repo: current.repo, tag: next.tag, asset: next.asset, sha256: next.sha256 }, null, 4)}\n`;
    let readme = replaceAll(read(root, README), current.tag, next.tag, README, ' tag');
    readme = replaceAll(readme, current.asset, next.asset, README, '资产名');
    const runtimeDoc = replaceAll(read(root, RUNTIME_DOC), current.tag, next.tag, RUNTIME_DOC, ' tag');
    fs.writeFileSync(path.join(root, PIN_JSON), pinned);
    fs.writeFileSync(path.join(root, README), readme);
    fs.writeFileSync(path.join(root, RUNTIME_DOC), runtimeDoc);
}

async function fetchRelease(repo, tag, token) {
    const url = tag
        ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
        : `https://api.github.com/repos/${repo}/releases/latest`;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'fntv-electron-update-mpv-archive' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
    return response.json();
}

function parseArgs(args) {
    if (args.length === 0) return { tag: null };
    if (args.length === 2 && args[0] === '--tag' && args[1]) return { tag: args[1] };
    throw new Error('用法：update-mpv-archive.cjs [--tag <tag>]');
}

function writeOutputs(file, outputs) {
    if (!file) return;
    fs.appendFileSync(file, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
}

async function run(args, deps = {}) {
    const { root = ROOT, env = process.env, fetch: getRelease = fetchRelease, log = text => console.log(text) } = deps;
    const { tag } = parseArgs(args);
    const previous = readPinnedArchive(root);
    const next = archiveFromRelease(await getRelease(previous.repo, tag, env.GH_TOKEN || env.GITHUB_TOKEN));
    if (tag && next.tag !== tag) throw new Error(`请求的是 ${tag}，API 返回 ${next.tag}`);

    const same = next.tag === previous.tag && next.asset === previous.asset && next.sha256 === previous.sha256;
    const updated = !same && (tag !== null || isNewerTag(next.tag, previous.tag));
    if (updated) {
        pinArchive(root, next);
        log(`MPV 归档 ${previous.tag} -> ${next.tag}（${next.asset}，sha256 ${next.sha256}）`);
        writeOutputs(env.GITHUB_OUTPUT, { updated: true, 'previous-tag': previous.tag, ...next });
    } else {
        log(`MPV 归档保持 ${previous.tag}，Release 上是 ${next.tag}`);
        writeOutputs(env.GITHUB_OUTPUT, { updated: false, 'previous-tag': previous.tag });
    }
    return { updated, previous, next };
}

if (require.main === module) {
    run(process.argv.slice(2)).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { archiveFromRelease, isNewerTag, pinArchive, readPinnedArchive, run };
