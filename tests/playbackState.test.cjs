const test = require('node:test');
const assert = require('node:assert/strict');
const {
    beginPlayback,
    isPlaying,
    onPlaybackEnded,
    stopPlaybackAndWait,
} =require('../dest/modules/playback/playbackState.js');

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

const settle = () => new Promise(setImmediate);

test('playback counts as playing from start request until it ends', () => {
    assert.equal(isPlaying(), false);

    const session = beginPlayback();
    assert.equal(isPlaying(), true);

    session.ended();
    assert.equal(isPlaying(), false);
});

test('subscribers are notified once the exit progress report has finished', async (t) => {
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));

    const session = beginPlayback();
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

    const session = beginPlayback();
    session.ended();
    session.ended();
    await settle();

    assert.deepEqual(notified, ['ended']);
});

test('unsubscribed listeners are not notified', async () => {
    const notified = [];
    const unsubscribe = onPlaybackEnded(() => notified.push('ended'));
    unsubscribe();

    beginPlayback().ended();
    await settle();

    assert.deepEqual(notified, []);
});

test('subscribers are not notified while a newer playback is still running', async (t) => {
    const notified = [];
    t.after(onPlaybackEnded(() => notified.push('ended')));

    const first = beginPlayback();
    const report = deferred();
    first.ended(report.promise);
    const second = beginPlayback();
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

test('stopping a playback stops the player and waits for the exit progress report', async () => {
    const session = beginPlayback();
    const report = deferred();
    const player = { stop: () => session.ended(report.promise) };
    assert.equal(session.attach(player), true);

    const stopped = trackSettled(stopPlaybackAndWait());
    assert.equal(isPlaying(), false);
    await settle();
    assert.equal(stopped.settled, false);

    report.resolve();
    await settle();
    assert.equal(stopped.settled, true);
});

test('stopping while the player has already exited waits for the pending exit report', async () => {
    const session = beginPlayback();
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
    const session = beginPlayback();

    const stopped = trackSettled(stopPlaybackAndWait());
    const stops = [];
    assert.equal(session.attach({ stop: () => stops.push('stop') }), false);
    session.ended();
    await settle();

    assert.deepEqual(stops, []);
    assert.equal(stopped.settled, true);
    assert.equal(isPlaying(), false);
});
