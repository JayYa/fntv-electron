import { ipcRenderer } from 'electron';

import { HookType, runHooks } from './core/hooks';
// 登录页的桥要先于插件，插件顶层出错时登录页仍可用（tests/preloadBundle.test.cjs）。
import './loginPageApi';

// 沙箱里不能读目录，也不能 require 相对路径，插件只能静态导入。新增插件时在这里加一行。
// 保持字母序，和原来 readdirSync 的加载顺序一致（tests/preloadBundle.test.cjs）。
import './plugins/continueWatchingMenu';
import './plugins/playButton';
import './plugins/playMaskButton';
import './plugins/titlebar';

const PLUGINS = ['continueWatchingMenu', 'playButton', 'playMaskButton', 'titlebar'];

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

// 静态导入先于这里执行，走到这一行时 PLUGINS 里的插件都已加载。
ipcRenderer.send('preload-started', PLUGINS);
