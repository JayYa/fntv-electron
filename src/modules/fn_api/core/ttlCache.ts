interface Entry<V> {
    value: V;
    expiresAt: number;
}

export interface TtlCacheOptions {
    defaultTtl?: number;
    now?: () => number;
}

export class TtlCache<V = unknown> {
    private readonly entries = new Map<string, Entry<V>>();
    private readonly defaultTtl: number;
    private readonly now: () => number;

    constructor(options: TtlCacheOptions = {}) {
        this.defaultTtl = options.defaultTtl ?? 0;
        this.now = options.now ?? Date.now;
    }

    get(key: string): V | undefined {
        const entry = this.entries.get(key);
        if (entry === undefined) return undefined;
        if (this.isExpired(entry, this.now())) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key: string, value: V, ttl: number = this.defaultTtl): void {
        const now = this.now();
        for (const [existingKey, entry] of this.entries) {
            if (this.isExpired(entry, now)) this.entries.delete(existingKey);
        }
        this.entries.set(key, { value, expiresAt: ttl === 0 ? 0 : now + ttl * 1000 });
    }

    del(key: string): void {
        this.entries.delete(key);
    }

    private isExpired(entry: Entry<V>, now: number): boolean {
        return entry.expiresAt !== 0 && entry.expiresAt < now;
    }
}
