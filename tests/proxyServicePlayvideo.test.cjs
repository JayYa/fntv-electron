const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeFnMedia } = require('./helpers/fakeFnMedia.cjs');
const { MEDIA, startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');

test('playvideo forwards the NAS media stream with the token and the access grant', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'video/mp4');
    assert.equal(response.headers['content-length'], String(MEDIA.length));
    assert.deepEqual(response.body, MEDIA);
    const [upstream] = nas.mediaRequests();
    assert.equal(upstream.path, '/v/api/v1/media/range/media-1');
    assert.equal(upstream.search, '');
    assert.equal(upstream.headers.authorization, 'nas-token');
    assert.equal(upstream.headers.cookie, 'gateway=granted; mode=relay');
});

test('sourceIndex selects the media source and falls back to the first one when out of range', async (t) => {
    const nas = await startFakeFnMedia(t, {
        media: { 'media-0': Buffer.from('zero'), 'media-1': Buffer.from('one') },
        streams: { 'item-1': ['media-0', 'media-1'] },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const bodies = {};
    for (const index of ['1', '2', '-1', '0', '']) {
        bodies[index] = (await get(service, `/api/v1/playvideo/item-1?session=${session}&sourceIndex=${index}`)).body.toString();
    }

    assert.deepEqual(bodies, { 1: 'one', 2: 'zero', '-1': 'zero', 0: 'zero', '': 'zero' });
});

test('stream list and stream failures return the Go error responses', async (t) => {
    const reply = (body) => (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    };
    const cases = [
        [{ streamList: reply({ code: 1, msg: 'nope', data: null }) }, 'Failed to get play info'],
        [{ streamList: reply({ code: 0, msg: '', data: { video_streams: [] } }) }, 'Failed to get play info'],
        [{ stream: reply({ code: 1, msg: 'nope', data: null }) }, 'Failed to get stream'],
    ];
    for (const [handlers, error] of cases) {
        const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] }, handlers });
        const { service } = await startProxy(t);
        const session = service.createPlaybackSession(sessionInput(nas));

        const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`);

        assert.equal(response.status, 500);
        assert.deepEqual(JSON.parse(response.body.toString()), { error });
        assert.equal(nas.mediaRequests().length, 0);
    }
});

test('the NAS calls carry the token and the access grant and ask for the stream of the account', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas, { domain: `${nas.domain}//` }));

    assert.equal((await get(service, `/api/v1/playvideo/item-1?session=${session}`)).status, 200);

    const list = nas.requests.find((r) => r.path === '/v/api/v1/stream/list/item-1');
    const stream = nas.requests.find((r) => r.path === '/v/api/v1/stream');
    for (const call of [list, stream]) {
        assert.equal(call.headers.authorization, 'nas-token');
        assert.equal(call.headers.cookie, 'gateway=granted; mode=relay');
        assert.match(call.headers.authx, /^nonce=\d{6}&timestamp=\d+&sign=[a-f0-9]{32}$/);
    }
    const body = JSON.parse(stream.body);
    assert.deepEqual(
        { header: body.header, level: body.level, media_guid: body.media_guid, ip: body.ip },
        { header: { 'User-Agent': ['trim_player'] }, level: 1, media_guid: 'media-1', ip: '522b276a-356b-df39-013d-fabea2cd43e1' },
    );
});

test('stream lookups on the same NAS and token are shared across sessions', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const first = service.createPlaybackSession(sessionInput(nas));
    const second = service.createPlaybackSession(sessionInput(nas));

    assert.equal((await get(service, `/api/v1/playvideo/item-1?session=${first}`)).status, 200);
    assert.equal((await get(service, `/api/v1/playvideo/item-1?session=${second}`)).status, 200);

    const paths = nas.requests.map((r) => r.path);
    assert.equal(paths.filter((p) => p === '/v/api/v1/stream/list/item-1').length, 1);
    assert.equal(paths.filter((p) => p === '/v/api/v1/stream').length, 1);
    assert.equal(nas.mediaRequests().length, 2);
});
