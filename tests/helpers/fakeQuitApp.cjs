const assert = require('node:assert/strict');
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

/**
 * 像主进程入口那样启动退出协调（src/main/main.ts）。要在被测模块加载之后调用，拿到同一份模块。
 * Proxy 和托盘换成往 events 里记事件的假收尾：关 Proxy 隔一轮才关完；closeProxy 给出时替换它
 */
function startQuitCoordinator(events, { closeProxy } = {}) {
    require('../../dest/modules/quit/quitCoordinator.js').initQuitCoordinator({
        closeProxy: closeProxy ?? (async () => {
            events.push('proxy closing');
            await new Promise((resolve) => setImmediate(resolve));
            events.push('proxy closed');
        }),
        onQuitReleased() { events.push('tray destroyed'); },
    });
}

/**
 * 模拟媒体播放插件：用播放状态模块 playback 开始一次播放，stop() 时 MPV 退出，
 * 退出的进度回传由 report 决定；MPV 停止和回传完成都记进 events
 */
function startPlaying(playback, events, report = Promise.resolve()) {
    const session = playback.beginPlayback();
    let played = false;
    void session.start({
        stop() {
            events.push('mpv stopped');
            session.ended(report.then(() => events.push('progress reported')));
        },
    }, async () => { played = true; return true; });
    // start 在同一次同步调用里记录播放器并开始播放
    assert.equal(played, true);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

module.exports = { createQuittingApp, requestQuit, startQuitCoordinator, startPlaying, deferred };
