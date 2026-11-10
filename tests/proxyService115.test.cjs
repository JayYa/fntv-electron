const test = require('node:test');
const http = require('node:http');
const assert = require('node:assert/strict');
const { startFakeFnMedia } = require('./helpers/fakeFnMedia.cjs');
const { startFakeDirectLink, directLinkStream } = require('./helpers/fakeDirectLink.cjs');
const { MEDIA, startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');

const CLOUD_115 = 3;
const INTERVAL_MS = 200;

// 假 NAS 把 item-1、item-2 的播放源说成直链媒体，直链指向假网盘。
async function directLinkSetup(t, streamOptions = {}, driveOptions = {}) {
    const drive = await startFakeDirectLink(t, { media: MEDIA, ...driveOptions });
    const nas = await startFakeFnMedia(t, {
        media: { 'media-1': Buffer.from('nas bytes') },
        streams: { 'item-1': ['media-1'], 'item-2': ['media-2'] },
        handlers: { stream: directLinkStream({ urls: [`${drive.origin}/file.mkv`], cloudType: CLOUD_115, ...streamOptions }) },
    });
    return { drive, nas };
}

// 放行时刻从第一个请求起每隔一个间隔一次，第一个放行不早于 started，所以第 k 个请求到达网盘不早于 started + k 个间隔。
// 不直接比相邻两次到达的差：到达时刻比放行晚一次本机连接，差值会有几十毫秒的抖动。
function assertSpaced(requests, started) {
    requests.forEach((request, index) => {
        const offset = request.at - started;
        assert.ok(offset >= index * INTERVAL_MS, `request ${index} arrived after ${offset}ms`);
    });
}

test('115 cloud direct spaces consecutive requests by at least the rate limit interval', async (t) => {
    const { drive, nas } = await directLinkSetup(t);
    const { service } = await startProxy(t, { rateLimitIntervalMs: INTERVAL_MS });
    const session = service.createPlaybackSession(sessionInput(nas));

    const started = Date.now();
    for (const range of ['bytes=0-99', 'bytes=100-199', 'bytes=200-299']) {
        const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: range });
        assert.equal(response.status, 206);
    }

    assert.equal(drive.requests.length, 3);
    assertSpaced(drive.requests, started);
});

// 与 Go 的全局令牌桶一致（U-08）：不分会话、不分文件；第一个请求不等，并发请求依次排队。
test('the 115 rate limit is shared by all sessions and files and queues concurrent requests', async (t) => {
    const { drive, nas } = await directLinkSetup(t);
    const { service } = await startProxy(t, { rateLimitIntervalMs: INTERVAL_MS });
    const first = service.createPlaybackSession(sessionInput(nas, { itemGuids: ['item-1'] }));
    const second = service.createPlaybackSession(sessionInput(nas, { itemGuids: ['item-2'] }));
    // 先把流信息缓存好，让下面计时只包含限流等待。
    await get(service, `/api/v1/playvideo/item-1?session=${first}`);
    await get(service, `/api/v1/playvideo/item-2?session=${second}`);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 2));
    drive.requests.length = 0;

    const started = Date.now();
    const responses = await Promise.all([
        get(service, `/api/v1/playvideo/item-1?session=${first}`),
        get(service, `/api/v1/playvideo/item-2?session=${second}`),
        get(service, `/api/v1/playvideo/item-1?session=${first}`),
    ]);

    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
    assert.equal(drive.requests.length, 3);
    assert.ok(drive.requests[0].at - started < INTERVAL_MS / 2, `first waited ${drive.requests[0].at - started}ms`);
    assertSpaced(drive.requests, started);
});

// G-162-10 的通用规则用在 115 上（G-163-01）。
test('115 cloud direct sends the stream user agent instead of the MPV one', async (t) => {
    const { drive, nas } = await directLinkSetup(t, { userAgents: [' ', '115-ua/2.0'] });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, { 'User-Agent': 'mpv 0.40' });

    assert.equal(drive.requests[0].headers['user-agent'], '115-ua/2.0');
});

// 只有 115 直连限流；其他网盘、夸克和 NAS 中转的 115 都不限流（G-163-05）。
test('other cloud types and NAS relay of 115 are not rate limited', async (t) => {
    const cases = [
        [{ cloudType: 1 }, {}],
        [{ cloudType: 4 }, {}],
        [{ cloudType: 9001 }, {}],
        [{}, { useNasLocal: true }],
    ];
    for (const [streamOptions, sessionOverrides] of cases) {
        const { drive, nas } = await directLinkSetup(t, streamOptions);
        const { service } = await startProxy(t, { rateLimitIntervalMs: 10 * 1000 });
        const session = service.createPlaybackSession(sessionInput(nas, sessionOverrides));

        const started = Date.now();
        for (let index = 0; index < 3; index += 1) {
            await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });
        }

        const label = JSON.stringify([streamOptions, sessionOverrides]);
        assert.ok(Date.now() - started < 5 * 1000, label);
        assert.equal(drive.requests.length + nas.mediaRequests().length, 3, label);
    }
});

// 每个 MPV 请求只等一次，416 + bytes=0- 的重试不再等（G-163-03）。
test('the 115 retry without Range after a 416 does not wait for the rate limit again', async (t) => {
    const { drive, nas } = await directLinkSetup(t, {}, {
        handler: (req, res) => {
            if (req.headers.range === 'bytes=0-') {
                res.statusCode = 416;
                return res.end();
            }
            res.end(MEDIA);
        },
    });
    const { service } = await startProxy(t, { rateLimitIntervalMs: 10 * 1000 });
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, MEDIA);
    assert.deepEqual(drive.requests.map((r) => r.headers.range), ['bytes=0-', undefined]);
});

// 与 Go 一致（U-19、G-163-04）：等待中的 MPV 断开后，占下的放行时刻不归还，后面的请求照样排在它之后；
// 等完时请求已取消，不再发给网盘。
test('an MPV request dropped while waiting for the 115 rate limit keeps its slot and never reaches the drive', async (t) => {
    const { drive, nas } = await directLinkSetup(t);
    const { service } = await startProxy(t, { rateLimitIntervalMs: INTERVAL_MS });
    const session = service.createPlaybackSession(sessionInput(nas));
    await get(service, `/api/v1/playvideo/item-1?session=${session}`);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 2));
    drive.requests.length = 0;

    const started = Date.now();
    const first = get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });
    const dropped = http.request({ host: '127.0.0.1', port: service.port, path: `/api/v1/playvideo/item-1?session=${session}` });
    dropped.on('error', () => {});
    dropped.end();
    setTimeout(() => dropped.destroy(), INTERVAL_MS / 2);
    const third = get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=10-19' });
    await Promise.all([first, third]);
    // 等被丢下的那个请求的放行时刻过去，确认它没有发到网盘。
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));

    assert.deepEqual(drive.requests.map((r) => r.headers.range), ['bytes=0-9', 'bytes=10-19']);
    assert.ok(drive.requests[1].at - started >= 2 * INTERVAL_MS, `third arrived after ${drive.requests[1].at - started}ms`);
});
