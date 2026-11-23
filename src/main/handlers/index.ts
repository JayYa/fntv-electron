import * as fs from 'fs';
import * as path from 'path';
import { interceptor } from './core/interceptor';
import { initAppHooks } from './core/appHook';
import * as log from '../../modules/logger';

interface Plugin {
    init?: () => void;
}

function loadPlugins(): void {
    const pluginsDir = path.join(__dirname, 'plugins');
    
    try {
        const files = fs.readdirSync(pluginsDir);
        
        files.forEach((file: string) => {
            if (file.endsWith('.js')) {
                try {
                    const plugin: Plugin = require(path.join(pluginsDir, file));
                    
                    if (typeof plugin.init === 'function') {
                        log.info(`正在初始化插件: ${file}`);
                        plugin.init();
                    } else {
                        log.warn(`插件 ${file} 没有导出 init 函数`);
                    }
                } catch (error) {
                    log.error(`加载插件 ${file} 失败:`, error);
                }
            }
        });
    } catch (error) {
        log.error('加载插件目录失败:', error);
    }
}

function registerAllPlugins(): void {
    interceptor.init('persist:fntv');
    loadPlugins();

    interceptor.run();
    
    initAppHooks();
}

export {
    registerAllPlugins,
};
