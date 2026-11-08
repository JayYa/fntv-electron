import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import * as path from 'path';
import { platformBehavior } from '../../public/platform';
import * as log from '../../modules/logger';

const behavior = platformBehavior();
const isMac = behavior.titleBar === 'hiddenInset';
// 打包后 build/ 在 app.asar 里（package.json 的 files），nativeImage 能直接读 asar 内的文件。
const windowIconPath = path.join(__dirname, '../../../build', behavior.windowIcon);

const mainwinConfig: BrowserWindowConstructorOptions = {
    width: 1400,
    height: 800,
    minWidth: 800,
    minHeight: 800,
    autoHideMenuBar: true,
    show: false,
    icon: windowIconPath,
    // macOS 使用系统交通灯按钮，但让现有页面继续延伸到标题栏区域。
    // Windows/Linux 保持原有的无边框窗口和自定义窗口按钮。
    frame: isMac,
    ...(isMac && {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 14, y: 14 },
    }),
    // transparent: true,
    webPreferences: {
        webgl: true,
        partition: 'persist:fntv',
        preload: path.join(__dirname, '../../preload/bundle.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,  // 禁用拼写检查，避免输入法干扰
    }
};

let mainwin: BrowserWindow | null = null;

/**
 * 获取主窗口实例
 * @returns {BrowserWindow}
 */
export function getMainWindow(): BrowserWindow {
    if (!mainwin) {
        // 冒烟测试从这行读出路径，检查图标能加载（tests/smoke/installer.smoke.cjs）。
        log.info('主窗口图标:', windowIconPath);
        mainwin = new BrowserWindow(mainwinConfig);
    }
    return mainwin;
}
