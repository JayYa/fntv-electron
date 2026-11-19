const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlay } = require('../dest/modules/playback/play.js');
const playbackState = require('../dest/modules/playback/playbackState.js');
const { EventType } = require('../dest/modules/players/types.js');

const settle = () => new Promise(setImmediate);

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

function playInfo(overrides = {}) {
    return {
        guid: 'ep-2',
        type: 'Episode',
        parent_guid: 'season-1',
        ts: 0,
        media_guid: 'media-ep-2',
        video_guid: 'video-ep-2',
        audio_guid: 'audio-ep-2',
        subtitle_guid: '',
        item: { title: 'Episode 2', tv_title: 'Show', season_number: 1, episode_number: 2, duration: 1500 },
        ...overrides,
    };
}

function listItem(guid, ts = 0) {
    return { guid, title: guid, tv_title: 'Show', season_number: 1, episode_number: 1, ts, duration: 1500 };
}

// 替身飞牛影视服务：记下写入的播放进度和已观看，savePlayRecord 的结果可以按测试改
function fakeFnMedia({ info = playInfo(), episodes = [listItem('ep-1'), listItem('ep-2', 600), listItem('ep-3')], items = [] } = {}) {
    const writes = [];
    const fnMedia = {
        writes,
        saveResult: async () => ({ success: true }),
        api: {
            getPlayInfo: async () => ({ success: true, data: info }),
            getPlayInfoCached: async (guid) => ({ success: true, data: { ...info, guid, media_guid: `media-${guid}` } }),
            getEpisodeList: async () => ({ success: true, data: episodes }),
            getItemList: async () => ({ success: true, data: { list: items } }),
            savePlayRecord: async (record) => {
                writes.push(['savePlayRecord', record.item_guid, record.ts]);
                fnMedia.lastRecord = record;
                return fnMedia.saveResult(record);
            },
            setWatched: async (guid) => {
                writes.push(['setWatched', guid]);
                return { success: true };
            },
            getVideoUrl: (mediaGuid) => `https://nas.example:5666/v/api/v1/media/${mediaGuid}`,
            getSubtitle: async () => [],
            downloadSubtitle: async () => [],
        },
    };
    return fnMedia;
}

// 替身播放器：记下要播的播放列表，stop() 像 MPV 一样报告正常退出
class FakePlayer {
    constructor(options) {
        this.options = options;
        this.exitStatus = { itemGuid: '', ts: 0, duration: 0, percentage: 0 };
    }
    playList(items, pos) {
        this.items = items;
        this.pos = pos;
        return Promise.resolve(true);
    }
    stop() { this.options.onEvent(EventType.EXIT, { code: 0, status: this.exitStatus }); }
    isPlaying() { return true; }
    emit(type, data) { return this.options.onEvent(type, data); }
}

function setup(t, { fnMedia = fakeFnMedia(), mpvFound = true, connect } = {}) {
    const world = { fnMedia, players: [], proxyItems: [], abnormalExits: 0 };
    const play = createPlay({
        connect: connect ?? (async () => ({
            fnapi: fnMedia.api,
            openProxySession: async (itemGuids) => {
                world.proxyItems.push(itemGuids);
                return (itemGuid, sourceIndex) => `http://127.0.0.1:1234/${itemGuid}${sourceIndex ? `?sourceIndex=${sourceIndex}` : ''}`;
            },
        })),
        launchPlayer: (options) => {
            if (!mpvFound) return undefined;
            const player = new FakePlayer(options);
            world.players.push(player);
            return player;
        },
        onAbnormalExit: async () => { world.abnormalExits += 1; },
    });
    world.play = (request) => play({ sourceIndex: 0, ...request }, playbackState.beginPlayback());
    t.after(() => playbackState.stopPlaybackAndWait());
    return world;
}

const status = (itemGuid, ts, duration = 1500) => ({ itemGuid, ts, duration, percentage: Math.floor((ts / duration) * 100) });

test('an episode plays the whole season from the requested episode, through one Proxy playback session', async (t) => {
    const world = setup(t);
    await world.play({ id: 'ep-2' });

    const [player] = world.players;
    assert.deepEqual(player.items.map((item) => item.itemGuid), ['ep-1', 'ep-2', 'ep-3']);
    assert.equal(player.pos, 1);
    assert.deepEqual(world.proxyItems, [['ep-1', 'ep-2', 'ep-3']]);
    assert.equal(player.items[1].playLink, 'http://127.0.0.1:1234/ep-2');
    assert.equal(playbackState.isPlaying(), true);
});

test('another video plays its folder, and anything else plays only itself', async (t) => {
    const folder = setup(t, {
        fnMedia: fakeFnMedia({ info: playInfo({ type: 'Video', guid: 'v-2' }), items: [listItem('v-1'), listItem('v-2')] }),
    });
    await folder.play({ id: 'v-2' });
    assert.deepEqual(folder.players[0].items.map((item) => item.itemGuid), ['v-1', 'v-2']);
    await playbackState.stopPlaybackAndWait();

    const single = setup(t, { fnMedia: fakeFnMedia({ info: playInfo({ type: 'Movie', guid: 'movie', parent_guid: '' }) }) });
    await single.play({ id: 'movie' });
    assert.deepEqual(single.players[0].items.map((item) => item.itemGuid), ['movie']);
});

