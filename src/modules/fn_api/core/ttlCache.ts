// 进程内的键值缓存，每个条目按秒设过期时间。替代 node-cache，只保留 ApiService 用到的 get、set、del。
// 和 node-cache 一样：不传 ttl 时用默认值，ttl 为 0 表示不过期，到过期时刻那一毫秒仍能读到。
// 和 node-cache 不同：不拷贝值，get 返回 set 时的同一个引用；没有定时清理，get 时删掉读到的过期条目，set 时清掉全部过期条目。

interface Entry<V> {
    value: V;
    // 0 表示不过期。
    expiresAt: number;
}

export interface TtlCacheOptions {
    // 默认过期时间（秒），默认 0，即不过期。
    defaultTtl?: number;
    // 当前时间（毫秒），默认 Date.now。
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
