const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

const SESSION = 'a'.repeat(64);

const CONNECTION = {
    baseUrl: 'https://nas.example:5666',
    token: 'token-1',
    account: 'alice',
    accessCookie: 'access=grant',
    trustedHost: true,
};

class FakeChild extends EventEmitter {
    constructor() {
        super();
        this.sent = [];
        this.killed = false;
        this.stdout = null;
        this.stderr = null;
    }

    postMessage(message) {
        this.sent.push(message);
    }

    kill() {
        this.killed = true;
        return true;
    }

    reply(message) {
        this.emit('message', message);
    }

    ready(port) {
        this.reply({ type: 'ready', port });
    }

    exit(code) {
        this.emit('exit', code);
    }

    answerSession(session = SESSION) {
        const request = this.sent.at(-1);
        this.reply({ type: 'playbackSession', id: request.id, session });
        return request;
    }
}

function setup(t, { nasLocalProxy = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-proxy-process-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    useFakeElectron(t, {
        app: {
            isPackaged: false,
            getAppPath: () => root,
            getPath: () => root,
            setPath() {},
            commandLine: { getSwitchValue: () => '' },
        },
        utilityProcess: {},
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { createProxy } = require('../dest/main/common/proxy.js');
    const children = [];
    const unrecoverable = [];
    const proxy = createProxy({
        fork() {
            const child = new FakeChild();
            children.push(child);
            return child;
        },
        useNasLocal: () => nasLocalProxy,
    });
    const start = () => proxy.start({ onUnrecoverable: (error) => unrecoverable.push(error) });
    return { proxy, children, unrecoverable, start, latest: () => children.at(-1) };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

async function tick(t, ms) {
    t.mock.timers.tick(ms);
    await settle();
}

async function startedOn(t, port, options) {
    const world = setup(t, options);
    const starting = world.start();
    world.latest().ready(port);
    await starting;
    return world;
}

async function crashAndFailRestarts(t, world, failures) {
    for (let i = 0; i < failures; i++) {
        await tick(t, 3000);
        world.latest().exit(1);
        await settle();
    }
}

async function openSession(world, itemGuids = ['item-1']) {
    const opening = world.proxy.openPlaybackSession(CONNECTION, itemGuids);
    await Promise.resolve();
    const request = world.latest().answerSession();
    return { urlFor: await opening, request };
}

test('a playback session opened for the current login gives MPV URLs on the port the Proxy reported', async (t) => {
    const world = await startedOn(t, 41234, { nasLocalProxy: true });

    const { urlFor, request } = await openSession(world, ['item-1', 'item-2']);

    assert.deepEqual(request.input, {
        token: 'token-1',
        account: 'alice',
        domain: 'https://nas.example:5666',
        accessCookie: 'access=grant',
        skipVerify: true,
        useNasLocal: true,
        itemGuids: ['item-1', 'item-2'],
    });
    assert.equal(urlFor('item/2', 2), `http://127.0.0.1:41234/api/v1/playvideo/item%2F2?session=${SESSION}&sourceIndex=2`);
    assert.equal(urlFor('item-1', 0), `http://127.0.0.1:41234/api/v1/playvideo/item-1?session=${SESSION}`);
    assert.doesNotMatch(urlFor('item-1'), /token=|account=|domain=|accessCode=|accessCookie=/);
});

test('start fails when the Proxy exits before it is ready', async (t) => {
    const world = setup(t);
    const starting = world.start();
    world.latest().exit(1);

    await assert.rejects(starting, /就绪前退出 \(code=1\)/);
});

test('start fails and the Proxy is ended when it reports that it could not listen', async (t) => {
    const world = setup(t);
    const starting = world.start();
    world.latest().reply({ type: 'startFailed', code: 'EACCES', message: 'listen denied' });

    await assert.rejects(starting, /Proxy 启动失败: EACCES listen denied/);
    assert.equal(world.latest().killed, true);
});

test('start fails and the Proxy is ended when it is not ready within 10 seconds', async (t) => {
    const world = setup(t);
    const starting = world.start();
    const rejected = assert.rejects(starting, /10 秒内没有就绪/);

    await tick(t, 9999);
    assert.equal(world.latest().killed, false);
    await tick(t, 1);

    await rejected;
    assert.equal(world.latest().killed, true);
});

test('a Proxy that crashes is restarted after 3 seconds, and sessions come from the new one', async (t) => {
    const world = await startedOn(t, 41234);
    const pending = world.proxy.openPlaybackSession(CONNECTION, ['item-1']);
    await Promise.resolve();

    world.latest().exit(1);
    await assert.rejects(pending, /Proxy 已退出 \(code=1\)/);
    await assert.rejects(world.proxy.openPlaybackSession(CONNECTION, ['item-1']), /Proxy 未运行/);

    await tick(t, 2999);
    assert.equal(world.children.length, 1);
    await tick(t, 1);
    assert.equal(world.children.length, 2);
    world.latest().ready(50000);
    await settle();

    const { urlFor } = await openSession(world);
    assert.match(urlFor('item-1'), /^http:\/\/127\.0\.0\.1:50000\//);
    assert.deepEqual(world.unrecoverable, []);
});

test('after 5 failed restarts the Proxy is reported unrecoverable once and not restarted again', async (t) => {
    const world = await startedOn(t, 41234);
    world.latest().exit(1);
    await settle();

    await crashAndFailRestarts(t, world, 5);
    await tick(t, 60000);

    assert.equal(world.children.length, 6);
    assert.equal(world.unrecoverable.length, 1);
    assert.match(world.unrecoverable[0].message, /重启 5 次都失败/);
});

test('restart attempts are counted again from zero once the Proxy has run for 60 seconds', async (t) => {
    const world = await startedOn(t, 41234);
    world.latest().exit(1);
    await settle();
    await crashAndFailRestarts(t, world, 4);
    await tick(t, 3000);
    world.latest().ready(41235);
    await settle();

    await tick(t, 60000);
    world.latest().exit(1);
    await settle();
    await tick(t, 3000);

    assert.equal(world.children.length, 7);
    assert.deepEqual(world.unrecoverable, []);
});

test('a Proxy that crashes again within 60 seconds of its last restart has no attempts left', async (t) => {
    const world = await startedOn(t, 41234);
    world.latest().exit(1);
    await settle();
    await crashAndFailRestarts(t, world, 4);
    await tick(t, 3000);
    world.latest().ready(41235);
    await settle();

    await tick(t, 59999);
    world.latest().exit(1);
    await settle();

    assert.equal(world.children.length, 6);
    assert.equal(world.unrecoverable.length, 1);
});

test('shutdown ends the Proxy and does not restart it', async (t) => {
    const world = await startedOn(t, 41234);

    let done = false;
    const stopping = world.proxy.shutdown().then(() => { done = true; });
    assert.equal(world.latest().killed, true);
    world.latest().exit(0);
    await stopping;
    await tick(t, 60000);

    assert.equal(done, true);
    assert.equal(world.children.length, 1);
    assert.deepEqual(world.unrecoverable, []);
});

test('shutdown waits at most 5 seconds for the Proxy to exit', async (t) => {
    const world = await startedOn(t, 41234);

    let done = false;
    const stopping = world.proxy.shutdown().then(() => { done = true; });
    await tick(t, 4999);
    assert.equal(done, false);
    await tick(t, 1);

    await stopping;
    assert.equal(done, true);
});

test('shutdown while waiting to restart a crashed Proxy cancels the restart', async (t) => {
    const world = await startedOn(t, 41234);
    world.latest().exit(1);
    await settle();

    await world.proxy.shutdown();
    await tick(t, 60000);

    assert.equal(world.children.length, 1);
    assert.deepEqual(world.unrecoverable, []);
});