test('the chosen media source applies only to the requested play item', async (t) => {
    const world = setup(t);
    await world.play({ id: 'ep-2', sourceIndex: 2 });

    assert.deepEqual(world.players[0].items.map((item) => item.playLink), [
        'http://127.0.0.1:1234/ep-1',
        'http://127.0.0.1:1234/ep-2?sourceIndex=2',
        'http://127.0.0.1:1234/ep-3',
    ]);
});

test('the player resumes from the play record unless it is near end', async (t) => {
    const world = setup(t);
    await world.play({ id: 'ep-2' });

    const { options, items } = world.players[0];
    assert.equal(options.resumePosition(items[1]), 600);
    assert.equal(options.resumePosition({ ...items[1], ts: 1480 }), 0);
});

test('restart clears the play record before playing and does not resume', async (t) => {
    const world = setup(t);
    await world.play({ id: 'ep-2', restart: true });

    assert.deepEqual(world.fnMedia.writes, [['savePlayRecord', 'ep-2', 0]]);
    const { options, items } = world.players[0];
    assert.equal(options.resumePosition(items[1]), 0);
});

test('restart still plays when clearing the play record fails', async (t) => {
    const fnMedia = fakeFnMedia();
    fnMedia.saveResult = async () => { throw new Error('network down'); };
    const world = setup(t, { fnMedia });
    await world.play({ id: 'ep-2', restart: true });

    assert.equal(world.players.length, 1);
    assert.equal(world.players[0].items[1].ts, 0);
});

test('progress is reported as a play record for the play item it belongs to', async (t) => {
    const world = setup(t);
    await world.play({ id: 'ep-2' });

    await world.players[0].emit(EventType.PROGRESS, status('ep-2', 700));

    assert.deepEqual(world.fnMedia.lastRecord, {
        item_guid: 'ep-2',
        media_guid: 'media-ep-2',
        video_guid: 'video-ep-2',
        audio_guid: 'audio-ep-2',
        subtitle_guid: '',
        play_link: 'nas.example',
        ts: 700,
        duration: 1500,
    });
});

test('leaving a play item near end reports its progress, then marks it watched', async (t) => {
    const world = setup(t);
    await world.play({ id: 'ep-2' });

    await world.players[0].emit(EventType.ITEM_END, status('ep-1', 1480));
    await world.players[0].emit(EventType.ITEM_END, status('ep-2', 900));

    assert.deepEqual(world.fnMedia.writes, [
        ['savePlayRecord', 'ep-1', 1480],
        ['setWatched', 'ep-1'],
        ['savePlayRecord', 'ep-2', 900],
    ]);
});

test('a play item is marked watched near end even when reporting its progress fails', async (t) => {
    const fnMedia = fakeFnMedia();
    fnMedia.saveResult = async () => ({ success: false, message: 'busy' });
    const world = setup(t, { fnMedia });
    await world.play({ id: 'ep-2' });

    await world.players[0].emit(EventType.ITEM_END, status('ep-2', 1490));

    assert.deepEqual(fnMedia.writes.at(-1), ['setWatched', 'ep-2']);
});

test('the playback run ends only after the exit progress report has finished', async (t) => {
    const fnMedia = fakeFnMedia();
    const world = setup(t, { fnMedia });
    await world.play({ id: 'ep-2' });
    const ended = [];
    t.after(playbackState.onPlaybackEnded(() => ended.push('ended')));

    const saved = deferred();
    fnMedia.saveResult = () => saved.promise.then(() => ({ success: true }));
    world.players[0].exitStatus = status('ep-2', 1200);
    const stopped = playbackState.stopPlaybackAndWait();

    assert.equal(playbackState.isPlaying(), false);
    await settle();
    assert.deepEqual(ended, []);

    saved.resolve();
    await stopped;
    assert.deepEqual(ended, ['ended']);
    assert.deepEqual(fnMedia.writes, [['savePlayRecord', 'ep-2', 1200]]);
});

test('an abnormal MPV exit hands over to the caller without reporting progress', async (t) => {
    const world = setup(t);
    await world.play({ id: 'ep-2' });

    await world.players[0].emit(EventType.EXIT, { code: 1, status: status('ep-2', 300) });

    assert.equal(world.abnormalExits, 1);
    assert.deepEqual(world.fnMedia.writes, []);
    assert.equal(playbackState.isPlaying(), false);
});

test('the playback run ends right away when MPV is not found or play info is unavailable', async (t) => {
    const noMpv = setup(t, { mpvFound: false });
    await noMpv.play({ id: 'ep-2' });
    assert.equal(playbackState.isPlaying(), false);

    const fnMedia = fakeFnMedia();
    fnMedia.api.getPlayInfo = async () => ({ success: false, message: 'gone' });
    const noInfo = setup(t, { fnMedia });
    await noInfo.play({ id: 'ep-2' });
    assert.equal(playbackState.isPlaying(), false);
    assert.deepEqual(noInfo.players, []);
});

test('without a valid current login the play request fails and the playback run ends', async (t) => {
    const world = setup(t, { connect: async () => { throw new Error('无法找到有效的服务器登录配置'); } });

    await assert.rejects(world.play({ id: 'ep-2' }), /登录配置/);
    assert.equal(playbackState.isPlaying(), false);
});
