// 主进程经 IPC 让 Proxy 创建播放会话。utilityProcess 的通道换成直接调用，两端都用编译产物。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startFakeFnMedia } = require('./helpers/fakeFnMedia.cjs');
const { SERVICE_DIR, MEDIA, startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');

const { handleControlRequest } = require(path.join(SERVICE_DIR, 'control.js'));
const { ProxyControlClient } = require('../dest/main/common/proxySession.js');

// 主进程发出的消息交给 Proxy 子进程的处理函数，回复异步送回主进程，和 IPC 一样经过结构化克隆。
function connect(service) {
    const sent = [];
    const client = new ProxyControlClient((message) => {
        sent.push(message);
        const reply = handleControlRequest(service, structuredClone(message));
        setImmediate(() => client.receive(structuredClone(reply)));
    });
    return { client, sent };
}

test('a playback session created over IPC lets MPV fetch only the listed items', async (t) => {
    const nas = await startFakeFnMedia(t, { media: { 'media-1': MEDIA }, streams: { 'item-1': ['media-1'], 'item-2': ['media-1'] } });
    const { service } = await startProxy(t);
    const { client } = connect(service);

    const session = await client.createPlaybackSession(sessionInput(nas));

    assert.match(session, /^[0-9a-f]{64}$/);
    const allowed = await get(service, `/api/v1/playvideo/item-1?session=${session}`);
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body, MEDIA);
    const rejected = await get(service, `/api/v1/playvideo/item-2?session=${session}`);
    assert.equal(rejected.status, 401);
});

test('the main process sends the playback session fields unchanged', async (t) => {
    const nas = await startFakeFnMedia(t);
    const { service } = await startProxy(t);
    const { client, sent } = connect(service);
    const input = sessionInput(nas, { skipVerify: true, useNasLocal: true, itemGuids: ['item-1', 'item-2'] });

    await client.createPlaybackSession(input);

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].input, {
        token: 'nas-token',
        account: 'alice',
        domain: nas.domain,
        accessCookie: 'gateway=granted; mode=web',
        skipVerify: true,
        useNasLocal: true,
        itemGuids: ['item-1', 'item-2'],
    });
});

test('invalid session input is rejected with the Proxy error message', async (t) => {
    const nas = await startFakeFnMedia(t);
    const { service } = await startProxy(t);
    const { client } = connect(service);

    await assert.rejects(client.createPlaybackSession(sessionInput(nas, { itemGuids: [] })), /missing required session parameters/);
});

test('a session request still waiting when the Proxy exits is rejected', async () => {
    const client = new ProxyControlClient(() => {});
    const pending = client.createPlaybackSession({ token: 't', account: 'a', domain: 'http://nas', skipVerify: false, useNasLocal: false, itemGuids: ['i'] });

    client.close(new Error('Proxy 已退出'));

    await assert.rejects(pending, /Proxy 已退出/);
});

test('a session request the Proxy never answers times out', async () => {
    const client = new ProxyControlClient(() => {});
    const input = { token: 't', account: 'a', domain: 'http://nas', skipVerify: false, useNasLocal: false, itemGuids: ['i'] };

    await assert.rejects(client.createPlaybackSession(input, 20), /超时/);
});
