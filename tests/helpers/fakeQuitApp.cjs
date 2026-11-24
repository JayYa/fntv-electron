const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

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

function requestQuit(app) {
    let seen = null;
    const capture = (event) => { seen = event; };
    app.prependOnceListener('before-quit', capture);
    app.quit();
    app.removeListener('before-quit', capture);
    return seen;
}

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

function startPlaying(playback, events, report = Promise.resolve()) {
    const session = playback.beginPlayback();
    let played = false;
    void session.start({
        stop() {
            events.push('mpv stopped');
            session.ended(report.then(() => events.push('progress reported')));
        },
    }, async () => { played = true; return true; });
    assert.equal(played, true);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

module.exports = { createQuittingApp, requestQuit, startQuitCoordinator, startPlaying, deferred };
