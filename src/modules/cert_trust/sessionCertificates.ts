import { BrowserWindow, net, session, type Session } from 'electron';
import { isTrusted, showCertificateTrustDialog } from './index';

const PROBE_TIMEOUT_MS = 10000;
const ACCEPT = 0;
const USE_CHROMIUM_RESULT = -3;

const confirmedCertificates = new Set<string>();
let probeCount = 0;

type UntrustedCertificate = { hostname: string; error: string; fingerprint: string };

const bareHostname = (hostname: string): string => hostname.replace(/^\[(.*)\]$/, '$1');

const certificateKey = (hostname: string, fingerprint: string): string => `${hostname} ${fingerprint}`;

function probeUntrustedCertificate(url: URL): Promise<UntrustedCertificate | null> {
    const hostname = bareHostname(url.hostname);
    const probeSession = session.fromPartition(`cert-probe-${++probeCount}`);
    let untrusted: UntrustedCertificate | null = null;
    probeSession.setCertificateVerifyProc((request, callback) => {
        if (request.errorCode !== 0 && bareHostname(request.hostname) === hostname) {
            untrusted = { hostname, error: request.verificationResult, fingerprint: request.certificate.fingerprint };
        }
        callback(USE_CHROMIUM_RESULT);
    });
    return new Promise(resolve => {
        const request = net.request({ method: 'HEAD', url: url.origin, session: probeSession, redirect: 'manual' });
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            request.abort();
            resolve(untrusted);
        };
        const timeout = setTimeout(finish, PROBE_TIMEOUT_MS);
        request.on('response', finish);
        request.on('redirect', finish);
        request.on('error', finish);
        request.end();
    });
}

export function acceptConfirmedCertificates(ses: Session): void {
    ses.setCertificateVerifyProc((request, callback) => {
        const key = certificateKey(bareHostname(request.hostname), request.certificate.fingerprint);
        callback(confirmedCertificates.has(key) ? ACCEPT : USE_CHROMIUM_RESULT);
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
    confirmedCertificates.add(certificateKey(untrusted.hostname, untrusted.fingerprint));
    return true;
}
