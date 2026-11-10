import * as fs from 'node:fs';
import * as path from 'node:path';

// Go 版 Proxy 的密钥文件。TS 版不再用密钥（ADR-0004），升级后启动时删掉。
const LEGACY_PROXY_SECRET_FILENAME = 'proxy-secret';

// 删不掉（例如 Windows 上文件被占用）只记日志：TS 版用不到这个文件，不影响启动，下次启动再删。
export function removeLegacyProxySecret(userDataDir: string, log: { warn(message: string, ...args: unknown[]): void }): void {
    try {
        fs.rmSync(path.join(userDataDir, LEGACY_PROXY_SECRET_FILENAME), { force: true });
    } catch (error) {
        log.warn(`删除旧版 ${LEGACY_PROXY_SECRET_FILENAME} 失败:`, (error as NodeJS.ErrnoException).code ?? String(error));
    }
}
