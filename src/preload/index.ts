import { ipcRenderer } from 'electron';

import { HookType, runHooks } from './core/hooks';
import './loginPageApi';

import './plugins/takeover';
import './plugins/titlebar';

const PLUGINS = ['takeover', 'titlebar'];

function initInjector(): void {
    if (document.readyState !== 'loading') {
        runHooks(HookType.OnReady);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            runHooks(HookType.OnReady);
            const observer = new MutationObserver(() => runHooks(HookType.OnDomChange));
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
}

initInjector();

ipcRenderer.send('preload-started', PLUGINS);
