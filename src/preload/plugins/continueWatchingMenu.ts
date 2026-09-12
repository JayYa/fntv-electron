import logger from '../core/logger';
import { classifyMenuAction, type MenuAction } from '../core/menuAction';
import {
    findItemGuidInDom,
    findSemanticPlayButton,
    getPlayButtonConfig,
    sendPlayEvent,
} from '../core/playback';

/**
 * 首页「继续观看」卡片 → 更多菜单 →「继续播放」/「从头开始播放」的 MPV 接管。
 *
 * Semi Dropdown 会把菜单 portal 到 `document.body`，菜单项向上找不到卡片，
 * 因此在 capture 阶段监听卡片内「更多」触发器的 pointerdown（不拦截）记下 guid，
 * 待菜单项被按下时消费。记忆在超时、菜单外任意按下、Escape 关闭菜单时清空，避免播错项目。
 *
 * 加载顺序：`src/preload/index.ts` 用 `readdirSync` 按字母序加载插件，本文件的 capture 监听器
 * 先于 `playMaskButton.ts` 注册。这里不依赖该顺序：两者拦截的目标互斥（菜单项 vs 播放键），
 * 「更多」触发器只被动记忆、不阻断传播；即便顺序颠倒也只是播放键按下时不清记忆，
 * 而记忆只会在菜单项被按下时消费。
 */

const MENU_ITEM_SELECTOR = 'li[role="menuitem"]';
const MENU_TRIGGER_SELECTOR = [
    'button',
    '[role="button"]',
    '[aria-haspopup]',
    '[class*="semi-dropdown" i]',
].join(', ');
// 用户可能读菜单较久，超时给足余量
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

/**
 * 卡片内、非播放键的按钮类元素视为「更多」触发器。
 * guid 必须来自卡片 DOM 本身（不走 URL 兜底），否则不记忆。
 */
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

/**
 * 让 Semi Dropdown 关闭：它监听 document 的 mousedown 做 clickOutside 判定，
 * 以 body 为目标的合成事件即视为菜单外点击。延后到本轮事件序列结束后派发，
 * 避免菜单在 click 触发前卸载，导致 click 落到卡片本身。
 */
function closeDropdownMenu(): void {
    setTimeout(() => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }, 0);
}

function takeoverMenuItem(match: MenuMatch): void {
    const guid = rememberedGuid;
    clearRememberedGuid();
    if (!guid) return;

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

    // 菜单项之外的任意按下都会让 Semi 关闭菜单，同步清空记忆；
    // 若按下的是另一张卡片的「更多」，则重新记忆。
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

// Semi Dropdown 在 Escape 时关闭菜单，记忆同步失效。
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
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', () => {
        pressedMenuItem = null;
    }, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
}

// 与播放键接管一致：只有用户明确启用时才接管；读取失败时保留原生行为。
setupContinueWatchingMenuHandler().catch((error: unknown) => {
    logger.error('初始化继续观看菜单接管失败:', error);
});

export {};
