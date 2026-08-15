import * as http from 'node:http';

export const PROXY_HOST = '127.0.0.1';
export const PROXY_PORT = 22345;
export const PROXY_HEALTH_URL = `http://${PROXY_HOST}:${PROXY_PORT}/health`;

interface ProxyHealthResponse {
    service?: string;
    protocol?: number;
}

export function isProxyHealthPayload(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const payload = value as ProxyHealthResponse;
    return payload.service === 'fntv-proxy' && payload.protocol === 1;
}

export function probeProxyHealth(timeoutMs: number = 500): Promise<boolean> {
    return new Promise(resolve => {
        const request = http.get(PROXY_HEALTH_URL, response => {
            const chunks: Buffer[] = [];

            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    resolve(false);
                    return;
                }

                try {
                    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    resolve(isProxyHealthPayload(payload));
                } catch {
                    resolve(false);
                }
            });
        });

        request.setTimeout(timeoutMs, () => request.destroy());
        request.on('error', () => resolve(false));
    });
}

export async function waitForProxyHealth(timeoutMs: number = 10000, intervalMs: number = 100): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await probeProxyHealth(Math.min(intervalMs, 500))) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return false;
}
