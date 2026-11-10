const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeFnMedia, json, ok } = require('./helpers/fakeFnMedia.cjs');
const { startProxy, post, sessionInput } = require('./helpers/proxyService.cjs');

const PLAY_INFO = { 'item-1': { guid: 'item-1', parent_guid: 'season-1', play_config: { skip_opening: 0, skip_ending: 0 } } };

function writes(nas) {
    return nas.requests.filter((r) => r.path === '/v/api/v1/play/setConfigByItem').map((r) => {
        const { guid, skip_opening, skip_ending } = JSON.parse(r.body);
        return { guid, skip_opening, skip_ending };
    });
}

test('POST skipinfo writes the skip points to the parent of the item on the NAS', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: 85, skipEnd: 120 });

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.body.toString(), '{"code":0,"msg":"success"}');
    assert.deepEqual(writes(nas), [{ guid: 'season-1', skip_opening: 85, skip_ending: 120 }]);
    const write = nas.requests.find((r) => r.path === '/v/api/v1/play/setConfigByItem');
    assert.equal(write.headers.authorization, 'nas-token');
    assert.match(write.headers.cookie, /gateway=granted/);
});

test('POST skipinfo with a body that is not a JSON object of the right types is rejected with 400 before the query is checked', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));
    const bodies = ['', 'not json', '[]', '"item-1"', '{"guid":1}', '{"guid":"item-1","skipStart":"10"}', '{"guid":"item-1","skipStart":12.5}', '{"guid":"item-1","skipEnd":true}'];

    for (const query of [`?session=${session}`, '']) {
        for (const body of bodies) {
            const response = await post(service, `/api/v1/skipinfo${query}`, body);
            assert.equal(response.status, 400, `${query} ${body}`);
            assert.equal(response.body.toString(), '{"code":1000,"msg":"Invalid request body"}', `${query} ${body}`);
        }
    }
    assert.equal(nas.requests.length, 0);
});

test('POST skipinfo without a session or a guid is rejected with 400', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));
    const cases = [['', { guid: 'item-1' }], ['?session=', { guid: 'item-1' }], [`?session=${session}`, { skipStart: 1 }], [`?session=${session}`, 'null']];

    for (const [query, body] of cases) {
        const response = await post(service, `/api/v1/skipinfo${query}`, body);
        assert.equal(response.status, 400, `${query} ${JSON.stringify(body)}`);
        assert.equal(response.body.toString(), '{"code":1000,"msg":"Missing required parameters"}');
    }
    assert.equal(nas.requests.length, 0);
});

test('POST skipinfo writes missing or null skip points as 0 and ignores unknown fields', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1' });
    await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: null, skipEnd: 7, extra: { a: 1 } });

    assert.deepEqual(writes(nas), [
        { guid: 'season-1', skip_opening: 0, skip_ending: 0 },
        { guid: 'season-1', skip_opening: 0, skip_ending: 7 },
    ]);
});

test('POST skipinfo matches body keys case-insensitively like Go', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await post(service, `/api/v1/skipinfo?session=${session}`, { GUID: 'item-1', SkipStart: 3, skipend: 4 });

    assert.equal(response.status, 200);
    assert.deepEqual(writes(nas), [{ guid: 'season-1', skip_opening: 3, skip_ending: 4 }]);
});

test('POST skipinfo writes negative skip points to the NAS unchanged and answers 200', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: -5, skipEnd: -1 });

    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), '{"code":0,"msg":"success"}');
    assert.deepEqual(writes(nas), [{ guid: 'season-1', skip_opening: -5, skip_ending: -1 }]);
});

