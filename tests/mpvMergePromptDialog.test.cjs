// 启动时的待合并更新对话框（#223）：用户改过 input.conf，启动同步后弹一次；关掉记为已确认，没关就退出则下次再弹。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { writeArchive, writeTree, readRecord, tempRoot, sha256 } = require('./helpers/mpvManifestFixture.cjs');

const FILES = {
    'mpv.conf': 'include="~~/fntv/defaults.conf"\n',
    'fntv/defaults.conf': 'volume=100\n',
    'input.conf': 'SPACE cycle pause\n',
    'scripts/uosc/main.lua': 'uosc 5.0',
    'scripts/uosc_danmaku/main.lua': 'VERSION = "2.0.0"',
};

// 一个“启动”：在同一个临时目录上加载 mpvConfig 插件并 init。dialogResponses 按顺序回答对话框，
// 'never' 表示用户没关对话框（Promise 不 resolve），模拟直接退出客户端。
function setupApp(t, root) {
    const userDir = path.join(root, 'mpv-home');
    const paths = { home: root, appData: path.join(root, 'AppData'), userData: path.join(root, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    const originalMpvHome = process.env.MPV_HOME;
    process.env.MPV_HOME = userDir;
    t.after(() => {
        if (originalMpvHome === undefined) delete process.env.MPV_HOME;
        else process.env.MPV_HOME = originalMpvHome;
    });

    return function launch(t, dialogResponse) {
        const messageBoxes = [];
        const openedPaths = [];
        let answered;
        const done = new Promise(resolve => { answered = resolve; });
        useFakeElectron(t, {
            app: {
                isPackaged: false,
                getAppPath: () => root,
                getPath: name => paths[name],
                setPath(name, value) { paths[name] = value; },
                commandLine: { getSwitchValue: () => '' },
                getVersion: () => '0.0.0',
            },
            dialog: {
                showMessageBox(...args) {
                    messageBoxes.push(args);
                    if (dialogResponse === 'never') return new Promise(() => {});
                    return Promise.resolve({ response: dialogResponse }).finally(() => setImmediate(answered));
                },
                showErrorBox() {},
            },
            shell: { async openPath(target) { openedPaths.push(target); return ''; } },
        }, { platform: 'win32' });
        require('../dest/main/handlers/plugins/mpvConfig.js').init();
        return { messageBoxes, openedPaths, userDir, answered: done };
    };
}

function setup(t) {
    const root = tempRoot(t, 'prompt');
    writeArchive(path.join(root, 'third_party'), 'fntv-mpv', { files: FILES });
    writeTree(path.join(root, 'mpv-home'), { 'input.conf': 'SPACE cycle pause\nq quit # mine\n' });
    return setupApp(t, root);
}

const ACK_INPUT = [{ path: 'input.conf', sha256: sha256(FILES['input.conf']) }];

test('a modified input.conf is prompted once and not again after the user closes the dialog', async (t) => {
    const launch = setup(t);
    const first = launch(t, 1);
    assert.equal(first.messageBoxes.length, 1);
    // 非模态：不挂在任何窗口上。
    assert.equal(first.messageBoxes[0].length, 1);
    const [options] = first.messageBoxes[0];
    assert.deepEqual(options.buttons, ['打开配置目录', '知道了']);
    assert.ok(options.detail.includes('input.conf.fntv-new'));
    assert.match(options.detail, /一次性迁移/);
    await first.answered;
    assert.deepEqual(first.openedPaths, []);
    assert.deepEqual(readRecord(first.userDir).acknowledgedConflicts, ACK_INPUT);

    const second = launch(t, 1);
    assert.equal(second.messageBoxes.length, 0);
});

test('the prompt comes back on the next launch when the client quit before it was closed', (t) => {
    const launch = setup(t);
    assert.equal(launch(t, 'never').messageBoxes.length, 1);

    const second = launch(t, 'never');
    assert.equal(second.messageBoxes.length, 1);
    assert.ok(second.messageBoxes[0][0].detail.includes('input.conf.fntv-new'));
});

test('"open config folder" opens the MPV config folder and acknowledges the conflicts', async (t) => {
    const launch = setup(t);
    const first = launch(t, 0);
    await first.answered;
    assert.deepEqual(first.openedPaths, [first.userDir]);
    assert.deepEqual(readRecord(first.userDir).acknowledgedConflicts, ACK_INPUT);
});
