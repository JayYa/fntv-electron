const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { useFakeModule } = require('./helpers/fakeElectron.cjs');

// 替身 NodeMpv：start() 一直不返回，模拟 MPV 还在启动；quit() 立即完成
class FakeNodeMpv {
    on() {}
    start() { return new Promise(() => {}); }
    quit() { return Promise.resolve(); }
    isRunning() { return false; }
}

class RunningNodeMpv {
    static last = null;
    static onSetProperty = null;
    constructor() {
        this.handlers = new Map();
        this.path = '';
        this.seeks = [];
        this.subtitles = [];
        this.properties = [];
        RunningNodeMpv.last = this;
    }
    on(event, handler) { this.handlers.set(event, handler); }
    emit(event, value) { return this.handlers.get(event)(value); }
    start() { return Promise.resolve(); }
    loadPlaylist() { return Promise.resolve(); }
    quit() { return Promise.resolve(); }
    isRunning() { return true; }
    setProperty(property, value) {
        this.properties.push([property, value]);
        return RunningNodeMpv.onSetProperty ? RunningNodeMpv.onSetProperty(property, value) : Promise.resolve();
    }
    goToPosition(position) { this.seeks.push(position); return Promise.resolve(); }
    addSubtitles(file) { this.subtitles.push(file); return Promise.resolve(); }
    getDuration() { return Promise.resolve(1500); }
    getPercentPosition() { return Promise.resolve(40); }
    getFilename() { return Promise.resolve(this.path); }
}

// 让 require('node-mpv-2') 返回替身，不真启动 MPV；之后加载的播放器模块拿到替身
function useFakeNodeMpv(t, NodeMpvClass = FakeNodeMpv) {
    useFakeModule(t, 'node-mpv-2', NodeMpvClass);
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

function onSetProperty(t, targetProperty, handler) {
    RunningNodeMpv.onSetProperty = (property, value) => (
        property === targetProperty ? handler(value) : Promise.resolve()
    );
    t.after(() => { RunningNodeMpv.onSetProperty = null; });
}

test('playList waits for playlist-pos to be set before resolving when starting past the first item', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    let resolvePos;
    onSetProperty(t, 'playlist-pos', () => new Promise((resolve) => { resolvePos = resolve; }));

    const { mpv: firstMpv } = await startPlaying(t, ply, twoItems());
    assert.deepEqual(firstMpv.properties, []);

    const player = new ply.MpvPlayer(playerConfig());
    t.after(() => player.stop());

    let settled = false;
    const playing = player.playList(twoItems(), 1).then((ok) => {
        settled = true;
        return ok;
    });

    await delay(20);
    assert.equal(settled, false);
    assert.deepEqual(RunningNodeMpv.last.properties, [['playlist-pos', 1]]);

    resolvePos();
    assert.equal(await playing, true);
});

test('playList emits an error and returns false when setting playlist-pos fails', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    onSetProperty(t, 'playlist-pos', () => Promise.reject(new Error('invalid playlist-pos')));

    const events = [];
    const player = new ply.MpvPlayer(playerConfig({ onEvent: (type, data) => events.push({ type, data }) }));
    t.after(() => player.stop());

    const ok = await player.playList(twoItems(), 1);

    assert.equal(ok, false);
    assert.deepEqual(events, [{ type: ply.EventType.ERROR, data: { message: 'invalid playlist-pos' } }]);
});

class StoppedWhileCreatedNodeMpv extends RunningNodeMpv {
    static onCreate = null;
    static started = 0;
    constructor() {
        super();
        StoppedWhileCreatedNodeMpv.onCreate?.();
    }
    start() {
        StoppedWhileCreatedNodeMpv.started += 1;
        return super.start();
    }
}

test('a stop before the MPV instance exists ends the playback run without waiting for the stop timeout', async (t) => {
    const ply = useFakeNodeMpv(t, StoppedWhileCreatedNodeMpv);
    const playbackState = require('../dest/modules/playback/playbackState.js');
    t.after(() => { StoppedWhileCreatedNodeMpv.onCreate = null; StoppedWhileCreatedNodeMpv.started = 0; });
    const run = playbackState.beginPlayback();
    const events = [];
    const player = new ply.MpvPlayer(playerConfig({
        onEvent: (type) => {
            events.push(type);
            if (type === ply.EventType.EXIT) void run.ended();
        },
    }));
    let stopped;
    StoppedWhileCreatedNodeMpv.onCreate = () => {
        StoppedWhileCreatedNodeMpv.onCreate = null;
        const begun = Date.now();
        stopped = playbackState.stopPlaybackAndWait().then(() => Date.now() - begun);
    };

    assert.equal(await run.start(player, () => player.playList([playItem], 0)), false);

    assert.ok(await stopped < 1000, 'stopPlaybackAndWait waited for its timeout');
    assert.equal(playbackState.isPlaying(), false);
    assert.deepEqual(events, [ply.EventType.EXIT]);
    assert.equal(StoppedWhileCreatedNodeMpv.started, 0);
});

test('a stop before the MPV instance exists does not stop the next playList', async (t) => {
    const ply = useFakeNodeMpv(t, StoppedWhileCreatedNodeMpv);
    const player = new ply.MpvPlayer(playerConfig());
    t.after(() => { StoppedWhileCreatedNodeMpv.onCreate = null; StoppedWhileCreatedNodeMpv.started = 0; player.stop(); });
    StoppedWhileCreatedNodeMpv.onCreate = () => {
        StoppedWhileCreatedNodeMpv.onCreate = null;
        player.stop();
    };
    await player.playList([playItem], 0);

    assert.equal(await player.playList([playItem], 0), true);
    assert.equal(player.isPlaying(), true);
});
