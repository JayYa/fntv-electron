const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { fakeMpvProcesses } = require('./helpers/fakeMpvProcess.cjs');
const ply = require('../dest/modules/players/index.js');

const playItem = {
    itemGuid: 'item-1',
    title: 'Episode 1',
    playLink: 'http://127.0.0.1/stream',
    ts: 0,
    duration: 100,
};

function twoItems() {
    return ['item 1', 'item-2'].map((itemGuid) => ({
        ...playItem,
        itemGuid,
        playLink: `http://127.0.0.1:1234/api/v1/playvideo/${encodeURIComponent(itemGuid)}?session=s`,
        duration: 1500,
    }));
}

function newPlayer(t, { mpvOptions, ...overrides } = {}) {
    const processes = fakeMpvProcesses(mpvOptions);
    const events = [];
    const player = new ply.MpvPlayer({
        createMpvProcess: processes.createMpvProcess,
        onEvent: (type, data) => events.push({ type, data }),
        resumePosition: () => 0,
        loadSubtitles: async () => [],
        ...overrides,
    });
    t.after(() => player.stop());
    return { player, events, processes };
}

async function startPlaying(t, items, overrides) {
    const started = newPlayer(t, overrides);
    assert.equal(await started.player.playList(items, 0), true);
    return { ...started, mpv: started.processes.last() };
}

const types = (events) => events.map(({ type }) => type);

test('stopping before MPV finishes starting fails the play request and reports nothing', async (t) => {
    const { player, events } = newPlayer(t, { mpvOptions: { startPending: true } });

    const playing = player.playList([playItem], 0);
    player.stop();

    assert.equal(await playing, false);
    await delay(10);
    assert.deepEqual(events, []);
});

test('MPV that fails to start fails the play request with one error and no exit', async (t) => {
    const { player, events } = newPlayer(t, { mpvOptions: { startError: new Error('spawn EACCES') } });

    assert.equal(await player.playList([playItem], 0), false);

    assert.deepEqual(events, [{ type: ply.EventType.ERROR, data: { message: 'spawn EACCES' } }]);
});

test('stopping the player reports its exit only once MPV has exited, with the latest progress', async (t) => {
    const items = twoItems();
    const { player, events, mpv } = await startPlaying(t, items);
    mpv.emitProperty('playlist-pos', 0);
    mpv.emitSeek(300);

    player.stop();
    assert.deepEqual(types(events), [ply.EventType.PROGRESS]);
    await delay(10);

    assert.deepEqual(events.slice(1), [{
        type: ply.EventType.EXIT,
        data: { code: 0, status: { itemGuid: 'item 1', ts: 300, duration: 1500, percentage: 0 } },
    }]);
});

test('stopping while the playlist is still loading lets MPV start and reports its exit once it has exited', async (t) => {
    let resolvePos;
    const onSetProperty = (property) => (
        property === 'playlist-pos' ? new Promise((resolve) => { resolvePos = resolve; }) : Promise.resolve()
    );
    const { player, events } = newPlayer(t, { mpvOptions: { onSetProperty } });

    const playing = player.playList(twoItems(), 1);
    await delay(10);
    player.stop();
    resolvePos();

    assert.equal(await playing, true);
    await delay(10);
    assert.deepEqual(events.map(({ type, data }) => ({ type, code: data.code })), [{ type: ply.EventType.EXIT, code: 0 }]);
});

test('progress MPV reports while playing reaches the caller at most once every 15 seconds', async (t) => {
    const items = twoItems();
    const { events, mpv } = await startPlaying(t, items);
    mpv.path = items[0].playLink;
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    t.after(() => { Date.now = realNow; });

    for (const [seconds, later] of [[100, 0], [101, 14999], [102, 1], [103, 5000]]) {
        now += later;
        mpv.emitTimePosition(seconds);
        await delay(0);
    }

    assert.deepEqual(events.map(({ type, data }) => [type, data.ts]), [
        [ply.EventType.PROGRESS, 100],
        [ply.EventType.PROGRESS, 102],
    ]);
});

test('MPV exiting on its own ends the player with its exit code and no separate error', async (t) => {
    const { events, mpv } = await startPlaying(t, twoItems());

    mpv.exit(4);

    assert.deepEqual(events.map(({ type, data }) => ({ type, code: data.code })), [{ type: ply.EventType.EXIT, code: 4 }]);
});

test('event data stays as emitted after the player moves on to the next item', async (t) => {
    const items = twoItems();
    const { events, mpv } = await startPlaying(t, items);
    mpv.emitProperty('playlist-pos', 0);

    mpv.path = items[0].playLink;
    mpv.emitTimePosition(600);
    await delay(0);
    mpv.emitSeek(700);
    mpv.emitProperty('playlist-pos', 1);

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
    const items = twoItems();
    const asked = [];
    const { mpv } = await startPlaying(t, items, {
        resumePosition: (item) => {
            asked.push([item.itemGuid, item.ts]);
            return item.itemGuid === 'item 1' ? item.ts : 0;
        },
    });

    mpv.emitProperty('path', items[0].playLink);
    mpv.path = items[0].playLink;
    mpv.emitTimePosition(600);
    await delay(0);
    mpv.emitProperty('path', items[1].playLink);
    mpv.emitProperty('path', items[0].playLink);
    await delay(50);

    assert.deepEqual(asked, [['item 1', 0], ['item-2', 0], ['item 1', 600]]);
    assert.deepEqual(mpv.seeks, [600]);
});

