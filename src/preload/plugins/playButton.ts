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

// 网页端头部操作行的 Tailwind 类（从服务端 JS chunk 确认）：主播放键是该行的第一个子元素。
const ACTION_ROW_CLASSES = ['h-[54px]', 'shrink-0', 'items-center'];
// 主播放键本身的类，用于操作行类名变化时的兜底识别。
const PLAY_BUTTON_CLASSES = ['!min-w-[150px]', '!rounded-full'];

function hasAllClasses(element: Element, classes: string[]): boolean {
    return classes.every((name) => element.classList.contains(name));
}

function isActionRowPlayButton(button: HTMLButtonElement): boolean {
    const row = button.parentElement;
    if (!row || row.firstElementChild !== button) return false;
    return hasAllClasses(row, ACTION_ROW_CLASSES) || hasAllClasses(button, PLAY_BUTTON_CLASSES);
}

/**
 * 结构识别：定位详情页头部操作行容器，取其第一个 `button` 子元素。
 *
 * 网页端事实（从服务端 JS chunk 确认）：操作行是
 * `div.relative.flex.h-[54px].shrink-0.items-center.gap-2`，其中**只有主播放键是 `button`**
 * （Semi Button，类含 `!min-w-[150px] !rounded-full`），收藏 / 已观看 / 更多都是 `div`。
 * tv / season 页的主键文案是「第 N 季 第 M 集」「第 M 集」等，不含「播放」，因此不能靠文案。
 *
 * 规则：文档顺序上第一个满足「是父元素的第一个子元素，且父元素带操作行类名（或按钮自身带主键类名）」
 * 的 `button`；排除导航、页眉、侧栏与 play-mask 内的元素。找不到则返回 null，交给文案规则兜底。
 */
function findStructuralPlayButton(): HTMLElement | null {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    for (const button of buttons) {
        if (button.closest(EXCLUDED_ANCESTOR_SELECTOR)) continue;
        if (isPlayMaskButton(button)) continue;
        if (isActionRowPlayButton(button)) return button;
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
 * 详情页主播放键 = 路由 + 结构识别；文案/图标规则在任何路由上都保持为兜底（与旧行为一致），
 * 任一命中即打标。只有结构规则受路由门控：非详情路由（folder / person / video / library…）
 * 不跑结构规则，避免误标「收藏」等按钮。
 */
function findDetailPlayButton(): HTMLElement | null {
    const route = detectDetailRoute(window.location.href);
    return (route ? findStructuralPlayButton() : null) ?? findSemanticDetailPlayButton();
}

function interceptOriginalButton(button: HTMLElement): void {
    if (button.dataset.mpvDetailIntercepted === 'true') return;
    button.dataset.mpvDetailIntercepted = 'true';
}

async function setupDetailPlayButton(): Promise<void> {
    // OnDomChange 会反复触发；已有打标按钮在文档中时无需重新识别（querySelector 只返回已连接节点）。
    if (document.querySelector('[data-mpv-detail-intercepted="true"]')) return;

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
