import logger from '../core/logger';
import { classifyMenuAction, type MenuAction } from '../core/menuAction';
import {
    findItemGuidInDom,
    findSemanticPlayButton,
    getPlayButtonConfig,
    sendPlayEvent,
} from '../core/playback';

const MENU_ITEM_SELECTOR = 'li[role="menuitem"]';
const MENU_TRIGGER_SELECTOR = [
    'button',
    '[role="button"]',
    '[aria-haspopup]',
    '[class*="semi-dropdown" i]',
].join(', ');
const REMEMBER_TIMEOUT_MS = 30000;

type MenuMatch = {
    item: HTMLElement;
    action: MenuAction;
};

let initialized = false;
let rememberedGuid: string | null = null;
let rememberTimer: ReturnType<typeof setTimeout> | null = null;
let pressedMenuItem: HTMLElement | null = null;
let handledMenuItem: HTMLElement | null = null;

function clearRememberedGuid(): void {
    rememberedGuid = null;
    if (rememberTimer) {
        clearTimeout(rememberTimer);
        rememberTimer = null;
    }
}

function rememberGuid(guid: string): void {
    clearRememberedGuid();
    rememberedGuid = guid;
    rememberTimer = setTimeout(clearRememberedGuid, REMEMBER_TIMEOUT_MS);
}

function rememberMenuTrigger(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;

    const trigger = target.closest<HTMLElement>(MENU_TRIGGER_SELECTOR);
    if (!trigger || trigger.closest(MENU_ITEM_SELECTOR)) return;
    if (findSemanticPlayButton(trigger)) return;

    const guid = findItemGuidInDom(trigger);
    if (guid) rememberGuid(guid);
}

function resolveMenuItem(target: EventTarget | null): MenuMatch | null {
    if (!(target instanceof Element)) return null;

    const item = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
    if (!item) return null;

    const action = classifyMenuAction(item.textContent);
    return action ? { item, action } : null;
}

function suppressNativeMenuAction(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function closeDropdownMenu(): void {
    setTimeout(() => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }, 0);
}

function takeoverMenuItem(match: MenuMatch): void {
    const guid = rememberedGuid;
    clearRememberedGuid();
    if (!guid) return;

    logger.info('继续观看菜单已接管:', match.action);
    sendPlayEvent(guid, 0, match.action === 'restart');
    closeDropdownMenu();
}

function handlePointerDown(event: PointerEvent): void {
    const match = resolveMenuItem(event.target);
    if (match) {
        if (!rememberedGuid) return;
        pressedMenuItem = match.item;
        suppressNativeMenuAction(event);
        return;
    }

    pressedMenuItem = null;
    clearRememberedGuid();
    rememberMenuTrigger(event.target);
}

function handlePointerUp(event: PointerEvent): void {
    const match = resolveMenuItem(event.target);
    if (!match) return;

    const shouldPlay = match.item === pressedMenuItem;
    pressedMenuItem = null;
    if (!rememberedGuid) return;

    suppressNativeMenuAction(event);
    if (!shouldPlay) return;

    handledMenuItem = match.item;
    setTimeout(() => {
        if (handledMenuItem === match.item) handledMenuItem = null;
    }, 0);
    takeoverMenuItem(match);
}

function handleClick(event: MouseEvent): void {
    const match = resolveMenuItem(event.target);
    if (!match) return;

    if (handledMenuItem === match.item) {
        handledMenuItem = null;
        suppressNativeMenuAction(event);
        return;
    }

    if (!rememberedGuid) return;
    suppressNativeMenuAction(event);
    takeoverMenuItem(match);
}

function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    pressedMenuItem = null;
    clearRememberedGuid();
}

async function setupContinueWatchingMenuHandler(): Promise<void> {
    if (initialized) return;

    const config = await getPlayButtonConfig();
    if (!config.hideOriginalPlayButton) return;

    initialized = true;
    logger.info('继续观看菜单接管已启用');
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', () => {
        pressedMenuItem = null;
    }, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
}

setupContinueWatchingMenuHandler().catch((error: unknown) => {
    logger.error('初始化继续观看菜单接管失败:', error);
});

export {};
