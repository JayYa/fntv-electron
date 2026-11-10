const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFakeFnMedia } = require('./helpers/fakeFnMedia.cjs');
const { startFakeDirectLink, directLinkStream } = require('./helpers/fakeDirectLink.cjs');
const { MEDIA, startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');

const TLS_DIR = path.join(__dirname, 'fixtures', 'tls');

// 假 NAS 把 item-1 的播放源说成直链媒体，直链指向假网盘。
async function directLinkSetup(t, streamOptions = {}, driveOptions = {}) {
    const drive = await startFakeDirectLink(t, { media: MEDIA, ...driveOptions });
    const nas = await startFakeFnMedia(t, {
        media: { 'media-1': Buffer.from('nas bytes') },
        streams: { 'item-1': ['media-1'] },
        handlers: { stream: directLinkStream({ urls: [`${drive.origin}/file.mkv?sign=secret-token`], ...streamOptions }) },
    });
    return { drive, nas };
}

test('cloud direct fetches the direct link itself with Range and without the NAS Authorization', async (t) => {
    const { drive, nas } = await directLinkSetup(t);
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=100-199' });

    assert.equal(response.status, 206);
    assert.equal(response.headers['content-range'], `bytes 100-199/${MEDIA.length}`);
    assert.deepEqual(response.body, MEDIA.subarray(100, 200));
    assert.equal(nas.mediaRequests().length, 0);
    const [upstream] = drive.requests;
    assert.equal(upstream.path, '/file.mkv');
    assert.equal(upstream.search, '?sign=secret-token');
    assert.equal(upstream.headers.range, 'bytes=100-199');
    assert.equal(upstream.headers.authorization, undefined);
    assert.equal(upstream.headers.cookie, undefined);
    assert.equal(upstream.headers.host, new URL(drive.origin).host);
});

// Go 的 TestApplyPlaybackCookieKeepsNasGrantOutOfCloudDirect，改为走 HTTP。
test('cloud direct sends the direct link cookies joined, without the access grant or mode=relay', async (t) => {
    const { drive, nas } = await directLinkSetup(t, { cookies: ['provider=cloud', 'sid=1', 'provider=cloud'] });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Cookie: 'mpv-cookie=1' });

    assert.equal(drive.requests[0].headers.cookie, 'provider=cloud; sid=1; provider=cloud');
});

// Go 的 TestApplyPlaybackCookieClearsCookiesWhenCloudProvidesNone；Go 仍会转发 MPV 的 Cookie 和 Authorization，这里不照搬（U-05）。
test('cloud direct without direct link cookies sends no cookie and no authorization from MPV', async (t) => {
    const { drive, nas } = await directLinkSetup(t, { cookies: [] });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, {
        'User-Agent': 'mpv 0.40',
        'If-None-Match': '"v1"',
        Cookie: 'mpv-cookie=1',
        Authorization: 'Bearer from-mpv',
        'X-Custom': 'leak',
    });

    const { headers } = drive.requests[0];
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
    assert.equal(headers['x-custom'], undefined);
    assert.equal(headers['user-agent'], 'mpv 0.40');
    assert.equal(headers['if-none-match'], '"v1"');
});

// 流信息的 UA 对所有直连网盘生效，不只 115（U-09，照搬 Go）。
test('cloud direct uses the first non-blank stream user agent for any cloud type, else keeps the MPV one', async (t) => {
    const cases = [
        [{ cloudType: 1, userAgents: ['  ', ' pan-ua/1.0 ', 'second'] }, 'pan-ua/1.0'],
        [{ cloudType: 9001, userAgents: ['strm-ua'] }, 'strm-ua'],
        [{ cloudType: 2, userAgents: [' '] }, 'mpv 0.40'],
        [{ cloudType: 5, userAgents: [] }, 'mpv 0.40'],
    ];
    for (const [streamOptions, expected] of cases) {
        const { drive, nas } = await directLinkSetup(t, streamOptions);
        const { service } = await startProxy(t);
        const session = service.createPlaybackSession(sessionInput(nas));

        await get(service, `/api/v1/playvideo/item-1?session=${session}`, { 'User-Agent': 'mpv 0.40' });

        assert.equal(drive.requests[0].headers['user-agent'], expected, JSON.stringify(streamOptions));
    }
});

