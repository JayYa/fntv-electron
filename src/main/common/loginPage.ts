import * as path from 'path';
import { fileURLToPath } from 'url';

export const LOGIN_PAGE_PATH = path.join(__dirname, '../../../resource/login/index.html');

type FrameEvent = {
    senderFrame?: { url: string } | null;
};

export function isLoginPageUrl(href: string): boolean {
    try {
        const url = new URL(href);
        return url.protocol === 'file:' && path.relative(LOGIN_PAGE_PATH, fileURLToPath(url)) === '';
    } catch {
        return false;
    }
}

export function isLoginPage(event: FrameEvent): boolean {
    return isLoginPageUrl(event.senderFrame?.url ?? '');
}
