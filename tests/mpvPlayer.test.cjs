const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');

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

class RunningNodeMpv {
    static last = null;
    constructor() {
        this.handlers = new Map();
        this.path = '';
        this.seeks = [];
        this.subtitles = [];
        RunningNodeMpv.last = this;
    }
    on(event, handler) { this.handlers.set(event, handler); }
    emit(event, value) { return this.handlers.get(event)(value); }
    start() { return Promise.resolve(); }
    loadPlaylist() { return Promise.resolve(); }
    jump() { return Promise.resolve(); }
    quit() { return Promise.resolve(); }
    isRunning() { return true; }
    setProperty() { return Promise.resolve(); }
    goToPosition(position) { this.seeks.push(position); return Promise.resolve(); }
    addSubtitles(file) { this.subtitles.push(file); return Promise.resolve(); }
    getDuration() { return Promise.resolve(1500); }
    getPercentPosition() { return Promise.resolve(40); }
    getFilename() { return Promise.resolve(this.path); }
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

const playerConfig = (overrides) => ({
    playerPath: '',
    onEvent: () => {},
    resumePosition: () => 0,
    loadSubtitles: async () => [],
    ...overrides,
});

function twoItems() {
    return ['item 1', 'item-2'].map((itemGuid) => ({
        ...playItem,
        itemGuid,
        playLink: `http://127.0.0.1:1234/api/v1/playvideo/${encodeURIComponent(itemGuid)}?session=s`,
        duration: 1500,
    }));
}

async function startPlaying(t, ply, items, overrides) {
    const player = new ply.MpvPlayer(playerConfig(overrides));
    t.after(() => player.stop());
    assert.equal(await player.playList(items, 0), true);
    return { player, mpv: RunningNodeMpv.last };
}

test('stopping right after playList is called, before it settles, reports the player exit', (t) => {
    const ply = useFakeNodeMpv(t);
    const events = [];
    const player = new ply.MpvPlayer(playerConfig({ onEvent: (type) => events.push(type) }));

    void player.playList([playItem], 0);
    player.stop();

    assert.deepEqual(events, [ply.EventType.EXIT]);
});

test('event data stays as emitted after the player moves on to the next item', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    const items = twoItems();
    const events = [];
    const { mpv } = await startPlaying(t, ply, items, { onEvent: (type, data) => events.push({ type, data }) });
    mpv.emit('status', { property: 'playlist-pos', value: 0 });

    mpv.path = items[0].playLink;
    await mpv.emit('timeposition', 600);
    mpv.emit('seek', { end: 700 });
    mpv.emit('status', { property: 'playlist-pos', value: 1 });

    const expected = { itemGuid: 'item 1', duration: 1500, percentage: 40 };
    assert.deepEqual(
        events.map(({ type, data }) => ({ type, ...data })),
        [
            { type: ply.EventType.PROGRESS, ...expected, ts: 600 },
            { type: ply.EventType.PROGRESS, ...expected, ts: 700 },
            { type: ply.EventType.ITEM_END, ...expected, ts: 700 },
        ],
    );
});

test('an item starting seeks to the position the caller gives for it, with its latest progress', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    const items = twoItems();
    const asked = [];
    const { mpv } = await startPlaying(t, ply, items, {
        resumePosition: (item) => {
            asked.push([item.itemGuid, item.ts]);
            return item.itemGuid === 'item 1' ? item.ts : 0;
        },
    });

    mpv.emit('status', { property: 'path', value: items[0].playLink });
    mpv.path = items[0].playLink;
    await mpv.emit('timeposition', 600);
    mpv.emit('status', { property: 'path', value: items[1].playLink });
    mpv.emit('status', { property: 'path', value: items[0].playLink });
    await delay(50);

    assert.deepEqual(asked, [['item 1', 0], ['item-2', 0], ['item 1', 600]]);
    assert.deepEqual(mpv.seeks, [600]);
});

test('subtitles the caller loads for an item are added to MPV', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    const items = twoItems();
    const { mpv } = await startPlaying(t, ply, items, {
        loadSubtitles: async (itemGuid) => [`/tmp/${itemGuid}.zh@1.srt`],
    });

    mpv.emit('status', { property: 'path', value: items[1].playLink });
    await delay(0);

    assert.deepEqual(mpv.subtitles, ['/tmp/item-2.zh@1.srt']);
});

test('a path that is not a play item in the playlist is ignored', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    const events = [];
    const asked = [];
    const { mpv } = await startPlaying(t, ply, twoItems(), {
        onEvent: (type) => events.push(type),
        resumePosition: (item) => { asked.push(item.itemGuid); return 0; },
        loadSubtitles: async (itemGuid) => { asked.push(itemGuid); return []; },
    });

    mpv.emit('status', { property: 'path', value: 'C:\\Temp\\mpv_playlist_1.m3u8' });
    mpv.path = 'C:\\Temp\\mpv_playlist_1.m3u8';
    await mpv.emit('timeposition', 5);

    assert.deepEqual(asked, []);
    assert.deepEqual(events, []);
});
