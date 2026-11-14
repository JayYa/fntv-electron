const { EventEmitter } = require('node:events');

/**
 * 像 Electron 那样退出的假 app：app.quit() 同步发 before-quit，监听器共用一个事件对象；
 * 没被拦下（preventDefault）就算进程退出，exited 变为 true，之后再调 quit() 不再发事件。
 * events 是测试共用的事件记录，进程退出时追加 'exited'，测试按它断言先后顺序。
 * extra 是被测模块额外要用的 app 属性（getPath 等）。
 */
function createQuittingApp(events, extra = {}) {
    return Object.assign(new EventEmitter(), {
        quits: 0,
        exited: false,
        quit() {
            this.quits += 1;
            if (this.exited) return;
            const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            this.emit('before-quit', event);
            if (!event.defaultPrevented) {
                this.exited = true;
                events.push('exited');
            }
        },
    }, extra);
}

/** 模拟用户发起一次退出（托盘菜单、菜单栏），返回 before-quit 的事件，看有没有被拦下 */
function requestQuit(app) {
    let seen = null;
    const capture = (event) => { seen = event; };
    app.prependOnceListener('before-quit', capture);
    app.quit();
    app.removeListener('before-quit', capture);
    return seen;
}

module.exports = { createQuittingApp, requestQuit };
