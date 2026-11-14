const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function clearCompiledModules() {
    Object.keys(require.cache)
        .filter((id) => id.includes(`${path.sep}dest${path.sep}`))
        .forEach((id) => delete require.cache[id]);
}

// 替身 NodeMpv：start() 一直不返回，模拟 MPV 还在启动；quit() 立即完成
class FakeNodeMpv {
    on() {}
    start() { return new Promise(() => {}); }
    quit() { return Promise.resolve(); }
    isRunning() { return false; }
}

// 让 require('node-mpv-2') 返回替身，不真启动 MPV；之后加载的播放器模块拿到替身
function useFakeNodeMpv(t) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'node-mpv-2') return FakeNodeMpv;
        return originalLoad.call(this, request, parent, isMain);
    };
    t.after(() => {
        Module._load = originalLoad;
        clearCompiledModules();
    });
    clearCompiledModules();
    return require('../dest/modules/players/index.js');
}

const playItem = {
    itemGuid: 'item-1',
    title: 'Episode 1',
    playLink: 'http://127.0.0.1/stream',
    ts: 0,
    duration: 100,
};

test('stopping right after playList is called, before it settles, reports the player exit', (t) => {
    const ply = useFakeNodeMpv(t);
    const events = [];
    const player = ply.PlayerFactory.createPlayer(ply.PlayerType.MPV, {
        fnapi: {},
        onEvent: (type) => events.push(type),
    });

    void player.playList([playItem], 0);
    player.stop();

    assert.deepEqual(events, [ply.EventType.EXIT]);
});
