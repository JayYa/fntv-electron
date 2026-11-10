// 在单独的进程里启动 HTTPS 假 NAS 和 Proxy 服务，取一次流，把 MPV 收到的状态码打印到 stdout。
// 系统证书库在进程启动后读取一次，所以要验证系统证书时用环境变量（如 SSL_CERT_FILE）启动这个脚本。
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { startFakeFnMedia } = require('./fakeFnMedia.cjs');

const { startProxyService } = require(path.join(__dirname, '..', '..', 'dest', 'modules', 'proxy_service'));
const TLS_DIR = path.join(__dirname, '..', 'fixtures', 'tls');

async function main() {
    const cleanups = [];
    const t = { after: (fn) => cleanups.push(fn) };
    const nas = await startFakeFnMedia(t, {
        media: { 'media-1': Buffer.from('secure bytes') },
        streams: { 'item-1': ['media-1'] },
        tls: { key: fs.readFileSync(path.join(TLS_DIR, 'nas-key.pem')), cert: fs.readFileSync(path.join(TLS_DIR, 'nas.pem')) },
    });
    const service = await startProxyService({ port: 0, rateLimitIntervalMs: 5 });
    const session = service.createPlaybackSession({
        token: 'nas-token', account: 'alice', domain: nas.domain,
        skipVerify: process.argv[2] === 'skipVerify', useNasLocal: false, itemGuids: ['item-1'],
    });
    const status = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: service.port, path: `/api/v1/playvideo/item-1?session=${session}` }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
        }).on('error', reject);
    });
    process.stdout.write(String(status));
    await service.close();
    for (const cleanup of cleanups) await cleanup();
}

main().catch((error) => {
    process.stderr.write(String(error && error.stack));
    process.exit(1);
});
