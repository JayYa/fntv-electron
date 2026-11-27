import { normalizeCertificateHost } from './host';

export interface TrustAnswer {
    trust: boolean;
    remember: boolean;
}

export type TrustPrompt<Origin> = (host: string, error: string, origin?: Origin) => Promise<TrustAnswer>;

export interface RememberedHosts {
    has(host: string): boolean;
    add(host: string): void;
}

export type CertificateAttempt<T> = { ok: true; value: T } | { ok: false; certificateError: string };

export type CertificateFailureReason = 'declined' | 'still-untrusted';

export type CertificateOutcome<T> = { ok: true; value: T } | { ok: false; reason: CertificateFailureReason };

export function createCertificateTrust<Origin>({ askUser, remembered }: {
    askUser: TrustPrompt<Origin>;
    remembered: RememberedHosts;
}) {
    const trustedThisRun = new Set<string>();
    const openPrompts = new Map<string, Promise<boolean>>();

    function isTrusted(url: string): boolean {
        const host = normalizeCertificateHost(url);
        return trustedThisRun.has(host) || remembered.has(host);
    }

    async function ask(host: string, error: string, origin?: Origin): Promise<boolean> {
        const answer = await askUser(host, error, origin);
        if (answer.trust) trustedThisRun.add(host);
        if (answer.trust && answer.remember) remembered.add(host);
        return answer.trust;
    }

    function confirmTrust(url: string, error: string, origin?: Origin): Promise<boolean> {
        if (isTrusted(url)) return Promise.resolve(true);
        const host = normalizeCertificateHost(url);
        const open = openPrompts.get(host);
        if (open) return open;
        const asking = ask(host, error, origin).finally(() => openPrompts.delete(host));
        openPrompts.set(host, asking);
        return asking;
    }

    async function withCertificateTrust<T>(
        url: string,
        attempt: () => Promise<CertificateAttempt<T>>,
    ): Promise<CertificateOutcome<T>> {
        const first = await attempt();
        if (first.ok) return first;
        if (!await confirmTrust(url, first.certificateError)) return { ok: false, reason: 'declined' };
        const second = await attempt();
        return second.ok ? second : { ok: false, reason: 'still-untrusted' };
    }

    return { isTrusted, confirmTrust, withCertificateTrust };
}
