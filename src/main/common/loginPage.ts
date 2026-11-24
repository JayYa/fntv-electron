import * as path from 'path';
import { fileURLToPath } from 'url';

export const LOGIN_PAGE_PATH = path.join(__dirname, '../../../resource/login/index.html');

type FrameEvent = {
    senderFrame?: { url: string } | null;
};

export function isLoginPage(event: FrameEvent): boolean {
    try {
        const url = new URL(event.senderFrame?.url ?? '');
        return url.protocol === 'file:' && path.relative(LOGIN_PAGE_PATH, fileURLToPath(url)) === '';
    } catch {
        return false;
    }
}
