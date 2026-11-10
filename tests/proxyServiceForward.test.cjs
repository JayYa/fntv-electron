const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startFakeFnMedia } = require('./helpers/fakeFnMedia.cjs');
const { MEDIA, startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');

test('playvideo passes the MPV Range through to the NAS and returns the partial content', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=100-199' });

    assert.equal(response.status, 206);
    assert.equal(response.headers['content-range'], `bytes 100-199/${MEDIA.length}`);
    assert.deepEqual(response.body, MEDIA.subarray(100, 200));
    assert.equal(nas.mediaRequests()[0].headers.range, 'bytes=100-199');
});

test('a 416 for the initial open range bytes=0- is retried once without Range and If-Range', async (t) => {
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: {
            media: (req, res) => {
                if (req.headers.range === 'bytes=0-') {
                    res.statusCode = 416;
                    return res.end();
                }
                res.setHeader('Content-Type', 'video/mp4');
                res.end(MEDIA);
            },
        },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-', 'If-Range': '"etag-1"' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, MEDIA);
    const media = nas.mediaRequests();
    assert.equal(media.length, 2);
    assert.equal(media[0].headers.range, 'bytes=0-');
    assert.equal(media[1].headers.range, undefined);
    assert.equal(media[1].headers['if-range'], undefined);
    assert.equal(media[1].headers.authorization, 'nas-token');
});

test('a 416 for any other range is returned to MPV without a retry', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: `bytes=${MEDIA.length}-` });

    assert.equal(response.status, 416);
    assert.equal(response.headers['content-range'], `bytes */${MEDIA.length}`);
    assert.equal(nas.mediaRequests().length, 1);
});

test('a 5xx from the NAS is returned to MPV without a retry', async (t) => {
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { media: (req, res) => { res.statusCode = 503; res.end('busy'); } },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-' });

    assert.equal(response.status, 503);
    assert.equal(response.body.toString(), 'busy');
    assert.equal(nas.mediaRequests().length, 1);
});

test('a network error is not retried and the error details do not contain the upstream URL', async (t) => {
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { media: (req) => req.socket.destroy() },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-' });

    assert.equal(response.status, 500);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    const text = response.body.toString();
    assert.equal(JSON.parse(text).error, 'Proxy error');
    assert.ok(!text.includes('127.0.0.1') && !text.includes('media/range') && !text.includes('media-1'), text);
    assert.equal(nas.mediaRequests().length, 1);
});

test('only whitelisted MPV request headers reach the NAS', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, {
        'User-Agent': 'mpv 0.40',
        'Accept-Encoding': 'gzip',
        'Cache-Control': 'no-cache',
        Cookie: 'mpv-cookie=1',
        Authorization: 'Bearer from-mpv',
        'X-Custom': 'leak',
    });

    const [upstream] = nas.mediaRequests();
    assert.equal(upstream.headers['user-agent'], 'mpv 0.40');
    assert.equal(upstream.headers['accept-encoding'], 'gzip');
    assert.equal(upstream.headers['cache-control'], 'no-cache');
    assert.equal(upstream.headers.cookie, 'gateway=granted; mode=relay');
    assert.equal(upstream.headers.authorization, 'nas-token');
    assert.equal(upstream.headers['x-custom'], undefined);
    assert.equal(upstream.headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(upstream.search, '');
});

test('hop-by-hop response headers from the NAS are not returned to MPV', async (t) => {
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: {
            media: (req, res) => {
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Connection', 'X-Hop');
                res.setHeader('X-Hop', 'drop me');
                res.setHeader('Keep-Alive', 'timeout=99');
                res.setHeader('X-Media', 'keep me');
                res.end(MEDIA);
            },
        },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`);

    assert.equal(response.headers['x-media'], 'keep me');
    assert.equal(response.headers['x-hop'], undefined);
    assert.notEqual(response.headers['keep-alive'], 'timeout=99');
    assert.deepEqual(response.body, MEDIA);
});

test('a large stream is forwarded byte for byte', async (t) => {
    const big = Buffer.alloc(8 * 1024 * 1024);
    for (let index = 0; index < big.length; index += 4096) big[index] = index % 256;
    const nas = await startFakeFnMedia(t, { media: { 'media-1': big }, streams: { 'item-1': ['media-1'] } });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`);

    assert.equal(response.status, 200);
    assert.ok(response.body.equals(big));
});

test('the NAS request is cancelled when MPV disconnects mid-stream', async (t) => {
    let upstreamClosed;
    const closed = new Promise((resolve) => { upstreamClosed = resolve; });
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: {
            media: (req, res) => {
                res.on('close', upstreamClosed);
                res.writeHead(200, { 'Content-Type': 'video/mp4' });
                res.write(MEDIA);
            },
        },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await new Promise((resolve) => {
        const request = http.get({ host: '127.0.0.1', port: service.port, path: `/api/v1/playvideo/item-1?session=${session}` }, (response) => {
            response.once('data', () => {
                request.destroy();
                resolve();
            });
        });
        request.on('error', () => {});
    });

    await closed;
});
