import logger from './logger';
import { classifyMenuAction } from './menuAction';
import { detectDetailRoute, extractItemGuidFromUrl, isItemGuid } from './playTarget';
import type { PlayMovieData } from './types';

export interface PlayEntry {
    readonly keyboard: boolean;
    find(target: Element): HTMLElement | null;
    ready(): boolean;
    take(element: HTMLElement): PlayMovieData | null;
    pressedElsewhere?(target: Element): void;
    cancel?(): void;
}

const ITEM_ATTRIBUTES = ['data-item-guid', 'data-item_guid', 'data-guid', 'data-id'];

function readGuidAttribute(element: Element): string | null {
    for (const attribute of ITEM_ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (isItemGuid(value)) return value;
    }
    return null;
}

function findItemGuidInDom(element: Element | null): string | null {
    let current = element;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const attributeGuid = readGuidAttribute(current);
        if (attributeGuid) return attributeGuid;

        if (current instanceof HTMLAnchorElement) {
            const linkGuid = extractItemGuidFromUrl(current.href);
            if (linkGuid) return linkGuid;
        }

        const link = current.querySelector<HTMLAnchorElement>('a[href]');
        if (link) {
            const linkGuid = extractItemGuidFromUrl(link.href);
            if (linkGuid) return linkGuid;
        }
    }

    return null;
}

function findItemGuid(element: Element | null): string | null {
    return findItemGuidInDom(element) ?? extractItemGuidFromUrl(window.location.href);
}

function getSelectedSourceIndex(): number {
    const selectors = [
        '[data-source-index][aria-selected="true"]',
        '[data-source-index].semi-button-primary',
        'button.semi-button.\\!h-9.\\!px-6',
    ];

    for (const selector of selectors) {
        const buttons = Array.from(document.querySelectorAll<HTMLElement>(selector));
        if (buttons.length === 0) continue;

        const selected = buttons.findIndex((button) =>
            button.getAttribute('aria-selected') === 'true'
            || button.classList.contains('semi-button-primary')
        );
        const element = selected >= 0 ? buttons[selected] : buttons[0];
        const explicitIndex = Number(element.dataset.sourceIndex);
        return Number.isInteger(explicitIndex) && explicitIndex >= 0
            ? explicitIndex
            : Math.max(selected, 0);
    }

    return 0;
}

const PLAY_CONTROL_SELECTOR = [
    'button',
    '[role="button"]',
    '[class*="play-mask__btn--play" i]',
    '[class*="playmask" i]',
].join(', ');

function isPlayMaskButton(button: HTMLElement): boolean {
    const className = typeof button.className === 'string' ? button.className.toLowerCase() : '';
    return className.includes('play-mask') || className.includes('playmask');
}

function findSemanticPlayButton(element: Element): HTMLElement | null {
    const button = element.closest<HTMLElement>(PLAY_CONTROL_SELECTOR);
    if (!button || button.dataset.customPlay === 'true') return null;
    if (isPlayMaskButton(button)) return button;

    const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, '')
        .toLowerCase();

    if (/^(立即|继续|重新)?播放$/.test(label) || label === 'play') return button;
    if (button.querySelector('[data-icon*="play" i], [class*="play-icon" i]')) return button;

    return null;
}

function playRequest(itemGuid: string | null, sourceIndex: number, restart = false): PlayMovieData | null {
    if (!itemGuid) {
        logger.error('无法调用 MPV：未能识别播放项');
        return null;
    }
    const request: PlayMovieData = { id: itemGuid, sourceIndex };
    if (restart) request.restart = true;
    return request;
}

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
        if (!findSemanticPlayButton(candidate)) continue;
        if (isPlayMaskButton(candidate)) continue;
        if (findItemGuid(candidate)) return candidate.closest<HTMLElement>('button, [role="button"]');
    }
    return null;
}

function findDetailPlayButton(): HTMLElement | null {
    const route = detectDetailRoute(window.location.href);
    return (route ? findStructuralPlayButton() : null) ?? findSemanticDetailPlayButton();
}

function isDisabledButton(button: HTMLElement): boolean {
    return button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
}

export function detailMainButtonEntry(): PlayEntry & { recognize(): void } {
    let mainButton: HTMLElement | null = null;

    return {
        keyboard: true,
        recognize() {
            if (mainButton?.isConnected) return;
            mainButton = findDetailPlayButton();
            if (mainButton) logger.info('详情页播放键已接管');
        },
        find(target) {
            if (!mainButton?.contains(target)) return null;
            return mainButton.dataset.customPlay === 'true' ? null : mainButton;
        },
        ready: () => true,
        take(button) {
            if (isDisabledButton(button)) return null;
            return playRequest(findItemGuid(null), getSelectedSourceIndex());
        },
    };
}

function isCardPlayButton(button: HTMLElement): boolean {
    return isPlayMaskButton(button) || Boolean(button.closest('[class*="poster" i], [class*="card" i], a[href]'));
}

export function cardPlayButtonEntry(): PlayEntry {
    return {
        keyboard: true,
        find(target) {
            const button = findSemanticPlayButton(target);
            return button && isCardPlayButton(button) ? button : null;
        },
        ready: () => true,
        take: (button) => playRequest(findItemGuid(button), 0),
    };
}

const MENU_ITEM_SELECTOR = 'li[role="menuitem"]';
const MENU_TRIGGER_SELECTOR = [
    'button',
    '[role="button"]',
    '[aria-haspopup]',
    '[class*="semi-dropdown" i]',
].join(', ');
const REMEMBER_TIMEOUT_MS = 30000;

function closeDropdownMenu(): void {
    setTimeout(() => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }, 0);
}

export function continueWatchingMenuEntry(): PlayEntry {
    let rememberedGuid: string | null = null;
    let rememberTimer: ReturnType<typeof setTimeout> | null = null;

    function forget(): void {
        rememberedGuid = null;
        if (rememberTimer) {
            clearTimeout(rememberTimer);
            rememberTimer = null;
        }
    }

    function rememberMenuTrigger(target: Element): void {
        const trigger = target.closest<HTMLElement>(MENU_TRIGGER_SELECTOR);
        if (!trigger || trigger.closest(MENU_ITEM_SELECTOR)) return;
        if (findSemanticPlayButton(trigger)) return;

        const guid = findItemGuidInDom(trigger);
        if (!guid) return;
        rememberedGuid = guid;
        rememberTimer = setTimeout(forget, REMEMBER_TIMEOUT_MS);
    }

    return {
        keyboard: false,
        find(target) {
            const item = target.closest<HTMLElement>(MENU_ITEM_SELECTOR);
            return item && classifyMenuAction(item.textContent) ? item : null;
        },
        ready: () => rememberedGuid !== null,
        take(item) {
            const guid = rememberedGuid;
            const action = classifyMenuAction(item.textContent);
            forget();
            if (!guid || !action) return null;

            logger.info('继续观看菜单已接管:', action);
            closeDropdownMenu();
            return playRequest(guid, 0, action === 'restart');
        },
        pressedElsewhere(target) {
            forget();
            rememberMenuTrigger(target);
        },
        cancel: forget,
    };
}
