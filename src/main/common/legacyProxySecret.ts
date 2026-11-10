import * as fs from 'node:fs';
import * as path from 'node:path';

// Go 版 Proxy 的密钥文件。TS 版不再用密钥（ADR-0004），升级后启动时删掉。
const LEGACY_PROXY_SECRET_FILENAME = 'proxy-secret';

export function removeLegacyProxySecret(userDataDir: string): void {
    fs.rmSync(path.join(userDataDir, LEGACY_PROXY_SECRET_FILENAME), { force: true });
}
