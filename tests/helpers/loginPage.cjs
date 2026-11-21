const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { isFnId } = require('../../dest/public/fnId.js');

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

function createElement(focusTracker = { focus() {} }) {
    const listeners = new Map();
    const classes = new Set();
    const element = {
        value: '',
        checked: false,
        disabled: false,
        isConnected: true,
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
        focus() { focusTracker.focus(element); },
        click() { element.dispatch('click'); },
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
    const focusTracker = {
        focus(element) {
            if (!element.disabled && element.isConnected) context.document.activeElement = element;
        },
    };
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, createElement(focusTracker));
        return elements.get(id);
    };
    const sent = [];
    const invoked = [];
    const pendingInvocations = [];
    const pageListeners = new Map();
    const copy = (payload) => payload && JSON.parse(JSON.stringify(payload));
    const takeInvocation = (channel) => {
        const index = pendingInvocations.findIndex((invocation) => invocation.channel === channel);
        assert.notEqual(index, -1, `no pending ${channel} invocation`);
        return pendingInvocations.splice(index, 1)[0];
    };
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const electronAPI = {
        send(channel, payload) { sent.push({ channel, payload: copy(payload) }); },
        invoke(channel, payload) {
            invoked.push({ channel, payload: copy(payload) });
            return new Promise((resolve, reject) => {
                pendingInvocations.push({ channel, payload: copy(payload), resolve, reject });
            });
        },
        on(channel, listener) { pageListeners.set(channel, listener); },
        once() {},
        off() {},
        isFnId,
    };
    const documentElement = createElement();
    const windowElement = createElement();
    const body = createElement(focusTracker);
    const messageDialog = createElement();
    const context = {
        console,
        setTimeout: (...args) => setTimeout(...args),
        clearTimeout: (...args) => clearTimeout(...args),
        document: Object.assign(documentElement, {
            getElementById: getElement,
            createElement: () => createElement(),
            querySelector: (selector) => (selector === '.message-dialog' ? messageDialog : null),
            body,
            activeElement: body,
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
        invoked,
        pending: () => pendingInvocations.map(({ channel, payload }) => ({ channel, payload })),
        async resolve(channel, value) {
            takeInvocation(channel).resolve(value);
            await settle();
        },
        async reject(channel, error) {
            takeInvocation(channel).reject(error);
            await settle();
        },
        form,
        input: getElement,
        loginEnabled: () => getElement('loginBtn').disabled === false,
        load() { windowElement.dispatch('DOMContentLoaded'); },
        click(id) {
            getElement(id).focus();
            getElement(id).dispatch('click');
        },
        focus(id) { getElement(id).focus(); },
        focusedId() {
            const active = context.document.activeElement;
            return [...elements].find(([, element]) => element === active)?.[0] ?? null;
        },
        press(key) {
            const target = context.document.activeElement;
            documentElement.dispatch('keydown', { key, target });
            documentElement.dispatch('keypress', { key, target });
        },
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
