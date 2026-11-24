const test = require('node:test');
const assert = require('node:assert/strict');
const playback = require('../dest/modules/playback/playbackState.js');
const { isPlaying, onPlaybackEnded, runPlayback, stopPlaybackAndWait } = playback;
const { beginRun } = require('./helpers/playbackRun.cjs');
const log = require('../dest/modules/logger/index.js');

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

const settle = () => new Promise(setImmediate);

test('playback counts as playing from start request until it ends', () => {
    assert.equal(isPlaying(), false);

    const session = beginRun(playback);
    assert.equal(isPlaying(), true);

    session.ended();
    assert.equal(isPlaying(), false);
});

test('a second playback cannot begin while one is starting or playing, but can while the last one is still reporting', async () => {
    const first = beginRun(playback);
    assert.equal(beginRun(playback), null);

    const report = deferred();
    first.ended(report.promise);
    const second = beginRun(playback);
    assert.notEqual(second, null);

    second.ended();
    report.resolve();
    await settle();
});

test('a play request while a playback is running is refused without starting anything', async () => {
    const first = beginRun(playback);
    const calls = [];

    assert.equal(await runPlayback(async () => { calls.push('body'); }), false);
    assert.deepEqual(calls, []);

    first.ended();
    await settle();
});

test('a playback that finishes starting without starting a player ends by itself', async (t) => {
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));

    assert.equal(await runPlayback(async () => {}), true);
    await settle();

    assert.equal(isPlaying(), false);
    assert.deepEqual(notified, ['ended']);
});

test('a playback whose player fails to play ends by itself', async () => {
    await runPlayback(async (run) => {
        await run.start({ stop: () => {} }, () => Promise.resolve(false));
    });

    assert.equal(isPlaying(), false);
});

test('a playback whose start throws ends by itself and passes the error on', async () => {
    await assert.rejects(runPlayback(async () => { throw new Error('no login'); }), /no login/);

    assert.equal(isPlaying(), false);
});

test('a playback whose player started keeps playing after starting finishes', async () => {
    let session;
    await runPlayback(async (run) => {
        session = run;
        await run.start({ stop: () => {} }, () => Promise.resolve(true));
    });

    assert.equal(isPlaying(), true);
    session.ended();
});

test('subscribers are notified once the exit progress report has finished', async (t) => {
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));

    const session = beginRun(playback);
    const report = deferred();
    session.ended(report.promise);

    assert.equal(isPlaying(), false);
    await settle();
    assert.deepEqual(notified, []);

    report.resolve();
    await settle();
    assert.deepEqual(notified, ['ended']);
});

test('a playback that ends twice notifies subscribers only once', async (t) => {
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));

    const session = beginRun(playback);
    session.ended();
    session.ended();
    await settle();

    assert.deepEqual(notified, ['ended']);
});

test('unsubscribed listeners are not notified', async () => {
    const notified = [];
    const unsubscribe = onPlaybackEnded(() => notified.push('ended'));
    unsubscribe();

    beginRun(playback).ended();
    await settle();

    assert.deepEqual(notified, []);
});

test('subscribers are not notified while a newer playback is still running', async (t) => {
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));

    const first = beginRun(playback);
    const report = deferred();
    first.ended(report.promise);
    const second = beginRun(playback);
    report.resolve();
    await settle();
    assert.deepEqual(notified, []);

    second.ended();
    await settle();
    assert.deepEqual(notified, ['ended']);
});

function trackSettled(promise) {
    const state = { settled: false };
    promise.then(() => { state.settled = true; });
    return state;
}

test('stopping without a playback returns immediately', async () => {
    const stopped = trackSettled(stopPlaybackAndWait());
    await settle();
    assert.equal(stopped.settled, true);
});

test('starting a playback plays within the same call and returns what play returns', async () => {
    const session = beginRun(playback);
    const calls = [];
    const started = session.start({ stop: () => {} }, () => {
        calls.push('play');
        return Promise.resolve(true);
    });
    calls.push('start returned');

    assert.deepEqual(calls, ['play', 'start returned']);
    assert.equal(await started, true);
    session.ended();
});

test('a stop after starting stops the player that was started', async () => {
    const session = beginRun(playback);
    const stops = [];
    void session.start({ stop: () => { stops.push('stop'); session.ended(); } }, () => new Promise(() => {}));

    await stopPlaybackAndWait();

    assert.deepEqual(stops, ['stop']);
    assert.equal(isPlaying(), false);
});

test('stopping a playback stops the player and waits for the exit progress report', async () => {
    const session = beginRun(playback);
    const report = deferred();
    const player = { stop: () => session.ended(report.promise) };
    assert.equal(await session.start(player, () => Promise.resolve(true)), true);

    const stopped = trackSettled(stopPlaybackAndWait());
    assert.equal(isPlaying(), false);
    await settle();
    assert.equal(stopped.settled, false);

    report.resolve();
    await settle();
    assert.equal(stopped.settled, true);
});

