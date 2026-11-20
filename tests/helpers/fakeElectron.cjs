const path = require('node:path');
const Module = require('node:module');

const DEST = `${path.sep}dest${path.sep}`;

function clearCompiledModules() {
    Object.keys(require.cache)
        .filter((id) => id.includes(DEST))
        .forEach((id) => delete require.cache[id]);
}

// t.after 按注册顺序执行，各自保存再恢复原值会把先装的替身恢复回去。
// 所以替身记在这里，最后一个撤掉时才恢复 Module._load 和 process.platform。
const ORIGINAL_LOAD = Module._load;
const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform');
const active = [];

function installedLoad(request, parent, isMain) {
    const replacement = active.findLast((entry) => entry.name === request);
    if (replacement) return replacement.load(parent);
    return ORIGINAL_LOAD.call(this, request, parent, isMain);
}

function replaceModule(t, name, load) {
    const entry = { name, load };
    active.push(entry);
    Module._load = installedLoad;
    t.after(() => {
        active.splice(active.indexOf(entry), 1);
        if (active.length === 0) {
            Module._load = ORIGINAL_LOAD;
            Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM);
        }
        clearCompiledModules();
    });
    clearCompiledModules();
}

/** 让 require(name) 返回 replacement，例如 node-mpv-2 的替身。 */
function useFakeModule(t, name, replacement) {
    replaceModule(t, name, () => replacement);
}

/**
 * 让 require('electron') 返回 electronMock。
 * platform 给出时同时改写 process.platform，模拟在该平台上运行（src/public/platform/index.ts 每次调用都读它）。
 * 只放这个测试用到的 Electron API；各平台分支用到的 API 都要有（TESTING_STANDARDS.md）。
 */
function useFakeElectron(t, electronMock, { platform } = {}) {
    useFakeModule(t, 'electron', electronMock);
    if (platform) {
        Object.defineProperty(process, 'platform', { ...ORIGINAL_PLATFORM, value: platform });
    }
}

/**
 * 模拟没有 electron 的普通 Node 进程（Proxy 的 utilityProcess）：require('electron') 抛错。
 * 返回的数组记下每次尝试加载 electron 的文件，测试断言它为空。
 */
function withoutElectron(t) {
    const requested = [];
    replaceModule(t, 'electron', (parent) => {
        requested.push(parent && parent.filename);
        throw new Error('electron is not available');
    });
    return requested;
}

module.exports = { useFakeElectron, useFakeModule, withoutElectron };
