const WRONG_VERSION_NUMBER = /wrong[_ ]version[_ ]number/i;

export function isHttpsPortMismatch(rawMessage: string | undefined): boolean {
    return rawMessage !== undefined && WRONG_VERSION_NUMBER.test(rawMessage);
}