// 测试 CA 不在 Node 自带和系统的证书库里；会话的 skipVerify 只对 NAS 生效。
test('cloud direct verifies the direct link certificate even when the session skips verification', async (t) => {
    const tls = { key: fs.readFileSync(path.join(TLS_DIR, 'nas-key.pem')), cert: fs.readFileSync(path.join(TLS_DIR, 'nas.pem')) };
    const { drive, nas } = await directLinkSetup(t, {}, { tls });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas, { skipVerify: true }));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`);

    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body.toString()).error, 'Proxy error');
    assert.equal(drive.requests.length, 0);
});

// Go 的 TestApplyPlaybackCookieUsesNasGrantForLocalMedia，改为走 HTTP。
test('NAS relay sends direct link media through the NAS with the token and the access grant only', async (t) => {
    const { drive, nas } = await directLinkSetup(t, { cloudType: 3, cookies: ['provider=cloud'], userAgents: ['pan-ua/1.0'] });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas, { useNasLocal: true }));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, {
        'User-Agent': 'mpv 0.40',
        Cookie: 'from-player=value',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), 'nas bytes');
    assert.equal(drive.requests.length, 0);
    const [upstream] = nas.mediaRequests();
    assert.equal(upstream.path, '/v/api/v1/media/range/media-1');
    assert.equal(upstream.headers.authorization, 'nas-token');
    assert.equal(upstream.headers.cookie, 'gateway=granted; mode=relay');
    assert.equal(upstream.headers['user-agent'], 'mpv 0.40');
});

test('a stream without cloud storage info or without direct links is fetched from the NAS', async (t) => {
    for (const streamOptions of [{ cloudType: null }, { urls: [] }]) {
        const { drive, nas } = await directLinkSetup(t, streamOptions);
        const { service } = await startProxy(t);
        const session = service.createPlaybackSession(sessionInput(nas));

        const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`);

        assert.equal(response.body.toString(), 'nas bytes', JSON.stringify(streamOptions));
        assert.equal(drive.requests.length, 0);
        assert.equal(nas.mediaRequests()[0].headers.authorization, 'nas-token');
    }
});

test('cloud direct always uses the first direct link, whatever the sourceIndex', async (t) => {
    const drive = await startFakeDirectLink(t, { media: MEDIA });
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-0', 'media-1'] },
        handlers: { stream: directLinkStream({ urls: [`${drive.origin}/first.mkv`, `${drive.origin}/second.mkv`] }) },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}&sourceIndex=1`);

    assert.deepEqual(drive.requests.map((r) => r.path), ['/first.mkv']);
    assert.equal(JSON.parse(nas.requests.find((r) => r.path === '/v/api/v1/stream').body).media_guid, 'media-1');
});

// WebDAV 这类直链把账号写在 URL 里。MPV 的 Authorization 不转发（U-05），所以总是补 Basic 认证。
test('cloud direct turns userinfo in the direct link into Basic authorization', async (t) => {
    const drive = await startFakeDirectLink(t, { media: MEDIA });
    const { host } = new URL(drive.origin);
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { stream: directLinkStream({ urls: [`http://dav%40user:p%3Ass@${host}/dav/file.mkv`] }) },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Authorization: 'Bearer from-mpv' });

    assert.equal(response.status, 200);
    const [upstream] = drive.requests;
    assert.equal(upstream.headers.authorization, `Basic ${Buffer.from('dav@user:p:ss').toString('base64')}`);
    assert.equal(upstream.headers.host, host);
    assert.equal(upstream.rawPath, '/dav/file.mkv');
});

// Go 的 details 是错误串，带完整直链和签名；这里不照搬（U-10）。
test('a network error on the direct link is not retried and the error details do not contain the direct link', async (t) => {
    const { drive, nas } = await directLinkSetup(t, {}, { handler: (req) => req.socket.destroy() });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-' });

    assert.equal(response.status, 500);
    const text = response.body.toString();
    assert.equal(JSON.parse(text).error, 'Proxy error');
    for (const fragment of ['127.0.0.1', new URL(drive.origin).port, 'file.mkv', 'secret-token']) {
        assert.ok(!text.includes(fragment), text);
    }
    assert.equal(drive.requests.length, 1);
});

test('a direct link that is not a valid URL gets the Go invalid target response', async (t) => {
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { stream: directLinkStream({ urls: ['not a url ?sign=secret-token'] }) },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`);

    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Invalid target URL' });
});

test('a 416 from the direct link for bytes=0- is retried once without Range', async (t) => {
    const { drive, nas } = await directLinkSetup(t, { cookies: ['provider=cloud'] }, {
        handler: (req, res) => {
            if (req.headers.range === 'bytes=0-') {
                res.statusCode = 416;
                return res.end();
            }
            res.end(MEDIA);
        },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, MEDIA);
    assert.deepEqual(drive.requests.map((r) => r.headers.range), ['bytes=0-', undefined]);
    assert.equal(drive.requests[1].headers.cookie, 'provider=cloud');
});

// Go 把解码后的 path 重新编码，%2F 会变成 /（U-15）。签名直链要原样，这里不照搬。
test('cloud direct keeps the encoded path and the query of the direct link as they are', async (t) => {
    const drive = await startFakeDirectLink(t, { media: MEDIA });
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { stream: directLinkStream({ urls: [`${drive.origin}/a%2Fb%2Bc/%E4%BD%A0.mkv?x=1%2B2&sig=a%2Fb`] }) },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}&sourceIndex=0`);

    assert.equal(drive.requests[0].rawPath, '/a%2Fb%2Bc/%E4%BD%A0.mkv?x=1%2B2&sig=a%2Fb');
});

test('cloud direct logs the cloud type without the direct link query, cookies or session', async (t) => {
    const { nas } = await directLinkSetup(t, { cloudType: 2, cookies: ['provider=cloud'], userAgents: ['pan-ua/1.0'] });
    const { service, logs } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });

    assert.ok(logs.some((line) => line === 'info 启用云存储直连: type=2'), logs.join('\n'));
    const text = logs.join('\n');
    for (const secret of ['secret-token', 'provider=cloud', session, 'nas-token', 'gateway=granted']) {
        assert.ok(!text.includes(secret), text);
    }
});
