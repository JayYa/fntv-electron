import { 
    maskingPatterns, 
    maskingEnabled, 
    sensitiveKeywords,
    MaskType
} from './maskingConfig';

export function maskValue(
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
    if (!text || typeof text !== 'string') {
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

export function maskStringByPatterns(text: string): string {
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

export function isSensitiveKey(key: string): boolean {
    if (!key || typeof key !== 'string') {
        return false;
    }
    
    const lowerKey = key.toLowerCase();
    return sensitiveKeywords.some(keyword => lowerKey.includes(keyword));
}

export function maskObjectDeep(obj: any, depth: number = 0, maxDepth: number = 10): any {
    if (depth > maxDepth) {
        return '[Object: too deep]';
    }

    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj !== 'object') {
        if (typeof obj === 'string') {
            return maskStringByPatterns(obj);
        }
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => maskObjectDeep(item, depth + 1, maxDepth));
    }

    if (obj instanceof Date || obj instanceof RegExp || obj instanceof Error) {
        return obj;
    }

    const maskedObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
        if (isSensitiveKey(key)) {
            if (typeof value === 'string') {
                maskedObj[key] = maskValue(value, 'partial', 2, 2);
            } else if (value !== null && value !== undefined) {
                maskedObj[key] = '[MASKED]';
            } else {
                maskedObj[key] = value;
            }
        } else {
            maskedObj[key] = maskObjectDeep(value, depth + 1, maxDepth);
        }
    }

    return maskedObj;
}

export function maskSensitiveData(data: any): any {
    if (!maskingEnabled) {
        return data;
    }

    try {
        if (data === null || data === undefined) {
            return data;
        }

        if (typeof data === 'string') {
            return maskStringByPatterns(data);
        }

        if (typeof data !== 'object') {
            return data;
        }

        return maskObjectDeep(data);

    } catch (error) {
        return '[MASKING_ERROR: ' + (error as Error).message + ']';
    }
}

export function maskLogArguments(...args: any[]): any[] {
    if (!maskingEnabled) {
        return args;
    }

    const combinedString = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join('');
    
    const maskedCombined = maskStringByPatterns(combinedString);
    
    if (maskedCombined !== combinedString) {
        return [maskedCombined];
    }
    
    return args.map(arg => maskSensitiveData(arg));
}

export function maskError(error: any): any {
    if (!error) {
        return error;
    }

    if (error instanceof Error) {
        return {
            name: error.name,
            message: maskStringByPatterns(error.message),
            stack: error.stack ? maskStringByPatterns(error.stack) : undefined
        };
    }

    return maskSensitiveData(error);
}
