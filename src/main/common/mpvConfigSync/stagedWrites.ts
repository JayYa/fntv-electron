import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 所有新内容先写进用户配置根目录下的 `.fntv-sync-*` 暂存目录，校验哈希、fsync，再 rename 到位。
// 暂存目录放在根目录而不是 scripts 下，mpv 不会把它当脚本加载；同一磁盘上 rename 才可用。

export const STAGING_PREFIX = '.fntv-sync-';

/** 同步对用户配置的全部写操作。默认是 node:fs；测试注入在第 N 次写入时抛错的实现。 */
export interface SyncFileOps {
    mkdir(dir: string): void;
    copyFile(source: string, destination: string): void;
    writeFile(file: string, data: string): void;
    rename(from: string, to: string): void;
    remove(target: string): void;
}

export const nodeFileOps: SyncFileOps = {
    mkdir: dir => fs.mkdirSync(dir, { recursive: true }),
    copyFile: (source, destination) => fs.copyFileSync(source, destination),
    writeFile: (file, data) => fs.writeFileSync(file, data),
    rename: (from, to) => fs.renameSync(from, to),
    remove: target => fs.rmSync(target, { recursive: true, force: true }),
};

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
export function cleanupLeftoverStaging(mpvConfigDir: string, ops: SyncFileOps): void {
    if (!fs.existsSync(mpvConfigDir)) return;
    for (const entry of fs.readdirSync(mpvConfigDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(STAGING_PREFIX)) continue;
        const staging = path.join(mpvConfigDir, entry.name);
        for (const swap of fs.readdirSync(staging, { withFileTypes: true })) {
            if (swap.isDirectory()) restoreInterruptedSwap(mpvConfigDir, path.join(staging, swap.name), ops);
        }
        ops.remove(staging);
    }
}

function restoreInterruptedSwap(mpvConfigDir: string, swapDir: string, ops: SyncFileOps): void {
    let relative: unknown;
    try {
        relative = JSON.parse(fs.readFileSync(path.join(swapDir, SWAP_MARKER), 'utf8'));
    } catch {
        return;
    }
    if (typeof relative !== 'string') return;
    const destination = path.join(mpvConfigDir, ...relative.split('/'));
    const previous = path.join(swapDir, 'old');
    if (fs.existsSync(previous) && !fs.existsSync(destination)) {
        ops.mkdir(path.dirname(destination));
        ops.rename(previous, destination);
    }
}

export class Staging {
    readonly dir: string;
    private counter = 0;

    constructor(private readonly mpvConfigDir: string, private readonly ops: SyncFileOps) {
        this.dir = path.join(mpvConfigDir, STAGING_PREFIX + crypto.randomBytes(6).toString('hex'));
        ops.mkdir(this.dir);
    }

    private nextPath(): string {
        this.counter += 1;
        return path.join(this.dir, String(this.counter));
    }

    /** 把来源复制进暂存并校验哈希、fsync；哈希不对说明便携配置和清单不一致，抛错。 */
    stageCopy(source: string, expectedSha256: string, destination: string = this.nextPath()): string {
        this.ops.mkdir(path.dirname(destination));
        this.ops.copyFile(source, destination);
        const actual = sha256File(destination);
        if (actual !== expectedSha256) {
            throw new Error(`Hash mismatch for ${source}: expected ${expectedSha256}, got ${actual ?? 'missing file'}`);
        }
        fsyncFile(destination);
        return destination;
    }

    /** 复制用户自己的文件（托管目录里清单没列出的），不校验哈希。 */
    stageCarry(source: string, destination: string): void {
        this.ops.mkdir(path.dirname(destination));
        this.ops.copyFile(source, destination);
        fsyncFile(destination);
    }

    stageText(text: string): string {
        const file = this.nextPath();
        this.ops.writeFile(file, text);
        fsyncFile(file);
        return file;
    }

    place(staged: string, target: string): void {
        this.ops.mkdir(path.dirname(target));
        this.ops.rename(staged, target);
    }

    /** 新目录建在 `<暂存>/<n>/new`，交给 build 填满，再整目录换掉 relative 指向的目录，失败时放回旧目录。 */
    replaceDirectory(relative: string, build: (newDir: string) => void): void {
        const swapDir = this.nextPath();
        const fresh = path.join(swapDir, 'new');
        const previous = path.join(swapDir, 'old');
        const destination = path.join(this.mpvConfigDir, ...relative.split('/'));
        this.ops.mkdir(fresh);
        build(fresh);
        this.ops.writeFile(path.join(swapDir, SWAP_MARKER), JSON.stringify(relative));
        fsyncFile(path.join(swapDir, SWAP_MARKER));
        const hadPrevious = fs.existsSync(destination);
        if (hadPrevious) {
            this.ops.rename(destination, previous);
        } else {
            this.ops.mkdir(path.dirname(destination));
        }
        try {
            this.ops.rename(fresh, destination);
        } catch (error) {
            if (hadPrevious) this.ops.rename(previous, destination);
            throw error;
        }
        this.ops.remove(swapDir);
    }

    dispose(): void {
        this.ops.remove(this.dir);
    }
}
