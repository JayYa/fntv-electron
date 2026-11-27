import * as log from '../../modules/logger';
import * as auth from './plugins/auth';
import * as config from './plugins/config';
import * as externalLink from './plugins/externalLink';
import * as logger from './plugins/logger';
import * as media from './plugins/media';
import * as update from './plugins/update';
import * as wincontrol from './plugins/wincontrol';

const PLUGINS = { auth, config, externalLink, logger, media, update, wincontrol };

function registerAllPlugins(): void {
    for (const [name, plugin] of Object.entries(PLUGINS)) {
        try {
            log.info(`正在初始化插件: ${name}`);
            plugin.init();
        } catch (error) {
            log.error(`加载插件 ${name} 失败:`, error);
        }
    }
}

export {
    registerAllPlugins,
};
