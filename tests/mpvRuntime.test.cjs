const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { writeArchive, writeTree, readRecord, tempRoot, sha256 } = require('./helpers/mpvManifestFixture.cjs');

function setup(t, { userMpvPath, isPackaged = false, userDirsError, withMpvHome = true } = {}) {
    const root = tempRoot(t, 'runtime');
    const paths = { home: root, appData: path.join(root, 'AppData'), userData: path.join(root, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    useFakeElectron(t, {
        app: {
            isPackaged: false,
            getAppPath: () => root,
            getPath: name => paths[name],
            setPath(name, value) { paths[name] = value; },
            commandLine: { getSwitchValue: () => '' },
            getVersion: () => '0.0.0',
        },
    });
    const mpvHome = path.join(root, 'mpv-home');
    const state = { userMpvPath, answer: 'dismissed', prompts: [], openedPaths: [] };
    let answered;
    state.answered = new Promise(resolve => { answered = resolve; });
    const { createMpvRuntime } = require('../dest/main/common/mpvRuntime.js');
    const runtime = createMpvRuntime({
        platform: 'win32',
        env: withMpvHome ? { MPV_HOME: mpvHome } : {},
        appPaths: () => (isPackaged
            ? { appPath: path.join(root, 'resources', 'app.asar'), execPath: path.join(root, 'FNMedia.exe'), resourcesPath: path.join(root, 'resources'), isPackaged }
            : { appPath: root, execPath: path.join(root, 'electron.exe'), resourcesPath: path.join(root, 'resources'), isPackaged }),
        userDirs: () => {
            if (userDirsError) throw new Error(userDirsError);
            return { homeDir: root, appDataDir: paths.appData };
        },
        userMpvPath: () => state.userMpvPath,
        askMergePrompt(text) {
            state.prompts.push(text);
            if (state.answer === 'never') return new Promise(() => {});
            return Promise.resolve(state.answer).finally(() => setImmediate(answered));
        },
        async openPath(target) { state.openedPaths.push(target); return ''; },
    });
    t.after(() => runtime.stop());
    const logText = () => fs.readFileSync(path.join(root, 'log', 'app.log'), 'utf8');
    return { root, appData: paths.appData, mpvHome, runtime, state, logText };
}

test('the bundled MPV is started with the MPV config folder as its config dir', (t) => {
    const { root, mpvHome, runtime } = setup(t);
    assert.deepEqual(runtime.program(), {
        path: path.join(root, 'third_party', 'fntv-mpv', 'mpv.exe'),
        bundled: true,
        args: [`--config-dir=${mpvHome}`],
    });
});

test('a user-chosen MPV is started without a config dir', (t) => {
    const { runtime } = setup(t, { userMpvPath: 'E:\\tools\\mpv\\mpv.exe' });
    assert.deepEqual(runtime.program(), { path: 'E:\\tools\\mpv\\mpv.exe', bundled: false, args: [] });
});

test('the packaged bundled MPV and portable config are found next to the application executable', (t) => {
    const { root, mpvHome, runtime } = setup(t, { isPackaged: true });
    assert.equal(runtime.program().path, path.join(root, 'third_party', 'fntv-mpv', 'mpv.exe'));

    writeArchive(path.join(root, 'third_party'), 'fntv-mpv', { files: { 'mpv.conf': 'include="~~/fntv/defaults.conf"\n' } });
    runtime.syncAtStartup();
    assert.equal(fs.readFileSync(path.join(mpvHome, 'mpv.conf'), 'utf8'), 'include="~~/fntv/defaults.conf"\n');
});

test('choosing an MPV with its own portable config moves the user config there', (t) => {
    const app = setup(t, { withMpvHome: false });
    assert.equal(app.runtime.userConfig().dir, path.join(app.appData, 'mpv'));

    const portable = path.join(app.root, 'tools', 'mpv', 'portable_config');
    fs.mkdirSync(portable, { recursive: true });
    app.state.userMpvPath = path.join(app.root, 'tools', 'mpv', 'mpv.exe');
    assert.equal(app.runtime.userConfig().dir, portable);
});

test('when the MPV config folder cannot be determined there is no user config and the reason is logged', (t) => {
    const { runtime, logText } = setup(t, { withMpvHome: false, userDirsError: "Failed to get 'appData' path" });
    assert.equal(runtime.userConfig(), undefined);
    assert.deepEqual(runtime.program().args, []);
    assert.match(logText(), /获取 MPV 用户配置目录失败.*Failed to get 'appData' path/);
});

const MERGE_FILES = {
    'mpv.conf': 'include="~~/fntv/defaults.conf"\n',
    'fntv/defaults.conf': 'volume=100\n',
    'input.conf': 'SPACE cycle pause\n',
    'scripts/uosc/main.lua': 'uosc 5.0',
    'scripts/uosc_danmaku/main.lua': 'VERSION = "2.0.0"',
};
const ACK_INPUT = [{ path: 'input.conf', sha256: sha256(MERGE_FILES['input.conf']) }];

function setupModifiedInputConf(t) {
    const app = setup(t);
    writeArchive(path.join(app.root, 'third_party'), 'fntv-mpv', { files: MERGE_FILES });
    writeTree(app.mpvHome, { 'input.conf': 'SPACE cycle pause\nq quit # mine\n' });
    return app;
}

test('a modified input.conf is prompted once and not again after the user closes the prompt', async (t) => {
    const app = setupModifiedInputConf(t);
    app.runtime.syncAtStartup();
    assert.equal(app.state.prompts.length, 1);
    assert.ok(app.state.prompts[0].detail.includes('input.conf.fntv-new'));
    assert.match(app.state.prompts[0].detail, /一次性迁移/);
    await app.state.answered;
    assert.deepEqual(app.state.openedPaths, []);
    assert.deepEqual(readRecord(app.mpvHome).acknowledgedConflicts, ACK_INPUT);

    app.runtime.syncAtStartup();
    assert.equal(app.state.prompts.length, 1);
});

test('the prompt comes back on the next start when the client quit before it was closed', (t) => {
    const app = setupModifiedInputConf(t);
    app.state.answer = 'never';
    app.runtime.syncAtStartup();
    app.runtime.syncAtStartup();
    assert.equal(app.state.prompts.length, 2);
    assert.ok(app.state.prompts[1].detail.includes('input.conf.fntv-new'));
});

test('"open config folder" opens the MPV config folder and acknowledges the conflicts', async (t) => {
    const app = setupModifiedInputConf(t);
    app.state.answer = 'openConfigDir';
    app.runtime.syncAtStartup();
    await app.state.answered;
    assert.deepEqual(app.state.openedPaths, [app.mpvHome]);
    assert.deepEqual(readRecord(app.mpvHome).acknowledgedConflicts, ACK_INPUT);
});

const CAPABILITY_FILES = { 'mpv.conf': 'include="~~/fntv/defaults.conf"\n', 'scripts/smart_skip/main.lua': 'skip' };

function startWithProvides(app, provides) {
    fs.rmSync(path.join(app.root, 'third_party'), { recursive: true, force: true });
    writeArchive(path.join(app.root, 'third_party'), 'fntv-mpv', { files: CAPABILITY_FILES, provides });
    app.runtime.syncAtStartup();
}

test('plugins that miss a required capability are reported and the missing capability is logged', (t) => {
    const app = setup(t);
    startWithProvides(app, {});
    assert.equal(app.runtime.capabilitiesSatisfied(), false);
    assert.match(app.logText(), /ERROR.*smart-skip\.origin-from-play-url \(需要 1，未提供\)/);
});

test('capabilities are satisfied once the installed plugins provide every required capability', (t) => {
    const app = setup(t);
    startWithProvides(app, { 'smart-skip.origin-from-play-url': 0 });
    assert.equal(app.runtime.capabilitiesSatisfied(), false);
    assert.match(app.logText(), /ERROR.*smart-skip\.origin-from-play-url \(需要 1，当前 0\)/);

    startWithProvides(app, { 'smart-skip.origin-from-play-url': 1 });
    assert.equal(app.runtime.capabilitiesSatisfied(), true);
});

test('a failed startup sync counts as unsatisfied capabilities', (t) => {
    const app = setup(t, { withMpvHome: false, userDirsError: 'boom' });
    app.runtime.syncAtStartup();
    assert.equal(app.runtime.capabilitiesSatisfied(), false);
    assert.match(app.logText(), /ERROR.*初始化 MPV 配置失败.*boom/);
});

test('the user config counts pending updates in every folder', (t) => {
    const app = setup(t);
    writeTree(app.mpvHome, { 'input.conf': 'mine', 'input.conf.fntv-new': 'new', 'script-opts/uosc.conf.fntv-new': 'new' });
    assert.deepEqual(app.runtime.userConfig(), { dir: app.mpvHome, pendingUpdates: 2 });
});

async function waitFor(condition) {
    for (let i = 0; i < 100 && !condition(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

test('deleting a pending update notifies listeners and the count follows', async (t) => {
    const app = setup(t);
    writeTree(app.mpvHome, { 'input.conf.fntv-new': 'new' });
    let changes = 0;
    app.runtime.onPendingUpdatesChange(() => { changes += 1; });
    assert.equal(app.runtime.userConfig().pendingUpdates, 1);
    await waitFor(() => changes > 0);

    const seen = changes;
    fs.rmSync(path.join(app.mpvHome, 'input.conf.fntv-new'));
    await waitFor(() => changes > seen);
    assert.ok(changes > seen);
    assert.equal(app.runtime.userConfig().pendingUpdates, 0);
});

test('a pending update deleted right after it was counted still notifies listeners', async (t) => {
    const app = setup(t);
    writeTree(app.mpvHome, { 'input.conf.fntv-new': 'new' });
    let changes = 0;
    app.runtime.onPendingUpdatesChange(() => { changes += 1; });
    assert.equal(app.runtime.userConfig().pendingUpdates, 1);
    fs.rmSync(path.join(app.mpvHome, 'input.conf.fntv-new'));

    await waitFor(() => changes > 0);
    assert.ok(changes > 0);
    assert.equal(app.runtime.userConfig().pendingUpdates, 0);
});
