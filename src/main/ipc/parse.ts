import type { HistoryKey } from '../../modules/fn_config/loginStore';
import { InvalidPayload } from './adapter';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export function record(raw: unknown, what: string): Record<string, unknown> {
    if (!isRecord(raw)) throw new InvalidPayload(`${what}不是对象`);
    return raw;
}

export function string(value: unknown, what: string): string {
    if (typeof value !== 'string') throw new InvalidPayload(`${what}不是字符串`);
    return value;
}

export function boolean(value: unknown, what: string): boolean {
    if (typeof value !== 'boolean') throw new InvalidPayload(`${what}不是布尔值`);
    return value;
}

export function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
    return value === undefined ? undefined : parse(value);
}

export function historyKey(raw: unknown): HistoryKey {
    const { domain, account } = record(raw, '登录历史');
    return { domain: string(domain, '地址'), account: string(account, '账号') };
}
