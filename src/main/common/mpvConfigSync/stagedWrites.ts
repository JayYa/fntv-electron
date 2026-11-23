import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const STAGING_PREFIX = '.fntv-sync-';

export const PENDING_UPDATE_SUFFIX = '.fntv-new';

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

export function cleanupLeftoverStaging(mpvConfigDir: string): void {
    if (!fs.existsSync(mpvConfigDir)) return;
    for (const entry of fs.readdirSync(mpvConfigDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX)) {
            abandonStaging(mpvConfigDir, path.join(mpvConfigDir, entry.name));
        }
    }
}

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

    dispose(): void {
        abandonStaging(this.mpvConfigDir, this.dir);
    }
}