test('stopping while the player has already exited waits for the pending exit report', async () => {
    const session = beginRun(playback);
    const report = deferred();
    session.ended(report.promise);

    const stopped = trackSettled(stopPlaybackAndWait());
    await settle();
    assert.equal(stopped.settled, false);

    report.resolve();
    await settle();
    assert.equal(stopped.settled, true);
});

test('stopping while playback is still starting cancels the start', async () => {
    const session = beginRun(playback);

    const stopped = trackSettled(stopPlaybackAndWait());
    const calls = [];
    const started = await session.start({ stop: () => calls.push('stop') }, () => {
        calls.push('play');
        return Promise.resolve(true);
    });
    assert.equal(started, false);
    session.ended();
    await settle();

    assert.deepEqual(calls, []);
    assert.equal(stopped.settled, true);
    assert.equal(isPlaying(), false);
});

test('starting a playback that has already ended does not play', async () => {
    const session = beginRun(playback);
    session.ended();

    const calls = [];
    const started = await session.start({ stop: () => calls.push('stop') }, () => {
        calls.push('play');
        return Promise.resolve(true);
    });

    assert.equal(started, false);
    assert.deepEqual(calls, []);
});

function useFakeClockAndCaptureWarnings(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    return t.mock.method(log, 'warn', () => {});
}

const warnings = (warn) => warn.mock.calls.map((call) => call.arguments.join(' '));

test('stopping gives up waiting after 5 seconds when the exit progress report never finishes', async (t) => {
    const warn = useFakeClockAndCaptureWarnings(t);
    const session = beginRun(playback);
    session.start({ stop: () => session.ended(new Promise(() => {})) }, () => Promise.resolve(true));

    const stopped = trackSettled(stopPlaybackAndWait());
    t.mock.timers.tick(4999);
    await settle();
    assert.equal(stopped.settled, false);
    assert.deepEqual(warnings(warn), []);

    t.mock.timers.tick(1);
    await settle();
    assert.equal(stopped.settled, true);
    assert.equal(warnings(warn).length, 1);
    assert.match(warnings(warn)[0], /等进度回传超时，继续/);
});

test('stopping returns with the exit progress report when it finishes in time, without a timeout warning', async (t) => {
    const warn = useFakeClockAndCaptureWarnings(t);
    const session = beginRun(playback);
    const report = deferred();
    session.start({ stop: () => session.ended(report.promise) }, () => Promise.resolve(true));

    const stopped = trackSettled(stopPlaybackAndWait());
    t.mock.timers.tick(1000);
    report.resolve();
    await settle();
    assert.equal(stopped.settled, true);

    t.mock.timers.tick(10000);
    await settle();
    assert.deepEqual(warnings(warn), []);
});

test('a playback whose player never reports its exit ends 5 seconds after the stop', async (t) => {
    const warn = useFakeClockAndCaptureWarnings(t);
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));
    const session = beginRun(playback);
    session.start({ stop: () => {} }, () => Promise.resolve(true));

    const stopped = trackSettled(stopPlaybackAndWait());
    t.mock.timers.tick(4999);
    await settle();
    assert.equal(isPlaying(), true);

    t.mock.timers.tick(1);
    await settle();
    assert.equal(stopped.settled, true);
    assert.equal(isPlaying(), false);
    assert.deepEqual(notified, ['ended']);
    assert.equal(warnings(warn).length, 1);
    assert.match(warnings(warn)[0], /强制结束/);
});

test('a late exit from a player whose playback was ended after the stop does not touch the next playback', async (t) => {
    useFakeClockAndCaptureWarnings(t);
    const notified = [];
    const stale = beginRun(playback);
    stale.start({ stop: () => {} }, () => Promise.resolve(true));
    const stopped = stopPlaybackAndWait();
    t.mock.timers.tick(5000);
    await stopped;

    const next = beginRun(playback);
    assert.notEqual(next, null);
    t.after(onPlaybackEnded(() => notified.push('ended')));

    await stale.ended();
    await settle();
    assert.equal(isPlaying(), true);
    assert.deepEqual(notified, []);

    next.ended();
    await settle();
    assert.deepEqual(notified, ['ended']);
});

test('a progress report that finishes after the stop timed out still notifies subscribers', async (t) => {
    useFakeClockAndCaptureWarnings(t);
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));
    const session = beginRun(playback);
    const report = deferred();
    session.start({ stop: () => session.ended(report.promise) }, () => Promise.resolve(true));

    const stopped = trackSettled(stopPlaybackAndWait());
    t.mock.timers.tick(5000);
    await settle();
    assert.equal(stopped.settled, true);
    assert.equal(isPlaying(), false);
    assert.deepEqual(notified, []);

    report.resolve();
    await settle();
    assert.deepEqual(notified, ['ended']);
    assert.equal(isPlaying(), false);
});
