import * as fs from 'node:fs';
import * as path from 'node:path';

const LEGACY_PROXY_SECRET_FILENAME = 'proxy-secret';

export function removeLegacyProxySecret(userDataDir: string, log: { warn(message: string, ...args: unknown[]): void }): void {
    try {
        fs.rmSync(path.join(userDataDir, LEGACY_PROXY_SECRET_FILENAME), { force: true });
    } catch (error) {
        log.warn(`删除旧版 ${LEGACY_PROXY_SECRET_FILENAME} 失败:`, (error as NodeJS.ErrnoException).code ?? String(error));
    }
}
