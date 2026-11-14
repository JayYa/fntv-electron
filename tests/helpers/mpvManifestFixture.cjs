// MPV 配置同步测试的夹具：在临时目录里造便携配置、清单和用户配置，读回目录内容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function roleOf(file) {
    if (file === 'danmaku-history.json') return 'seed';
    if (file === 'mpv.conf' || file === 'input.conf' || file.startsWith('script-opts/')) return 'config';
    return 'managed';
}

const MANAGED_DIRS = ['scripts/uosc', 'scripts/uosc_danmaku', 'scripts/smart_skip'];

// files: 路径 -> 内容；history: 路径 -> 历史归档里出现过的其它内容；obsolete: 路径 -> 以前发过的内容列表。
function writeArchive(root, name, { files, history = {}, obsolete = {}, formatVersion = 1, provides = {} }) {
    const archiveDir = path.join(root, name);
    const portable = path.join(archiveDir, 'portable_config');
    writeTree(portable, files);
    const manifest = {
        formatVersion,
        archiveVersion: name,
        components: {},
        provides,
        managedDirs: MANAGED_DIRS,
        files: Object.entries(files).map(([file, content]) => ({
            path: file,
            sha256: sha256(content),
            role: roleOf(file),
            knownHashes: [...new Set([...(history[file] ?? []), content].map(sha256))],
        })),
        obsolete: Object.entries(obsolete).map(([file, contents]) => ({
            path: file,
            knownHashes: contents.map(sha256),
        })),
    };
    const manifestPath = path.join(archiveDir, 'fntv-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return { portableConfigDir: portable, manifestPath, manifest };
}

function writeTree(dir, files) {
    for (const [file, content] of Object.entries(files)) {
        const target = path.join(dir, ...file.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
}

// 目录内容：相对路径（正斜杠）-> 文本内容，排好序，便于 deepEqual。
function readTree(dir) {
    const result = {};
    if (!fs.existsSync(dir)) return result;
    const walk = (current, prefix) => {
        for (const item of fs.readdirSync(current, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${item.name}` : item.name;
            const full = path.join(current, item.name);
            if (item.isDirectory()) walk(full, rel);
            else result[rel] = fs.readFileSync(full, 'utf8');
        }
    };
    walk(dir, '');
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function tempRoot(t, label) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `fntv-mpv-${label}-`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

function readRecord(userDir) {
    return JSON.parse(fs.readFileSync(path.join(userDir, 'fntv', 'installed.json'), 'utf8'));
}

module.exports = {
    sha256,
    writeArchive,
    writeTree,
    readTree,
    readRecord,
    tempRoot,
};
