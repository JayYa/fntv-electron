export type MaskType = 'full' | 'partial' | 'email' | 'domain';

interface MaskingPatternConfig {
    patterns: RegExp[];
    maskType: MaskType;
    showStart?: number;
    showEnd?: number;
}

export const maskingPatterns: Record<string, MaskingPatternConfig> = {
    password: {
        patterns: [
            /password['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /pwd['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /passwd['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
        ],
        maskType: 'full'
    },

    token: {
        patterns: [
            /token['":\s*]*['"]*([^'",\s}]+)['"]*?/gi,
            /authorization['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /access_token['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /refresh_token['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /session[='":\s]*['"]*([a-f0-9]{32,})['"]*?/gi,
        ],
        maskType: 'partial',
        showStart: 4,
        showEnd: 4
    },

    phone: {
        patterns: [
            /phone['":\s]*['"]*(\d{11})['"]*?/gi,
            /mobile['":\s]*['"]*(\d{11})['"]*?/gi,
            /\b(1[3-9]\d{9})\b/g,
        ],
        maskType: 'partial',
        showStart: 3,
        showEnd: 4
    },

    idCard: {
        patterns: [
            /id_card['":\s]*['"]*(\d{15}|\d{18})['"]*?/gi,
            /idcard['":\s]*['"]*(\d{15}|\d{18})['"]*?/gi,
            /\b(\d{15}|\d{18})\b/g,
        ],
        maskType: 'partial',
        showStart: 4,
        showEnd: 4
    },

    email: {
        patterns: [
            /email['":\s]*['"]*([^'",\s}]+@[^'",\s}]+\.[^'",\s}]+)['"]*?/gi,
            /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
        ],
        maskType: 'email'
    },

    ip: {
        patterns: [
            /(?<![\d.])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?!\d)/g,
        ],
        maskType: 'domain'
    },

    domain: {
        patterns: [
            /domain['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /host['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /(?<![\w.-])url['"]?\s*[:=]\s*['"]?([^'",\s}]+)['"]?/gi,
            /(?<=[a-z])U(?:rl|RL)['"]?\s*[:=]\s*['"]?([^'",\s}]+)['"]?/g,
            /server['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /endpoint['":\s]*['"]*([^'",\s}]+)['"]*?/gi,
            /(https?:\/\/[^\s'"<>]+)/gi,
            /\b([a-zA-Z0-9]([a-zA-Z0-9\-]{1,61}[a-zA-Z0-9])?\.)+(?:com|org|net|edu|gov|mil|int|cn|top|xyz|info|biz|name|pro|aero|coop|museum|[a-z]{2})\b/gi,
        ],
        maskType: 'domain'
    },

    bankCard: {
        patterns: [
            /card_no['":\s]*['"]*(\d{16,19})['"]*?/gi,
            /bank_card['":\s]*['"]*(\d{16,19})['"]*?/gi,
            /\b(\d{16,19})\b/g,
        ],
        maskType: 'partial',
        showStart: 4,
        showEnd: 4
    },

    urlParams: {
        patterns: [
            /[?&](?:token|session|key|secret|password|pwd|redirect_uri)=([^&\s]+)/gi,
        ],
        maskType: 'partial',
        showStart: 4,
        showEnd: 4
    }
};

export const sensitiveKeywords: string[] = [
    'password', 'pwd', 'passwd', 'token', 'session', 'secret', 'key', 'auth',
    'phone', 'mobile', 'email', 'id_card', 'idcard', 'bank_card',
    'address', 'location', 'username',
    'domain', 'host', 'url', 'hostname', 'endpoint', 'server'
];
