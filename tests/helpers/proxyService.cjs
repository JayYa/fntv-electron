const http = require('node:http');
const path = require('node:path');

const SERVICE_DIR = path.join(__dirname, '..', '..', 'dest', 'modules', 'proxy_service');

const MEDIA = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));

async function startProxy(t, { rateLimitIntervalMs = 5, ...options } = {}) {
    const { startProxyService } = require(SERVICE_DIR);
    const logs = [];
    const record = (level) => (...args) => logs.push(`${level} ${args.map(String).join(' ')}`);
    const service = await startProxyService({
        port: 0,
        rateLimitIntervalMs,
        log: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') },
        ...options,
    });
    t.after(() => service.close());
    return { service, logs };
}

function get(service, requestPath, headers = {}, method = 'GET', body = undefined) {
    return new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port: service.port, path: requestPath, method, headers }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
            response.on('error', reject);
        });
        request.on('error', reject);
        request.end(body);
    });
}

function post(service, requestPath, body) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return get(service, requestPath, { 'Content-Type': 'application/json' }, 'POST', payload);
}

function sessionInput(nas, overrides = {}) {
    return {
        token: 'nas-token',
        account: 'alice',
        domain: nas.domain,
        accessCookie: 'gateway=granted; mode=web',
        skipVerify: false,
        useNasLocal: false,
        itemGuids: ['item-1'],
        ...overrides,
    };
}

module.exports = { SERVICE_DIR, MEDIA, startProxy, get, post, sessionInput };
