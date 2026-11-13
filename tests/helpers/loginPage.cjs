const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const LOGIN_DIR = path.join(__dirname, '..', '..', 'resource', 'login');

const readLoginFile = (name) => fs.readFileSync(path.join(LOGIN_DIR, name), 'utf8');

// 文件列表取自 index.html 的引用，还要和目录内容一致。新文件没接进页面或测试读漏时在这里失败，
// 不会让 doesNotMatch 对着空内容通过。
function referencedFiles(tagPattern, extension) {
    const names = [...readLoginFile('index.html').matchAll(tagPattern)].map(([, name]) => name);
    const onDisk = fs.readdirSync(LOGIN_DIR).filter((name) => name.endsWith(extension));
    assert.ok(names.length > 0, `index.html references no ${extension} files`);
    assert.deepEqual([...names].sort(), onDisk.sort());
    return names;
}

function loginPageStyles() {
    return referencedFiles(/<link rel="stylesheet" href="\.\/([^"]+)"/g, '.css')
        .map(readLoginFile)
        .join('\n');
}

// 按页面加载顺序返回每个脚本，要模拟真实加载时逐个运行，不要拼起来：拼接后函数提升会盖住顺序问题。
function loginPageScripts() {
    return referencedFiles(/<script src="\.\/([^"]+)"/g, '.js')
        .map((name) => ({ name, source: readLoginFile(name) }));
}

const loginPageScriptText = () => loginPageScripts().map(({ source }) => source).join('\n');

function createElement() {
    const listeners = new Map();
    const classes = new Set();
    const element = {
        value: '',
        checked: false,
        dataset: {},
        style: {},
        children: [],
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            toggle: (name) => (classes.has(name) ? classes.delete(name) : classes.add(name)),
            contains: (name) => classes.has(name),
        },
        addEventListener(type, listener) {
            listeners.set(type, [...(listeners.get(type) || []), listener]);
        },
        dispatch(type, event = {}) {
            for (const listener of listeners.get(type) || []) {
                listener.call(element, { target: element, preventDefault() {}, stopPropagation() {}, ...event });
            }
        },
        append(...children) {
            for (const child of children) {
                child.parentNode = element;
                element.children.push(child);
            }
        },
        replaceChildren() { element.children = []; },
        contains: () => false,
        focus() {},
        querySelectorAll(selector) {
            const className = selector.slice(1);
            const found = [];
            const visit = (node) => {
                if (node.className === className) found.push(node);
                node.children.forEach(visit);
            };
            element.children.forEach(visit);
            return found;
        },
    };
    return element;
}

// 用假 DOM 跑登录页真实的脚本，主进程这一侧由测试扮演。
function openLoginPage() {
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
    };
    const sent = [];
    const pageListeners = new Map();
    const electronAPI = {
        send(channel, payload) { sent.push({ channel, payload: payload && JSON.parse(JSON.stringify(payload)) }); },
        on(channel, listener) { pageListeners.set(channel, listener); },
        once() {},
        off() {},
    };
    const documentElement = createElement();
    const windowElement = createElement();
    const context = {
        console,
        setTimeout() { return 0; },
        clearTimeout() {},
        document: Object.assign(documentElement, {
            getElementById: getElement,
            createElement: () => createElement(),
            activeElement: null,
        }),
        window: Object.assign(windowElement, {
            electronAPI,
            log: { info() {}, warn() {}, error() {} },
        }),
    };
    vm.createContext(context);
    for (const { name, source } of loginPageScripts()) {
        vm.runInContext(source, context, { filename: name });
    }

    const form = () => ({
        domain: getElement('domain').value,
        username: getElement('username').value,
        password: getElement('password').value,
        accessCode: getElement('accessCode').value,
        useHttps: getElement('httpsSwitch').checked,
    });

    return {
        sent,
        form,
        input: getElement,
        loginEnabled: () => getElement('loginBtn').disabled === false,
        load() { windowElement.dispatch('DOMContentLoaded'); },
        click(id) { getElement(id).dispatch('click'); },
        receive(channel, data) { pageListeners.get(channel)(undefined, data); },
        clickHistory(index) {
            getElement('historyDropdown').querySelectorAll('.history-content')[index].dispatch('click');
        },
        typeInto(id, value) {
            getElement(id).value = value;
            getElement(id).dispatch('input');
        },
    };
}

module.exports = { loginPageScriptText, loginPageScripts, loginPageStyles, openLoginPage };
