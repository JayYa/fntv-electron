const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { useFakeModule } = require('./helpers/fakeElectron.cjs');

class FakeNodeMpv {
    on() {}
    start() { return new Promise(() => {}); }
    quit() { return Promise.resolve(); }
    isRunning() { return false; }
}

class RunningNodeMpv {
    static last = null;
    static onSetProperty = null;
    constructor(options) {
        this.options = options;
        this.handlers = new Map();
        this.path = '';
        this.seeks = [];
        this.subtitles = [];
        this.properties = [];
        this.quits = 0;
        RunningNodeMpv.last = this;
    }
    on(event, handler) { this.handlers.set(event, handler); }
    emit(event, value) { return this.handlers.get(event)(value); }
    start() { this.mpvPlayer = new EventEmitter(); return Promise.resolve(); }
    loadPlaylist() { return Promise.resolve(); }
    quit() { this.quits += 1; return Promise.resolve(); }
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

test('a playlist that fails to load after MPV started quits MPV and reports nothing more', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    onSetProperty(t, 'playlist-pos', () => Promise.reject(new Error('invalid playlist-pos')));
    const events = [];
    const player = new ply.MpvPlayer(playerConfig({ onEvent: (type) => events.push(type) }));

    assert.equal(await player.playList(twoItems(), 1), false);
    const mpv = RunningNodeMpv.last;
    mpv.emit('crashed');
    mpv.emit('quit');
    player.stop();

    assert.equal(mpv.quits, 1);
    assert.deepEqual(events, [ply.EventType.ERROR]);
});

test('MPV is not restarted by node-mpv after it crashes', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    const { mpv } = await startPlaying(t, ply, twoItems());

    assert.equal(mpv.options.auto_restart, false);
});

test('MPV that crashes, even when also reported as quit, ends the player once as an abnormal exit', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    const events = [];
    const { mpv } = await startPlaying(t, ply, twoItems(), { onEvent: (type, data) => events.push({ type, code: data.code }) });

    mpv.emit('crashed');
    mpv.emit('quit');

    assert.deepEqual(events, [
        { type: ply.EventType.ERROR, code: undefined },
        { type: ply.EventType.EXIT, code: 1 },
    ]);
});

test('MPV that exits with a code node-mpv does not report ends the player once as an abnormal exit', async (t) => {
    const ply = useFakeNodeMpv(t, RunningNodeMpv);
    for (const [code, signal, expected] of [[2, null, 2], [null, 'SIGKILL', 1]]) {
        const events = [];
        const { mpv } = await startPlaying(t, ply, twoItems(), { onEvent: (type, data) => events.push({ type, code: data.code }) });

        mpv.mpvPlayer.emit('close', code, signal);
        mpv.mpvPlayer.emit('close', code, signal);

        assert.deepEqual(events, [{ type: ply.EventType.EXIT, code: expected }]);
    }
});

test('MPV that finishes starting after the player was stopped is quit and reports nothing more', async (t) => {
    let finishStart;
    const calls = [];
    class SlowStartNodeMpv extends RunningNodeMpv {
        start() { return new Promise((resolve) => { finishStart = () => { calls.push('started'); resolve(); }; }); }
        quit() { calls.push('quit'); return Promise.resolve(); }
    }
    const ply = useFakeNodeMpv(t, SlowStartNodeMpv);
    const events = [];
    const player = new ply.MpvPlayer(playerConfig({ onEvent: (type) => events.push(type) }));

    const playing = player.playList(twoItems(), 0);
    player.stop();
    finishStart();

    assert.equal(await playing, false);
    assert.deepEqual(calls.slice(-2), ['started', 'quit']);
    assert.deepEqual(events, [ply.EventType.EXIT]);
});