test('subtitles the caller loads for an item are added to MPV', async (t) => {
    const items = twoItems();
    const { mpv } = await startPlaying(t, items, {
        loadSubtitles: async (itemGuid) => [`/tmp/${itemGuid}.zh@1.srt`],
    });

    mpv.emitProperty('path', items[1].playLink);
    await delay(0);

    assert.deepEqual(mpv.subtitles, ['/tmp/item-2.zh@1.srt']);
});

test('a path that is not a play item in the playlist is ignored', async (t) => {
    const asked = [];
    const { events, mpv } = await startPlaying(t, twoItems(), {
        resumePosition: (item) => { asked.push(item.itemGuid); return 0; },
        loadSubtitles: async (itemGuid) => { asked.push(itemGuid); return []; },
    });

    mpv.emitProperty('path', 'C:\\Temp\\mpv_playlist_1.m3u8');
    mpv.path = 'C:\\Temp\\mpv_playlist_1.m3u8';
    mpv.emitTimePosition(5);
    await delay(0);

    assert.deepEqual(asked, []);
    assert.deepEqual(events, []);
});

test('playList waits for playlist-pos to be set before resolving when starting past the first item', async (t) => {
    let resolvePos;
    const onSetProperty = (property) => (
        property === 'playlist-pos' ? new Promise((resolve) => { resolvePos = resolve; }) : Promise.resolve()
    );
    const { player, processes } = newPlayer(t, { mpvOptions: { onSetProperty } });

    let settled = false;
    const playing = player.playList(twoItems(), 1).then((ok) => {
        settled = true;
        return ok;
    });

    await delay(20);
    assert.equal(settled, false);
    assert.deepEqual(processes.last().properties, [['playlist-pos', 1]]);

    resolvePos();
    assert.equal(await playing, true);
});

test('a playlist that fails to load after MPV started stops MPV and reports one error and nothing more', async (t) => {
    const onSetProperty = (property) => (
        property === 'playlist-pos' ? Promise.reject(new Error('invalid playlist-pos')) : Promise.resolve()
    );
    const { player, events, processes } = newPlayer(t, { mpvOptions: { onSetProperty } });

    assert.equal(await player.playList(twoItems(), 1), false);
    const mpv = processes.last();
    await delay(10);
    player.stop();

    assert.equal(mpv.exited, true);
    assert.deepEqual(events, [{ type: ply.EventType.ERROR, data: { message: 'invalid playlist-pos' } }]);
});

test('the playlist the caller passes in is left unchanged while MPV reports progress', async (t) => {
    const items = twoItems();
    const before = structuredClone(items);
    const { mpv } = await startPlaying(t, items);

    mpv.path = items[0].playLink;
    mpv.emitProperty('path', items[0].playLink);
    mpv.emitTimePosition(600);
    await delay(0);
    mpv.emitSeek(700);

    assert.deepEqual(items, before);
});

const resumeItem1At600 = { resumePosition: (item) => (item.itemGuid === 'item 1' ? 600 : 0) };

test('a resume seek MPV rejects at first is retried until MPV accepts it, once', async (t) => {
    const items = twoItems();
    const { mpv } = await startPlaying(t, items, { ...resumeItem1At600, mpvOptions: { seekFailures: 3 } });

    mpv.emitProperty('path', items[0].playLink);
    await delay(100);

    assert.deepEqual(mpv.seeks, [600]);
    assert.equal(mpv.seekAttempts, 4);
});

test('a resume seek still being retried stops once MPV moves on to another play item', async (t) => {
    const items = twoItems();
    const { mpv } = await startPlaying(t, items, { ...resumeItem1At600, mpvOptions: { seekFailures: Infinity } });

    mpv.emitProperty('path', items[0].playLink);
    await delay(50);
    mpv.emitProperty('path', items[1].playLink);
    mpv.seekFailures = 0;
    await delay(50);

    assert.deepEqual(mpv.seeks, []);
});

test('a resume seek MPV keeps rejecting is given up after 30 seconds', async (t) => {
    const items = twoItems();
    const { mpv } = await startPlaying(t, items, { ...resumeItem1At600, mpvOptions: { seekFailures: Infinity } });
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const advance = async (ms) => {
        for (let elapsed = 0; elapsed < ms; elapsed += 10) {
            t.mock.timers.tick(10);
            await new Promise((resolve) => setImmediate(resolve));
        }
    };

    mpv.emitProperty('path', items[0].playLink);
    await advance(29_000);
    const attemptsBeforeLimit = mpv.seekAttempts;
    await advance(2_000);
    const attemptsAtLimit = mpv.seekAttempts;
    await advance(1_000);

    assert.ok(attemptsAtLimit > attemptsBeforeLimit);
    assert.equal(mpv.seekAttempts, attemptsAtLimit);
});