test('POST skipinfo checks the session against the guid in the body and rejects with 401', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1) });
    const session = service.createPlaybackSession(sessionInput(nas));
    const reject = async (query, body) => {
        const response = await post(service, `/api/v1/skipinfo${query}`, body);
        assert.equal(response.status, 401, `${query} ${JSON.stringify(body)}`);
        assert.equal(response.body.toString(), '{"code":1000,"msg":"Invalid playback session"}');
    };

    await reject(`?session=${'0'.repeat(64)}`, { guid: 'item-1' });
    await reject(`?session=${session}`, { guid: 'item-2' });
    t.mock.timers.tick(24 * 60 * 60 * 1000 + 1);
    await reject(`?session=${session}`, { guid: 'item-1' });
    assert.equal(nas.requests.length, 0);
});

test('POST skipinfo answers 500 when the play info cannot be read', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: {} });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: 1, skipEnd: 2 });

    assert.equal(response.status, 500);
    assert.equal(response.body.toString(), '{"code":1000,"msg":"Failed to get play info cache"}');
    assert.deepEqual(writes(nas), []);
});

test('POST skipinfo reuses the cached play info for later writes', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: 1, skipEnd: 2 });
    await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: 3, skipEnd: 4 });

    assert.equal(nas.requests.filter((r) => r.path === '/v/api/v1/play/info').length, 1);
    assert.equal(writes(nas).length, 2);
});

test('POST skipinfo answers 500 when the NAS rejects the write or cannot be reached', async (t) => {
    const rejecting = await startFakeFnMedia(t, { playInfo: PLAY_INFO, handlers: { setConfig: (req, res) => json(res, { code: 1, msg: 'denied', data: null }) } });
    const unreachable = await startFakeFnMedia(t, { playInfo: PLAY_INFO, handlers: { setConfig: (req) => req.socket.destroy() } });
    const { service } = await startProxy(t);

    for (const nas of [rejecting, unreachable]) {
        const session = service.createPlaybackSession(sessionInput(nas));
        const response = await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: 1, skipEnd: 2 });
        assert.equal(response.status, 500);
        assert.equal(response.body.toString(), '{"code":1000,"msg":"Failed to set skip info"}');
    }
    const attempts = unreachable.requests.filter((r) => r.path === '/v/api/v1/play/setConfigByItem').length;
    assert.equal(attempts, 6, 'a network error is retried up to 6 attempts');
});

test('POST skipinfo resends the write after a network error', async (t) => {
    let attempts = 0;
    const nas = await startFakeFnMedia(t, {
        playInfo: PLAY_INFO,
        handlers: { setConfig: (req, res) => (++attempts < 3 ? req.socket.destroy() : json(res, ok(null))) },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: 1, skipEnd: 2 });

    assert.equal(response.status, 200);
    assert.equal(writes(nas).length, 3);
});

test('POST skipinfo ignores skip fields in the query and a session in the body', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));
    const query = `?session=${session}&SkipStart=99&SkipEnd=98&Guid=item-2&skipStart=97`;

    const written = await post(service, `/api/v1/skipinfo${query}`, { guid: 'item-1', skipStart: 1, skipEnd: 2 });
    const bodySession = await post(service, '/api/v1/skipinfo', { guid: 'item-1', session });

    assert.equal(written.status, 200);
    assert.deepEqual(writes(nas), [{ guid: 'season-1', skip_opening: 1, skip_ending: 2 }]);
    assert.equal(bodySession.status, 400);
    assert.equal(bodySession.body.toString(), '{"code":1000,"msg":"Missing required parameters"}');
});

test('skipinfo logs never contain the playback session or the token', async (t) => {
    const nas = await startFakeFnMedia(t, { playInfo: PLAY_INFO });
    const { service, logs } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await post(service, `/api/v1/skipinfo?session=${session}`, { guid: 'item-1', skipStart: 1, skipEnd: 2 });
    await post(service, `/api/v1/skipinfo?session=${session}`, '{');
    await post(service, '/api/v1/skipinfo', { guid: 'item-1', session });

    assert.ok(logs.length > 0);
    const text = logs.join('\n');
    for (const secret of [session, 'nas-token', 'gateway=granted']) assert.ok(!text.includes(secret), secret);
});
