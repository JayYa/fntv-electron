import { BrowserWindow, type Session } from 'electron';
import { isIP } from 'net';
import * as tls from 'tls';
import { isTrusted, showCertificateTrustDialog } from './index';

const PROBE_TIMEOUT_MS = 10000;

const allowedCertificates = new Set<string>();

type UntrustedCertificate = { hostname: string; error: string; fingerprint: string };

const bareHostname = (hostname: string): string => hostname.replace(/^\[(.*)\]$/, '$1');

const certificateKey = (hostname: string, fingerprint: string): string => `${hostname} ${fingerprint}`;

function electronFingerprint(fingerprint256: string): string {
    return `sha256/${Buffer.from(fingerprint256.replaceAll(':', ''), 'hex').toString('base64')}`;
}

function probeUntrustedCertificate(url: URL): Promise<UntrustedCertificate | null> {
    const hostname = bareHostname(url.hostname);
    return new Promise(resolve => {
        const socket = tls.connect({
            host: hostname,
            port: Number(url.port || 443),
            servername: isIP(hostname) ? undefined : hostname,
            rejectUnauthorized: false,
            timeout: PROBE_TIMEOUT_MS,
        }, () => {
            const { fingerprint256 } = socket.getPeerCertificate();
            resolve(socket.authorized || !fingerprint256
                ? null
                : { hostname, error: String(socket.authorizationError), fingerprint: electronFingerprint(fingerprint256) });
            socket.destroy();
        });
        socket.on('timeout', () => {
            resolve(null);
            socket.destroy();
        });
        socket.on('error', () => resolve(null));
    });
}

export function verifyWithConfirmedCertificates(ses: Session): void {
    ses.setCertificateVerifyProc((request, callback) => {
        const confirmed = allowedCertificates.has(certificateKey(bareHostname(request.hostname), request.certificate.fingerprint));
        callback(confirmed ? 0 : -3);
    });
}

export async function confirmCertificate(baseUrl: string): Promise<boolean> {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') return true;
    const untrusted = await probeUntrustedCertificate(url);
    if (!untrusted) return true;
    if (!isTrusted(baseUrl)) {
        const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined;
        if (!await showCertificateTrustDialog(baseUrl, untrusted.error, parentWindow)) return false;
    }
    allowedCertificates.add(certificateKey(untrusted.hostname, untrusted.fingerprint));
    return true;
}
