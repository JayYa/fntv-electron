// 播放会话：一次播放期间的短期授权，只允许取创建时列出的播放项。规则与 Go 版一致。
import * as crypto from 'node:crypto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PLAYLIST_ITEMS = 10000;
const MAX_ACCESS_COOKIE_LENGTH = 16384;

export interface PlaybackSessionInput {
    token: string;
    account: string;
    domain: string;
    accessCookie?: string;
    skipVerify: boolean;
    useNasLocal: boolean;
    itemGuids: string[];
}

export interface PlaybackSession {
    token: string;
    account: string;
    domain: string;
    accessCookie: string;
    skipVerify: boolean;
    useNasLocal: boolean;
}

interface Entry {
    session: PlaybackSession;
    allowedItems: Set<string>;
    expiresAt: number;
}

export class PlaybackSessionStore {
    private readonly sessions = new Map<string, Entry>();

    // 入参不合法时抛错，错误信息与 Go 版相同。
    create(input: PlaybackSessionInput): string {
        const itemGuids = Array.isArray(input.itemGuids) ? input.itemGuids : [];
        if (!input.token || !input.account || !input.domain || itemGuids.length === 0) {
            throw new Error('missing required session parameters');
        }
        if (itemGuids.length > MAX_PLAYLIST_ITEMS) {
            throw new Error('too many playlist items');
        }
        const accessCookie = input.accessCookie ?? '';
        if (Buffer.byteLength(accessCookie, 'utf8') > MAX_ACCESS_COOKIE_LENGTH || /[\r\n]/.test(accessCookie)) {
            throw new Error('invalid access cookie');
        }
        const allowedItems = new Set<string>();
        for (const guid of itemGuids) {
            if (!guid) throw new Error('empty playlist item');
            allowedItems.add(guid);
        }

        const id = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        for (const [key, entry] of this.sessions) {
            if (now > entry.expiresAt) this.sessions.delete(key);
        }
        this.sessions.set(id, {
            session: {
                token: input.token,
                account: input.account,
                domain: input.domain,
                accessCookie,
                skipVerify: input.skipVerify === true,
                useNasLocal: input.useNasLocal === true,
            },
            allowedItems,
            expiresAt: now + SESSION_TTL_MS,
        });
        return id;
    }

    // 会话不存在、已过期或不含这个播放项时返回 undefined；成功时有效期顺延 24 小时。
    resolve(id: string, itemGuid: string): PlaybackSession | undefined {
        const entry = this.sessions.get(id);
        if (!entry || Date.now() > entry.expiresAt) {
            this.sessions.delete(id);
            return undefined;
        }
        if (!entry.allowedItems.has(itemGuid)) return undefined;
        entry.expiresAt = Date.now() + SESSION_TTL_MS;
        return entry.session;
    }
}
