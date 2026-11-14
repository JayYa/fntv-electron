import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 所有新内容先写进用户配置根目录下的 `.fntv-sync-*` 暂存目录，校验哈希、fsync，再 rename 到位。
// 暂存目录放在根目录而不是 scripts 下，mpv 不会把它当脚本加载；同一磁盘上 rename 才可用。

export const STAGING_PREFIX = '.fntv-sync-';

/** 待合并更新：用户改过的配置旁边的 `<文件>.fntv-new`，内容是新版。 */
export const PENDING_UPDATE_SUFFIX = '.fntv-new';

/** 清单和安装记录里的相对路径（正斜杠）在 root 下的文件系统路径。 */
export function resolveRelative(root: string, relative: string): string {
    return path.join(root, ...relative.split('/'));
}

export function removePath(target: string): void {
    fs.rmSync(target, { recursive: true, force: true });
}

function mkdirp(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

const SWAP_MARKER = 'target.json';

export function sha256File(file: string): string | undefined {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

function fsyncFile(file: string): void {
    const fd = fs.openSync(file, 'r+');
    try {
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * 清理上次中途退出留下的暂存目录。目录替换停在“旧目录已移开、新目录还没到位”时，先把旧目录放回去，
 * 托管目录里用户自己的文件不丢；这次同步再按正常流程换新。
 */
export function cleanupLeftoverStaging(mpvConfigDir: string): void {
    if (!fs.existsSync(mpvConfigDir)) return;
    for (const entry of fs.readdirSync(mpvConfigDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX)) {
            abandonStaging(mpvConfigDir, path.join(mpvConfigDir, entry.name));
        }
    }
}

// 放回停在半路的目录替换，再删掉暂存目录。下次启动清理残留和本次同步失败后收尾走同一条路。
function abandonStaging(mpvConfigDir: string, staging: string): void {
    if (!fs.existsSync(staging)) return;
    for (const swap of fs.readdirSync(staging, { withFileTypes: true })) {
        if (swap.isDirectory()) restoreInterruptedSwap(mpvConfigDir, path.join(staging, swap.name));
    }
    removePath(staging);
}

function restoreInterruptedSwap(mpvConfigDir: string, swapDir: string): void {
    let relative: unknown;
    try {
        relative = JSON.parse(fs.readFileSync(path.join(swapDir, SWAP_MARKER), 'utf8'));
    } catch {
        return;
    }
    if (typeof relative !== 'string') return;
    const destination = resolveRelative(mpvConfigDir, relative);
    const previous = path.join(swapDir, 'old');
    if (fs.existsSync(previous) && !fs.existsSync(destination)) {
        mkdirp(path.dirname(destination));
        fs.renameSync(previous, destination);
    }
}

export class Staging {
    readonly dir: string;
    private counter = 0;

    constructor(private readonly mpvConfigDir: string) {
        this.dir = path.join(mpvConfigDir, STAGING_PREFIX + crypto.randomBytes(6).toString('hex'));
        mkdirp(this.dir);
    }

    private nextPath(): string {
        this.counter += 1;
        return path.join(this.dir, String(this.counter));
    }

    /** 把来源复制进暂存并校验哈希、fsync；哈希不对说明便携配置和清单不一致，抛错。 */
    stageCopy(source: string, expectedSha256: string, destination: string = this.nextPath()): string {
        mkdirp(path.dirname(destination));
        fs.copyFileSync(source, destination);
        const actual = sha256File(destination);
        if (actual !== expectedSha256) {
            throw new Error(`Hash mismatch for ${source}: expected ${expectedSha256}, got ${actual ?? 'missing file'}`);
        }
        fsyncFile(destination);
        return destination;
    }

    /** 复制用户自己的文件（托管目录里清单没列出的），不校验哈希。 */
    stageCarry(source: string, destination: string): void {
        mkdirp(path.dirname(destination));
        fs.copyFileSync(source, destination);
        fsyncFile(destination);
    }

    stageText(text: string): string {
        const file = this.nextPath();
        fs.writeFileSync(file, text);
        fsyncFile(file);
        return file;
    }

    place(staged: string, target: string): void {
        mkdirp(path.dirname(target));
        fs.renameSync(staged, target);
    }

    /**
     * 新目录建在 `<暂存>/<n>/new`，交给 build 填满，再整目录换掉 relative 指向的目录。
     * 移开旧目录后失败时，dispose 按 `target.json` 把旧目录放回去，和下次启动清理残留时一样。
     */
    replaceDirectory(relative: string, build: (newDir: string) => void): void {
        const swapDir = this.nextPath();
        const fresh = path.join(swapDir, 'new');
        const destination = resolveRelative(this.mpvConfigDir, relative);
        mkdirp(fresh);
        build(fresh);
        fs.writeFileSync(path.join(swapDir, SWAP_MARKER), JSON.stringify(relative));
        fsyncFile(path.join(swapDir, SWAP_MARKER));
        if (fs.existsSync(destination)) {
            fs.renameSync(destination, path.join(swapDir, 'old'));
        } else {
            mkdirp(path.dirname(destination));
        }
        fs.renameSync(fresh, destination);
        removePath(swapDir);
    }

    /** 放回停在半路的目录替换，删掉暂存目录。 */
    dispose(): void {
        abandonStaging(this.mpvConfigDir, this.dir);
    }
}
