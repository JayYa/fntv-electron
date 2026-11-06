import * as path from 'path';
import { fileURLToPath } from 'url';

const LOGIN_PAGE_PATH = path.join(__dirname, '../../../resource/login/index.html');

type FrameEvent = {
    senderFrame?: { url: string } | null;
};

// preload 的 file: 判断在渲染进程里，主进程要自己再查一次。
export function isLoginPage(event: FrameEvent): boolean {
    try {
        const url = new URL(event.senderFrame?.url ?? '');
        // path.relative 在 Windows 上不区分大小写，盘符写法不同也算同一个文件。
        return url.protocol === 'file:' && path.relative(LOGIN_PAGE_PATH, fileURLToPath(url)) === '';
    } catch {
        return false;
    }
}
