import * as webUiSession from '../common/webUiSession';
import * as auth from './plugins/auth';
import * as config from './plugins/config';
import * as externalLink from './plugins/externalLink';
import * as logger from './plugins/logger';
import * as login from './plugins/login';
import * as media from './plugins/media';
import * as update from './plugins/update';
import * as wincontrol from './plugins/wincontrol';

const PLUGINS = [auth, config, externalLink, logger, login, media, update, wincontrol];

function registerAllPlugins(): void {
    for (const plugin of PLUGINS) plugin.init();
    webUiSession.start();
}

export {
    registerAllPlugins,
};
