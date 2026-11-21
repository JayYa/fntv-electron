import logger from '../core/logger';
import { registerHook, HookType } from '../core/hooks';
import {
    findItemGuid,
    getPlayButtonConfig,
    isSemanticPlayButton,
} from '../core/playback';
import { detectDetailRoute } from '../core/playTarget';

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

const ACTION_ROW_CLASSES = ['h-[54px]', 'shrink-0', 'items-center'];
const PLAY_BUTTON_CLASSES = ['!min-w-[150px]', '!rounded-full'];

function hasAllClasses(element: Element, classes: string[]): boolean {
    return classes.every((name) => element.classList.contains(name));
}

function isActionRowPlayButton(button: HTMLButtonElement): boolean {
    const row = button.parentElement;
    if (!row || row.firstElementChild !== button) return false;
    return hasAllClasses(row, ACTION_ROW_CLASSES) || hasAllClasses(button, PLAY_BUTTON_CLASSES);
}

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

function findDetailPlayButton(): HTMLElement | null {
    const route = detectDetailRoute(window.location.href);
    return (route ? findStructuralPlayButton() : null) ?? findSemanticDetailPlayButton();
}

function interceptOriginalButton(button: HTMLElement): void {
    if (button.dataset.mpvDetailIntercepted === 'true') return;
    button.dataset.mpvDetailIntercepted = 'true';
    logger.info('详情页播放键已接管');
}

async function setupDetailPlayButton(): Promise<void> {
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
