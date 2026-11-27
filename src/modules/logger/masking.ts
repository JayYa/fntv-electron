import { 
    maskingPatterns, 
    sensitiveKeywords,
    MaskType
} from './maskingConfig';
import { LogLevel } from './config';

const MAX_DEPTH = 10;

function maskValue(
    value: any, 
    maskType: MaskType = 'partial', 
    showStart: number = 3, 
    showEnd: number = 3
): string {
    if (!value || typeof value !== 'string') {
        return value;
    }

    const length = value.length;
    
    switch (maskType) {
        case 'full':
            return '*'.repeat(Math.min(length, 8));
            
        case 'partial':
            if (length <= showStart + showEnd) {
                return '*'.repeat(length);
            }
            const start = value.substring(0, showStart);
            const end = value.substring(length - showEnd);
            const maskLength = length - showStart - showEnd;
            return start + '*'.repeat(Math.min(maskLength, 10)) + end;
            
        case 'email':
            const emailMatch = value.match(/^([^@]+)@(.+)$/);
            if (emailMatch) {
                const [, localPart, domain] = emailMatch;
                if (localPart.length <= 2) {
                    return '*'.repeat(localPart.length) + '@' + domain;
                }
                return localPart.substring(0, 2) + '*'.repeat(Math.min(localPart.length - 2, 6)) + '@' + domain;
            }
            return value;

        case 'domain':
            return maskDomain(value);
            
        default:
            return value;
    }
}

function maskDomain(domainUrl: string): string {
    if (!domainUrl || typeof domainUrl !== 'string') {
        return domainUrl;
    }

    try {
        if (domainUrl.startsWith('http://') || domainUrl.startsWith('https://')) {
            const url = new URL(domainUrl);
            const protocol = url.protocol;
            const hostname = url.hostname;
            const port = url.port ? `:${url.port}` : '';
            const pathname = url.pathname;
            const search = url.search;
            const hash = url.hash;
            
            const maskedHostname = maskHostname(hostname);
            
            return `${protocol}//${maskedHostname}${port}${pathname}${search}${hash}`;
        } else {
            const colonIndex = domainUrl.lastIndexOf(':');
            if (colonIndex > 0 && /^\d+$/.test(domainUrl.substring(colonIndex + 1))) {
                const hostname = domainUrl.substring(0, colonIndex);
                const port = domainUrl.substring(colonIndex);
                return maskHostname(hostname) + port;
            } else {
                return maskHostname(domainUrl);
            }
        }
    } catch {
        const colonIndex = domainUrl.lastIndexOf(':');
        if (colonIndex > 0 && /^\d+$/.test(domainUrl.substring(colonIndex + 1))) {
            const hostname = domainUrl.substring(0, colonIndex);
            const port = domainUrl.substring(colonIndex);
            return maskHostname(hostname) + port;
        } else {
            return maskHostname(domainUrl);
        }
    }
}

function maskHostname(hostname: string): string {
    if (!hostname || typeof hostname !== 'string') {
        return hostname;
    }

    const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipPattern);
    if (ipMatch) {
        const [, ip1, ip2] = ipMatch;
        return `${ip1}.${ip2}.***.**`;
    }

    const parts = hostname.split('.');
    if (parts.length >= 2) {
        if (parts.length === 2) {
            const domain = parts[0];
            const tld = parts[1];
            if (domain.length <= 4) {
                return `*****.${tld}`;
            } else {
                const masked = domain.substring(0, 2) + '*'.repeat(Math.min(domain.length - 2, 5));
                return `${masked}.${tld}`;
            }
        } else {
            const mainDomain = parts.slice(-2).join('.');
            const subdomains = parts.slice(0, -2);
            if (subdomains.length > 0) {
                return `*****.${mainDomain}`;
            }
            return mainDomain;
        }
    }

    if (hostname.length <= 4) {
        return '*'.repeat(hostname.length);
    }
    return hostname.substring(0, 2) + '*'.repeat(Math.min(hostname.length - 2, 5));
}

function isFilePath(text: string): boolean {
    if (!text || typeof text !== 'string' || /^https?:\/\//i.test(text)) {
        return false;
    }
    
    const filePathPatterns = [
        /[A-Za-z]:\\/,
        /\/[^\/\s]+\//,
        /\.(js|go|exe|log|txt|json|xml|html|css|png|jpg|gif|pdf|doc|docx|zip|rar|dll|so)$/i,
        /\w+\.(js|go|exe|log|txt|json|xml|html|css|png|jpg|gif|pdf|doc|docx|zip|rar|dll|so)\b/i,
    ];
    
    return filePathPatterns.some(pattern => pattern.test(text));
}

function maskStringByPatterns(text: string): string {
    if (!text || typeof text !== 'string') {
        return text;
    }

    let maskedText = text;

    Object.entries(maskingPatterns).forEach(([, config]) => {
        config.patterns.forEach(pattern => {
            maskedText = maskedText.replace(pattern, (match, ...args) => {
                const sensitiveValue = args.find(arg => typeof arg === 'string' && arg.length > 0);
                if (sensitiveValue) {
                    if (isFilePath(sensitiveValue) || isFilePath(match)) {
                        return match;
                    }
                    
                    const maskedValue = maskValue(
                        sensitiveValue, 
                        config.maskType, 
                        config.showStart, 
                        config.showEnd
                    );
                    return match.replace(sensitiveValue, maskedValue);
                }
                return match;
            });
        });
    });

    return maskedText;
}

function isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return sensitiveKeywords.some(keyword => lowerKey.includes(keyword));
}

function errorFields(error: Error, includeStack: boolean): Record<string, unknown> {
    const fields: Record<string, unknown> = { name: error.name, message: error.message };
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) {
        fields.code = code;
    }
    if (includeStack && error.stack) {
        fields.stack = error.stack;
    }
    return fields;
}

function maskByKeys(value: unknown, includeStack: boolean, ancestors: object[]): unknown {
    if (ancestors.length > MAX_DEPTH) {
        return '[Object: too deep]';
    }
    if (value instanceof Error) {
        return maskByKeys(errorFields(value, includeStack), includeStack, ancestors);
    }
    if (value === null || typeof value !== 'object' || value instanceof Date || value instanceof RegExp) {
        return value;
    }
    if (ancestors.includes(value)) {
        throw new TypeError('Converting circular structure to JSON');
    }
    const path = [...ancestors, value];
    if (Array.isArray(value)) {
        return value.map(item => maskByKeys(item, includeStack, path));
    }

    const masked: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (!isSensitiveKey(key)) {
            masked[key] = maskByKeys(child, includeStack, path);
        } else if (typeof child === 'string') {
            masked[key] = maskValue(child, 'partial', 2, 2);
        } else if (child !== null && child !== undefined) {
            masked[key] = '[MASKED]';
        } else {
            masked[key] = child;
        }
    }
    return masked;
}

function serialize(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value !== null && typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

export function maskLogLine(level: LogLevel, message: string, args: readonly unknown[]): string {
    const includeStack = level === LogLevel.ERROR;
    const parts = [String(message), ...args.map(arg => serialize(maskByKeys(arg, includeStack, [])))];
    return maskStringByPatterns(parts.join(' '));
}
