const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { useFakeModule } = require('./helpers/fakeElectron.cjs');

const NODE_MPV_DIR = path.dirname(require.resolve('node-mpv-2/package.json'));
const PLAYERS_DIR = path.join(__dirname, '..', 'dest', 'modules', 'players');

async function waitUntil(condition) {
    for (let i = 0; i < 100 && !condition(); i++) await delay(10);
}

function forgetNodeMpv() {
    Object.keys(require.cache)
        .filter((id) => id.startsWith(NODE_MPV_DIR) || id.startsWith(PLAYERS_DIR))
        .forEach((id) => delete require.cache[id]);
}

function serveMpvIpc(t, child, answer = () => 'success') {
    const { socketPath } = child;
    const connections = [];
    const server = net.createServer((conn) => {
        connections.push(conn);
        let pending = '';
        conn.on('error', () => {});
        conn.on('data', (data) => {
            const lines = (pending + data.toString('utf8')).split('\n');
            pending = lines.pop();
            for (const line of lines.filter(Boolean)) {
                const { request_id, command } = JSON.parse(line);
                const error = answer(command);
                if (error === undefined) continue;
                conn.write(`${JSON.stringify({ request_id, error, data: null })}\n`);
                if (command[0] === 'quit' && error === 'success') setImmediate(() => exit(child, 0, null));
            }
        });
    });
    child.sendEvent = (event) => connections.forEach((conn) => conn.write(`${JSON.stringify(event)}\n`));
    t.after(async () => {
        for (const conn of connections) conn.destroy();
        await new Promise((resolve) => server.close(resolve));
        if (!socketPath.startsWith('\\\\')) fs.rmSync(socketPath, { force: true });
    });
    server.listen(socketPath);
    return once(server, 'listening');
}

function listenOnIpc(t, child, answer) {
    void serveMpvIpc(t, child, answer).then(() => child.stdout.emit('data', Buffer.from('Listening to IPC socket')));
}

function hasExited(child) {
    return child.exitCode !== null || child.signalCode !== null;
}

function isSocketFileLeft(child) {
    return !child.socketPath.startsWith('\\') && fs.existsSync(child.socketPath);
}

function exit(child, code, signal) {
    if (hasExited(child)) return;
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
    child.emit('close', code, signal);
}

function useFakeChildProcess(t, startUp = listenOnIpc) {
    const spawned = [];
    const childProcess = {
        exec(_command, _options, callback) {
            setImmediate(() => callback(null, 'mpv 0.40.0', ''));
        },
        spawn(_binary, args) {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.socketPath = args.find((arg) => arg.startsWith('--input-ipc-server=')).split('=')[1];
            child.exitCode = null;
            child.signalCode = null;
            child.killed = false;
            child.kill = () => {
                child.killed = true;
                setImmediate(() => exit(child, null, 'SIGTERM'));
                return true;
            };
            setImmediate(() => startUp(t, child));
            spawned.push(child);
            return child;
        },
    };
    forgetNodeMpv();
    useFakeModule(t, 'child_process', childProcess);
    t.after(forgetNodeMpv);
    return spawned;
}

function newMpvProcess(t, spawned) {
    const { mpvProcessFactory } = require('../dest/modules/players/index.js');
    const reported = [];
    const mpv = mpvProcessFactory({ binary: '', args: [], debug: false })({
        onProperty: (property, value) => reported.push(['property', property, value]),
        onTimePosition: (seconds) => reported.push(['timeposition', seconds]),
        onSeek: (seconds) => reported.push(['seek', seconds]),
        onExit: (code) => reported.push(['exit', code, { socketFileLeft: isSocketFileLeft(spawned[0]) }]),
    });
    t.after(() => mpv.stop());
    return { mpv, reported };
}

function startWithin(mpv, ms = 3000) {
    return Promise.race([
        mpv.start().then(() => 'started', () => 'rejected'),
        delay(ms).then(() => 'still starting'),
    ]);
}

const exited = (code) => ['exit', code, { socketFileLeft: false }];

test('MPV exiting on its own reports its exit code once, with its IPC socket file already removed', async (t) => {
    for (const [code, signal, expected] of [[0, null, 0], [2, null, 2], [4, null, 4], [null, 'SIGKILL', 1]]) {
        const spawned = useFakeChildProcess(t);
        const { mpv, reported } = newMpvProcess(t, spawned);

        assert.equal(await startWithin(mpv), 'started');
        exit(spawned[0], code, signal);
        spawned[0].emit('exit', code, signal);
        await waitUntil(() => reported.length > 0);
        await delay(20);

        assert.deepEqual(reported, [exited(expected)]);
    }
});

test('MPV that crashes is not started again', async (t) => {
    const spawned = useFakeChildProcess(t);
    const { mpv } = newMpvProcess(t, spawned);

    assert.equal(await startWithin(mpv), 'started');
    exit(spawned[0], 4, null);
    await delay(50);

    assert.equal(spawned.length, 1);
});

