const WRONG_VERSION_NUMBER = /wrong[_ ]version[_ ]number/i;

export function isHttpsPortMismatch(rawMessage: string | undefined): boolean {
    return rawMessage !== undefined && WRONG_VERSION_NUMBER.test(rawMessage);
}

export const HTTPS_PORT_MISMATCH_MESSAGE = '无法用 HTTPS 连接到服务器，请检查 HTTPS 设置和端口。';
