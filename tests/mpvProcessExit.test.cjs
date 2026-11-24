const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { useFakeModule } = require('./helpers/fakeElectron.cjs');

const NODE_MPV_DIR = path.dirname(require.resolve('node-mpv-2/package.json'));

async function waitUntil(condition) {
    for (let i = 0; i < 100 && !condition(); i++) await delay(10);
}

function forgetNodeMpv() {
    Object.keys(require.cache)
        .filter((id) => id.startsWith(NODE_MPV_DIR))
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
                if (command[0] === 'loadlist') {
                    setImmediate(() => connections.forEach((each) => each.write('{"event":"start-file"}\n{"event":"file-loaded"}\n')));
                }
            }
        });
    });
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

function useFakeMpvProcess(t, startUp = listenOnIpc) {
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

test('MPV exiting with a code node-mpv does not report still ends the player once as an abnormal exit and removes its IPC socket file', async (t) => {
    const spawned = useFakeMpvProcess(t);
    const ply = require('../dest/modules/players/index.js');
    const events = [];
    const player = new ply.MpvPlayer({
        playerPath: '',
        onEvent: (type, data) => events.push({ type, code: data.code }),
        resumePosition: () => 0,
        loadSubtitles: async () => [],
    });
    t.after(() => player.stop());

    assert.equal(await player.playList([{ itemGuid: 'item-1', title: 'Episode 1', playLink: 'http://127.0.0.1/stream', ts: 0, duration: 100 }], 0), true);
    const { socketPath } = spawned[0];
    const isSocketFile = !socketPath.startsWith('\\');
    spawned[0].emit('close', 2, null);
    spawned[0].emit('close', 2, null);
    await waitUntil(() => !isSocketFile || !fs.existsSync(socketPath));

    assert.deepEqual(events, [{ type: ply.EventType.EXIT, code: 2 }]);
    assert.equal(isSocketFile && fs.existsSync(socketPath), false);
});

function newPlayer(t, ply) {
    const events = [];
    const player = new ply.MpvPlayer({
        playerPath: '',
        onEvent: (type) => events.push(type),
        resumePosition: () => 0,
        loadSubtitles: async () => [],
    });
    t.after(() => player.stop());
    return { player, events };
}

function playWithin(player, ms = 3000) {
    const item = { itemGuid: 'item-1', title: 'Episode 1', playLink: 'http://127.0.0.1/stream', ts: 0, duration: 100 };
    return Promise.race([
        player.playList([item], 0),
        delay(ms).then(() => 'still starting'),
    ]);
}

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
    test(`${name} fails the play request with one error, leaves no MPV process running and ends the player without EXIT`, async (t) => {
        const spawned = useFakeMpvProcess(t, startUp);
        const ply = require('../dest/modules/players/index.js');
        const { player, events } = newPlayer(t, ply);

        assert.equal(await playWithin(player), false);
        const [child] = spawned;
        await waitUntil(() => hasExited(child) && !isSocketFileLeft(child));
        await delay(20);

        assert.equal(hasExited(child), true);
        assert.equal(isSocketFileLeft(child), false);
        assert.deepEqual(events, [ply.EventType.ERROR]);
    });
}

test('stopping before MPV finishes starting ends the player once, fails the play request and leaves no MPV process running', async (t) => {
    const spawned = useFakeMpvProcess(t);
    const ply = require('../dest/modules/players/index.js');
    const { player, events } = newPlayer(t, ply);

    const playing = playWithin(player);
    player.stop();

    assert.equal(await playing, false);
    const [child] = spawned;
    await waitUntil(() => hasExited(child) && !isSocketFileLeft(child));
    assert.equal(hasExited(child), true);
    assert.equal(isSocketFileLeft(child), false);
    assert.deepEqual(events, [ply.EventType.EXIT]);
});

test('MPV that refuses to quit when the player stops is killed', async (t) => {
    const spawned = useFakeMpvProcess(t, (t, child) => listenOnIpc(t, child, (command) => (command[0] === 'quit' ? 'error' : 'success')));
    const ply = require('../dest/modules/players/index.js');
    const { player, events } = newPlayer(t, ply);

    assert.equal(await playWithin(player), true);
    player.stop();
    const [child] = spawned;
    await waitUntil(() => hasExited(child) && !isSocketFileLeft(child));

    assert.equal(child.killed, true);
    assert.equal(isSocketFileLeft(child), false);
    assert.deepEqual(events, [ply.EventType.EXIT]);
});

test('MPV whose process fails while playing keeps playing and nothing escapes as an uncaught exception', async (t) => {
    const spawned = useFakeMpvProcess(t);
    const ply = require('../dest/modules/players/index.js');
    const { player, events } = newPlayer(t, ply);

    assert.equal(await playWithin(player), true);
    const [child] = spawned;
    assert.doesNotThrow(() => child.emit('error', new Error('kill EPERM')));
    await delay(20);

    assert.equal(hasExited(child), false);
    assert.deepEqual(events, []);
});
