const path = require('node:path');
const Module = require('node:module');

const DEST = `${path.sep}dest${path.sep}`;

function clearCompiledModules() {
    Object.keys(require.cache)
        .filter((id) => id.includes(DEST))
        .forEach((id) => delete require.cache[id]);
}

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

function useFakeModule(t, name, replacement) {
    replaceModule(t, name, () => replacement);
}

function useFakeElectron(t, electronMock, { platform } = {}) {
    useFakeModule(t, 'electron', electronMock);
    if (platform) {
        Object.defineProperty(process, 'platform', { ...ORIGINAL_PLATFORM, value: platform });
    }
}

function withoutElectron(t) {
    const requested = [];
    replaceModule(t, 'electron', (parent) => {
        requested.push(parent && parent.filename);
        throw new Error('electron is not available');
    });
    return requested;
}

module.exports = { useFakeElectron, useFakeModule, withoutElectron };
