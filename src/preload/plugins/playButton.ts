import logger from '../core/logger';
import { registerHook, HookType } from '../core/hooks';
import {
    findItemGuid,
    getPlayButtonConfig,
    isSemanticPlayButton,
} from '../core/playback';
import { detectDetailRoute } from '../core/playTarget';

// 头部操作行不可能出现在这些区域里：导航、页眉、侧栏、自定义标题栏。
const EXCLUDED_ANCESTOR_SELECTOR = [
    'nav',
    'header',
    'aside',
    '[class*="titlebar" i]',
    '[class*="title-bar" i]',
    '[class*="sidebar" i]',
    '[class*="side-bar" i]',
    '[class*="play-mask" i]',
    '[class*="playmask" i]',
].join(', ');

function isPlayMaskButton(button: HTMLElement): boolean {
    const className = typeof button.className === 'string' ? button.className.toLowerCase() : '';
    return className.includes('play-mask') || className.includes('playmask');
}

function directButtons(container: Element): HTMLButtonElement[] {
    return Array.from(container.children).filter(
        (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
    );
}

/**
 * 结构识别：定位详情页头部操作行容器，取其第一个 `button` 子元素。
 *
 * 仓库里没有网页端源码，这里用启发式定位「操作行」：
 * 1. 以页面第一个 `h1`（标题）为锚点，只考虑文档顺序上位于它之后的元素；
 *    没有 `h1` 时退化为从 `body` 开始扫描（路由门控已保证这是详情页）。
 * 2. 第一个「直接子元素里有 ≥2 个 `button`」的元素视为操作行
 *    （播放 / 收藏 / 更多… 并排），排除导航、页眉、侧栏与 play-mask 内的元素。
 * 3. 该容器的第一个 `button` 子元素即主播放键；找不到则返回 null，交给文案规则兜底。
 */
function findStructuralPlayButton(): HTMLElement | null {
    const heading = document.querySelector('h1');
    const root = document.body;
    if (!root) return null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let started = heading === null;

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node as Element;
        if (!started) {
            if (element === heading) started = true;
            continue;
        }
        if (element.closest(EXCLUDED_ANCESTOR_SELECTOR)) continue;

        const buttons = directButtons(element);
        if (buttons.length < 2) continue;

        const [first] = buttons;
        return isPlayMaskButton(first) ? null : first;
    }

    return null;
}

function findSemanticDetailPlayButton(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const candidate of candidates) {
        if (!isSemanticPlayButton(candidate)) continue;
        if (isPlayMaskButton(candidate)) continue;
        if (findItemGuid(candidate)) return candidate.closest<HTMLElement>('button, [role="button"]');
    }
    return null;
}

/**
 * 详情页主播放键 = 路由 + 结构识别；文案/图标规则保持为兜底，任一命中即打标。
 * 非详情路由（folder / person / video / library…）不跑结构规则，避免误标「收藏」等按钮。
 */
function findDetailPlayButton(): HTMLElement | null {
    const route = detectDetailRoute(window.location.href);
    if (route === null) return null;

    return findStructuralPlayButton() ?? findSemanticDetailPlayButton();
}

function interceptOriginalButton(button: HTMLElement): void {
    if (button.dataset.mpvDetailIntercepted === 'true') return;
    button.dataset.mpvDetailIntercepted = 'true';
}

function clearStaleMarks(): void {
    document.querySelectorAll<HTMLElement>('[data-mpv-detail-intercepted="true"]').forEach((element) => {
        delete element.dataset.mpvDetailIntercepted;
    });
}

async function setupDetailPlayButton(): Promise<void> {
    // SPA 切到非详情路由时，React 可能复用按钮元素，主动清掉旧标记以免误拦截。
    if (detectDetailRoute(window.location.href) === null) {
        clearStaleMarks();
        return;
    }

    // OnDomChange 会反复触发；已打标且仍在文档中的按钮无需重新识别。
    const marked = document.querySelector<HTMLElement>('[data-mpv-detail-intercepted="true"]');
    if (marked?.isConnected) return;

    const button = findDetailPlayButton();
    if (!button) return;

    const config = await getPlayButtonConfig();
    if (!config.hideOriginalPlayButton) return;
    interceptOriginalButton(button);
}

function handleSetup(): void {
    setupDetailPlayButton().catch((error: unknown) => {
        logger.error('设置 MPV 播放按钮失败:', error);
    });
}

registerHook(HookType.OnReady, handleSetup);
registerHook(HookType.OnDomChange, handleSetup);

export {};
