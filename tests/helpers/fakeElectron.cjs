const path = require('node:path');
const Module = require('node:module');

const DEST = `${path.sep}dest${path.sep}`;

function clearCompiledModules() {
    Object.keys(require.cache)
        .filter((id) => id.includes(DEST))
        .forEach((id) => delete require.cache[id]);
}

/**
 * 在这个测试里让 require('electron') 返回 electronMock，测试结束时恢复。
 * 前后都清掉 dest/ 下已加载的模块，被测模块重新加载时拿到的是这次的假对象。
 * platform 给出时同时改写 process.platform，模拟在该平台上运行（src/public/platform.ts 每次调用都读它）。
 * 只放这个测试用到的 Electron API；各平台分支用到的 API 都要有（TESTING_STANDARDS.md）。
 */
function useFakeElectron(t, electronMock, { platform } = {}) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return electronMock;
        return originalLoad.call(this, request, parent, isMain);
    };
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    if (platform) {
        Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
    }
    t.after(() => {
        Module._load = originalLoad;
        Object.defineProperty(process, 'platform', originalPlatform);
        clearCompiledModules();
    });
    clearCompiledModules();
}

module.exports = { useFakeElectron };
