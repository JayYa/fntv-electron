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

// 替身 NodeMpv：正常启动，记下事件监听器，测试用 emit 模拟 MPV 发来的回调
class RunningNodeMpv {
    static last = null;
    constructor() {
        this.handlers = new Map();
        this.filename = '';
        RunningNodeMpv.last = this;
    }
    on(event, handler) { this.handlers.set(event, handler); }
    emit(event, value) { return this.handlers.get(event)(value); }
    start() { return Promise.resolve(); }
    loadPlaylist() { return Promise.resolve(); }
    jump() { return Promise.resolve(); }
    quit() { return Promise.resolve(); }
    isRunning() { return true; }
    getDuration() { return Promise.resolve(1500); }
    getPercentPosition() { return Promise.resolve(40); }
    getFilename() { return Promise.resolve(this.filename); }
}

// 让 require('node-mpv-2') 返回替身，不真启动 MPV；之后加载的播放器模块拿到替身
function useFakeNodeMpv(t, NodeMpvClass = FakeNodeMpv) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'node-mpv-2') return NodeMpvClass;
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

test('event data stays as emitted after the player moves on to the next item', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    const items = ['item-1', 'item-2'].map((itemGuid) => ({
        ...playItem,
        itemGuid,
        playLink: `http://127.0.0.1:1234/api/v1/playvideo/${itemGuid}?session=s`,
        duration: 1500,
    }));
    const events = [];
    const player = ply.PlayerFactory.createPlayer(ply.PlayerType.MPV, {
        fnapi: {},
        onEvent: (type, data) => events.push({ type, data }),
    });
    t.after(() => player.stop());

    assert.equal(await player.playList(items, 0), true);
    const mpv = RunningNodeMpv.last;
    mpv.emit('status', { property: 'playlist-pos', value: 0 });

    // 进度回传会先 await 查播放信息，再读事件数据；这期间播放器切到了下一项
    mpv.filename = items[0].playLink;
    await mpv.emit('timeposition', 600);
    mpv.emit('seek', { end: 700 });
    mpv.emit('status', { property: 'playlist-pos', value: 1 });

    const expected = { itemGuid: 'item-1', duration: 1500, percentage: 40 };
    assert.deepEqual(
        events.map(({ type, data }) => ({ type, ...data })),
        [
            { type: ply.EventType.PROGRESS, ...expected, ts: 600 },
            { type: ply.EventType.PROGRESS, ...expected, ts: 700 },
            { type: ply.EventType.ITEM_END, ...expected, ts: 700 },
        ],
    );
});
