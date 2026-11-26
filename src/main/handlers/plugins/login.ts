import { OnBeforeRequestListenerDetails } from 'electron';
import { endCurrentLogin } from '../../common/currentLogin';
import { mainWindow } from '../../common/mainWindow';
import { interceptor } from '../core/interceptor';
import * as log from '../../../modules/logger';

function handleLeaveRequest(details: OnBeforeRequestListenerDetails, callback: (response: { cancel?: boolean }) => void): void {
    log.info('网页端请求登录页或登出，结束当前登录');
    callback({ cancel: true });
    void endCurrentLogin(mainWindow.window());
}

function init(): void {
    interceptor.registerBeforeRequest(
        {
            urls: [
                'http://*/v/login',
                'https://*/v/login',
                'http://*/v/welcome',
                'https://*/v/welcome',
            ]
        },
        handleLeaveRequest,
        'login-interceptor'
    );

    interceptor.registerBeforeRequest(
        {
            urls: [
                'http://*/v/api/v1/user/logout',
                'https://*/v/api/v1/user/logout'
            ]
        },
        handleLeaveRequest,
        'logout-interceptor'
    );

    log.info('登录拦截插件已初始化');
}

export {
    init,
};