test('stopping MPV quits it and reports a normal exit once, with its IPC socket file already removed', async (t) => {
    const spawned = useFakeChildProcess(t);
    const { mpv, reported } = newMpvProcess(t, spawned);

    assert.equal(await startWithin(mpv), 'started');
    mpv.stop();
    mpv.stop();
    await waitUntil(() => reported.length > 0);
    await delay(20);

    assert.equal(spawned[0].killed, false);
    assert.deepEqual(reported, [exited(0)]);
});

test('MPV that refuses to quit when stopped is killed and still reports a normal exit', async (t) => {
    const spawned = useFakeChildProcess(t, (t, child) => listenOnIpc(t, child, (command) => (command[0] === 'quit' ? 'error' : 'success')));
    const { mpv, reported } = newMpvProcess(t, spawned);

    assert.equal(await startWithin(mpv), 'started');
    mpv.stop();
    await waitUntil(() => reported.length > 0);

    assert.equal(spawned[0].killed, true);
    assert.deepEqual(reported, [exited(0)]);
});

test('nothing but the exit is reported once MPV is asked to stop', async (t) => {
    const spawned = useFakeChildProcess(t, (t, child) => listenOnIpc(t, child, (command) => (command[0] === 'quit' ? undefined : 'success')));
    const { mpv, reported } = newMpvProcess(t, spawned);

    assert.equal(await startWithin(mpv), 'started');
    spawned[0].sendEvent({ event: 'property-change', name: 'volume', data: 40 });
    await waitUntil(() => reported.length > 0);
    mpv.stop();
    spawned[0].sendEvent({ event: 'property-change', name: 'volume', data: 50 });
    await delay(50);
    await assert.rejects(mpv.setProperty('volume', 60));
    exit(spawned[0], 0, null);
    await waitUntil(() => reported.length > 1);

    assert.deepEqual(reported, [['property', 'volume', 40], exited(0)]);
});

const startupFailures = [
    ['MPV that cannot bind its IPC socket and keeps running', (_t, child) => {
        child.stdout.emit('data', Buffer.from('Could not bind IPC socket'));
    }],
    ['MPV exiting before it listens on its IPC socket', (_t, child) => {
        exit(child, 1, null);
    }],
    ['MPV exiting after it listens on its IPC socket but before anything connects to it', (_t, child) => {
        child.stdout.emit('data', Buffer.from('Listening to IPC socket'));
        setImmediate(() => exit(child, 1, null));
    }],
    ['MPV exiting while node-mpv waits for it to go idle', (t, child) => {
        listenOnIpc(t, child, (command) => {
            if (command[0] !== 'get_property') return 'success';
            setTimeout(() => exit(child, 1, null), 20);
            return undefined;
        });
    }],
    ['MPV exiting while node-mpv sets up the properties it observes', (t, child) => {
        listenOnIpc(t, child, (command) => {
            if (command[0] !== 'observe_property') return 'success';
            setTimeout(() => exit(child, 1, null), 20);
            return undefined;
        });
    }],
    ['MPV whose process fails while starting', (_t, child) => {
        child.emit('error', new Error('spawn EACCES'));
    }],
];

for (const [name, startUp] of startupFailures) {
    test(`${name} fails to start, leaves no MPV process or IPC socket file and reports no exit`, async (t) => {
        const spawned = useFakeChildProcess(t, startUp);
        const { mpv, reported } = newMpvProcess(t, spawned);

        assert.equal(await startWithin(mpv), 'rejected');
        const [child] = spawned;
        await waitUntil(() => hasExited(child) && !isSocketFileLeft(child));
        await delay(20);

        assert.equal(hasExited(child), true);
        assert.equal(isSocketFileLeft(child), false);
        assert.deepEqual(reported, []);
    });
}

test('stopping MPV before it finishes starting fails the start, leaves no MPV process and reports no exit', async (t) => {
    for (const stopAfterSpawn of [false, true]) {
        const spawned = useFakeChildProcess(t, stopAfterSpawn ? () => {} : listenOnIpc);
        const { mpv, reported } = newMpvProcess(t, spawned);

        const starting = startWithin(mpv);
        if (stopAfterSpawn) await waitUntil(() => spawned.length > 0);
        mpv.stop();

        assert.equal(await starting, 'rejected');
        const [child] = spawned;
        await waitUntil(() => hasExited(child) && !isSocketFileLeft(child));
        await delay(20);
        assert.equal(hasExited(child), true);
        assert.equal(isSocketFileLeft(child), false);
        assert.deepEqual(reported, []);
    }
});

test('MPV whose process fails while playing keeps playing and nothing escapes as an uncaught exception', async (t) => {
    const spawned = useFakeChildProcess(t);
    const { mpv, reported } = newMpvProcess(t, spawned);

    assert.equal(await startWithin(mpv), 'started');
    const [child] = spawned;
    assert.doesNotThrow(() => child.emit('error', new Error('kill EPERM')));
    await delay(20);

    assert.equal(hasExited(child), false);
    assert.deepEqual(reported, []);
});
