import { request } from './core/ipc';
import preloadLogger from './core/logger';
import { HookType, runHooks } from './core/hooks';
import './loginPageApi';

import './plugins/takeover';
import './plugins/titlebar';

const PLUGINS = ['takeover', 'titlebar'];

function startHooks(): void {
    runHooks(HookType.OnReady);
    const observer = new MutationObserver(() => runHooks(HookType.OnDomChange));
    observer.observe(document.body, { childList: true, subtree: true });
}

function initInjector(): void {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startHooks);
    } else {
        startHooks();
    }
}

initInjector();

request('preload-started', PLUGINS).catch((error: unknown) => preloadLogger.warn('报告 preload 启动失败:', error));
