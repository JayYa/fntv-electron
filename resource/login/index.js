const ipcRenderer = window.electronAPI;

// 简化的日志接口 - 完全透明使用
// 不再需要手动发送IPC，直接使用即可
// window.log 已经通过 contextBridge 暴露，会自动处理IPC通信和数据脱敏

const loginBtn = document.getElementById('loginBtn');
const domainInput = document.getElementById('domain');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const passwordToggle = document.getElementById('passwordToggle');
const passwordToggleImg = document.getElementById('passwordToggleImg');
const accessCodeInput = document.getElementById('accessCode');
const accessCodeToggle = document.getElementById('accessCodeToggle');
const accessCodeToggleImg = document.getElementById('accessCodeToggleImg');
const historyBtn = document.getElementById('historyBtn');
const historyDropdown = document.getElementById('historyDropdown');
const customConfirm = document.getElementById('customConfirm');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancel = document.getElementById('confirmCancel');
const confirmOk = document.getElementById('confirmOk');
const customMessage = document.getElementById('customMessage');
const messageIcon = document.getElementById('messageIcon');
const messageTitle = document.getElementById('messageTitle');
const messageContent = document.getElementById('messageContent');
const messageButton = document.getElementById('messageButton');
const versionText = document.getElementById('versionText');
const updateBtn = document.getElementById('updateBtn');
const proxySettingsBtn = document.getElementById('proxySettingsBtn');
const proxyPanel = document.getElementById('proxyPanel');
const proxyCloseBtn = document.getElementById('proxyCloseBtn');
const proxyEnabledSwitch = document.getElementById('proxyEnabledSwitch');
const proxyUrlInput = document.getElementById('proxyUrlInput');
const proxySaveBtn = document.getElementById('proxySaveBtn');
const hideOriginalPlayButtonSwitch = document.getElementById('hideOriginalPlayButtonSwitch');

let historyData = [];
let confirmCallback = null;
// 正在等的凭据回复。连点历史或用户改了表单后这里就变了，迟到的回复对不上，直接丢弃。
let pendingHistoryCredentials = null;
let pendingCurrentAccessCode = null;

// 自定义确认对话框函数
function showCustomConfirm(message, callback) {
    confirmMessage.textContent = message;
    confirmCallback = callback;
    customConfirm.classList.add('show');
}

function hideCustomConfirm() {
    customConfirm.classList.remove('show');
    confirmCallback = null;
    // 对话框关闭后立即恢复焦点
    setTimeout(() => {
        domainInput.focus();
    }, 100);
}

// 确认对话框事件监听
confirmCancel.addEventListener('click', () => {
    hideCustomConfirm();
});

confirmOk.addEventListener('click', () => {
    if (confirmCallback) {
        confirmCallback();
    }
    hideCustomConfirm();
});

// 点击对话框外部区域关闭
customConfirm.addEventListener('click', (e) => {
    if (e.target === customConfirm) {
        hideCustomConfirm();
    }
});

// ESC键关闭对话框
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && customConfirm.classList.contains('show')) {
        hideCustomConfirm();
    }
    if (e.key === 'Escape' && customMessage.classList.contains('show')) {
        hideCustomMessage();
    }
});

// 自定义消息弹窗函数
function showCustomMessage(type, title, content) {
    // 清除之前的类型类
    const messageDialog = document.querySelector('.message-dialog');
    messageDialog.classList.remove('error', 'success', 'warning', 'info');
    
    // 添加当前类型类
    messageDialog.classList.add(type);
    
    // 设置图标和样式
    messageIcon.className = `message-icon ${type}`;
    
    // 对于错误类型，隐藏图标以减少视觉冲击
    if (type === 'error') {
        messageIcon.style.display = 'none';
    } else {
        messageIcon.style.display = 'flex';
        switch(type) {
            case 'success':
                messageIcon.textContent = '✓';
                break;
            case 'warning':
                messageIcon.textContent = '!';
                break;
            case 'info':
            default:
                messageIcon.textContent = 'i';
                break;
        }
    }
    
    messageTitle.textContent = title;
    messageContent.textContent = content;
    customMessage.classList.add('show');
}

function hideCustomMessage() {
    customMessage.classList.remove('show');
    // 消息弹窗关闭后恢复焦点
    setTimeout(() => {
        domainInput.focus();
    }, 100);
}

// 消息弹窗事件监听
messageButton.addEventListener('click', () => {
    hideCustomMessage();
});

// 点击消息弹窗外部区域关闭
customMessage.addEventListener('click', (e) => {
    if (e.target === customMessage) {
        hideCustomMessage();
    }
});

// 强制恢复焦点的通用函数
function restoreFocus() {
    try {
        // 确保输入框可用
        domainInput.disabled = false;
        domainInput.readOnly = false;
        
        // 多种方式尝试恢复焦点
        domainInput.focus();
        domainInput.select();
        
        // 如果还是无法获取焦点，尝试点击
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        domainInput.dispatchEvent(clickEvent);
        
        // 强制设置光标位置
        if (domainInput.setSelectionRange) {
            const len = domainInput.value.length;
            domainInput.setSelectionRange(len, len);
        }
    } catch (error) {
        window.log.error('恢复焦点失败:', error);
    }
}

// 和主进程的 isFnId（fnid_login.ts）保持一致。
function isFnId(value) {
    return /^[A-Za-z0-9_-]{6,30}$/.test(value);
}

function isValidDomainOrIP(value) {
    // 先检查是否为 FN ID 格式
    if (isFnId(value)) return true;
    const domainRegex = /^([\u4e00-\u9fa5a-zA-Z0-9-]+\.)+[\u4e00-\u9fa5a-zA-Z]{2,}(:\d+)?$/;
    const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}(:\d+)?$/;
    const ipv6Regex = /^\[((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\](:\d+)?$/;
    return domainRegex.test(value) || ipv4Regex.test(value) || ipv6Regex.test(value);
}

function checkInputs() {
    const domain = domainInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (domain && isValidDomainOrIP(domain) && username && password) {
        loginBtn.disabled = false;
        loginBtn.classList.add('enabled');
    } else {
        loginBtn.disabled = true;
        loginBtn.classList.remove('enabled');
    }
}

// 失去焦点时显示红色提示
domainInput.addEventListener('blur', function () {
    const domain = domainInput.value.trim();
    if (domain && !isValidDomainOrIP(domain)) {
        domainInput.classList.add('error');
        domainError.style.display = 'block';
    } else {
        domainInput.classList.remove('error');
        domainError.style.display = 'none';
    }
});

domainInput.addEventListener('input', checkInputs);
usernameInput.addEventListener('input', checkInputs);
passwordInput.addEventListener('input', checkInputs);

// 登录逻辑
loginBtn.addEventListener('click', function () {
    if (loginBtn.disabled) return;
    
    // 设置登录中状态
    const originalText = loginBtn.textContent;
    loginBtn.textContent = '登录中...';
    loginBtn.disabled = true;
    loginBtn.classList.remove('enabled');
    
    const domain = domainInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const accessCode = accessCodeInput.value.trim();
    const useHttps = document.getElementById('httpsSwitch').checked;

    window.log.info('提交登录请求:', { useHttps });
    
    const loginData = {
        domain: domain,
        username: username,
        password: password,
        accessCode: accessCode,
        useHttps: useHttps
    };

    // 发送登录请求
    ipcRenderer.send('login', loginData);
    
    // 5秒后恢复按钮状态（防止无响应）
    const timeoutId = setTimeout(() => {
        loginBtn.textContent = originalText;
        checkInputs(); // 重新检查输入状态
    }, 5000);
    
    // 监听登录结果，无论成功还是失败都恢复按钮状态
    const handleLoginResult = () => {
        clearTimeout(timeoutId);
        loginBtn.textContent = originalText;
        checkInputs();
    };
    
    // 临时监听器，处理完后自动移除
    const tempErrorListener = () => {
        handleLoginResult();
        ipcRenderer.off('login-error', tempErrorListener);
    };
    
    const tempSuccessListener = () => {
        handleLoginResult();
        ipcRenderer.off('login-success', tempSuccessListener);
    };
    
    ipcRenderer.once('login-error', tempErrorListener);
    ipcRenderer.once('login-success', tempSuccessListener);
});

// Enter 键触发
document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !loginBtn.disabled) {
        loginBtn.click();
    }
});

// 密码显示/隐藏切换
passwordToggle.addEventListener('click', function () {
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        passwordToggleImg.src = './image/password-hide.png';
        passwordToggle.title = '隐藏密码';
    } else {
        passwordInput.type = 'password';
        passwordToggleImg.src = './image/password-show.png';
        passwordToggle.title = '显示密码';
    }
});

accessCodeToggle.addEventListener('click', function () {
    if (accessCodeInput.type === 'password') {
        accessCodeInput.type = 'text';
        accessCodeToggleImg.src = './image/password-hide.png';
        accessCodeToggle.title = '隐藏访问码';
        accessCodeToggleImg.alt = '隐藏访问码';
    } else {
        accessCodeInput.type = 'password';
        accessCodeToggleImg.src = './image/password-show.png';
        accessCodeToggle.title = '显示访问码';
        accessCodeToggleImg.alt = '显示访问码';
    }
});

// 历史记录按钮点击
historyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    historyDropdown.classList.toggle('show');
});

// 点击其他地方关闭历史记录下拉框
document.addEventListener('click', function (e) {
    if (!historyDropdown.contains(e.target) && e.target !== historyBtn) {
        historyDropdown.classList.remove('show');
    }
});

// 渲染历史记录列表
function renderHistoryList() {
    if (!historyData || historyData.length === 0) {
        historyDropdown.innerHTML = '<div class="no-history">暂无历史记录</div>';
        return;
    }

    historyDropdown.replaceChildren();
    historyData.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'history-item';
        row.dataset.index = String(index);

        const content = document.createElement('div');
        content.className = 'history-content';
        const account = document.createElement('div');
        account.className = 'history-account';
        account.textContent = item.account;
        const domain = document.createElement('div');
        domain.className = 'history-domain';
        domain.textContent = `${item.domain}${item.useHttps ? ' (HTTPS)' : ' (HTTP)'}`;
        content.append(account, domain);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'history-delete';
        deleteButton.dataset.index = String(index);
        deleteButton.title = '删除此记录';
        deleteButton.textContent = '×';
        row.append(content, deleteButton);
        historyDropdown.append(row);
    });

    const clearButton = document.createElement('div');
    clearButton.className = 'clear-history';
    clearButton.id = 'clearHistoryBtn';
    clearButton.textContent = '清除所有历史记录';
    historyDropdown.append(clearButton);

    // 为历史记录项添加点击事件
    historyDropdown.querySelectorAll('.history-content').forEach(content => {
        content.addEventListener('click', function () {
            const index = Number(this.parentNode.dataset.index);
            const item = historyData[index];
            if (!item) return;

            domainInput.value = item.domain;
            usernameInput.value = item.account;
            passwordInput.value = '';
            accessCodeInput.value = '';
            document.getElementById('httpsSwitch').checked = item.useHttps === true;

            pendingCurrentAccessCode = null;
            pendingHistoryCredentials = { domain: item.domain, account: item.account };
            ipcRenderer.send('get-history-credentials', pendingHistoryCredentials);

            // 关闭下拉框
            historyDropdown.classList.remove('show');
            
            // 检查输入状态
            checkInputs();
        });
    });

    // 为删除按钮添加点击事件
    historyDropdown.querySelectorAll('.history-delete').forEach(deleteBtn => {
        deleteBtn.addEventListener('click', function (e) {
            e.stopPropagation(); // 防止触发父元素的点击事件
            e.preventDefault(); // 防止默认行为
            
            const index = parseInt(this.dataset.index);
            const item = historyData[index];
            
            // 立即关闭下拉框
            historyDropdown.classList.remove('show');
            
            // 使用自定义确认对话框
            showCustomConfirm(
                `确定要删除 ${item.account}@${item.domain} 的登录记录吗？`,
                () => {
                    // 发送删除单个历史记录的请求
                    ipcRenderer.send('delete-history-item', { domain: item.domain, account: item.account });
                }
            );
        });
    });

    // 清除历史记录按钮事件
    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            
            // 立即关闭下拉框
            historyDropdown.classList.remove('show');
            
            // 使用自定义确认对话框
            showCustomConfirm(
                '确定要清除所有历史记录吗？',
                () => {
                    ipcRenderer.send('clear-history');
                    historyData = [];
                    renderHistoryList();
                }
            );
        });
    }
}

// 加载配置和历史记录
function loadConfigData() {
    ipcRenderer.send('get-config');
}

// 监听配置数据返回
ipcRenderer.on('config-data', (event, data) => {
    const { config, history } = data;
    historyData = history || [];
    pendingHistoryCredentials = null;
    pendingCurrentAccessCode = null;

    // 如果有当前配置，填充到表单中
    if (config && config.domain) {
        // 去除掉http://和https://
        domainInput.value = config.domain.replace(/^https?:\/\//, '');
        // 根据保存的useHttps设置复选框状态
        if (config.useHttps) {
            document.getElementById('httpsSwitch').checked = config.useHttps;
        }
    }
    if (config && config.account) {
        usernameInput.value = config.account;
    }
    if (config && config.hasAccessCode) {
        pendingCurrentAccessCode = { domain: config.domain, account: config.account };
        ipcRenderer.send('get-current-access-code');
    }

    // 渲染历史记录
    renderHistoryList();
    
    // 检查输入状态
    checkInputs();
});

function isPendingLogin(pending, reply) {
    return pending && pending.domain === reply.domain && pending.account === reply.account;
}

// 解不开的凭据回复里是空值，表单留空让用户手动输入。
ipcRenderer.on('history-credentials', (event, data) => {
    if (!isPendingLogin(pendingHistoryCredentials, data)) return;
    pendingHistoryCredentials = null;
    passwordInput.value = data.password;
    accessCodeInput.value = data.accessCode;
    checkInputs();
});

ipcRenderer.on('current-access-code', (event, data) => {
    if (!isPendingLogin(pendingCurrentAccessCode, data)) return;
    pendingCurrentAccessCode = null;
    accessCodeInput.value = data.accessCode;
});

// 用户动过表单后以用户输入为准。
[domainInput, usernameInput, passwordInput, accessCodeInput].forEach(input => {
    input.addEventListener('input', () => {
        pendingHistoryCredentials = null;
        pendingCurrentAccessCode = null;
    });
});

// 监听历史记录删除成功
ipcRenderer.on('history-item-deleted', () => {
    // 重新加载配置数据
    loadConfigData();
});

// 监听登录错误消息
ipcRenderer.on('login-error', (event, data) => {
    const { title, message } = data;
    showCustomMessage('error', title, message);
});

// 监听登录成功消息
ipcRenderer.on('login-success', (event, data) => {
    const { title, message } = data;
    showCustomMessage('success', title, message);
});

// 添加额外的焦点管理事件监听器
document.addEventListener('click', function(e) {
    // 如果点击的不是历史记录相关元素，确保输入框可以正常获取焦点
    if (!historyDropdown.contains(e.target) && 
        e.target !== historyBtn && 
        !e.target.classList.contains('history-delete') &&
        e.target.id !== 'clearHistoryBtn') {
        // 如果没有其他输入元素获得焦点，默认聚焦到域名输入框
        setTimeout(() => {
            if (!document.activeElement || 
                (document.activeElement.tagName !== 'INPUT' && 
                 document.activeElement.tagName !== 'BUTTON')) {
                domainInput.focus();
            }
        }, 50);
    }
});

// 监听窗口焦点事件
window.addEventListener('focus', function() {
    // 当窗口重新获得焦点时，确保输入框可以正常工作
    setTimeout(restoreFocus, 100);
});

// GitHub链接点击事件处理
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('github-link')) {
        e.preventDefault(); // 阻止默认行为
        const url = e.target.href;
        window.electronAPI.openExternal(url).catch((error) => {
            window.log.error('打开外部链接失败:', error);
        });
    }
});

// 禁止拖拽事件
document.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
});

// 禁止拖拽效果
document.addEventListener('drag', function(e) {
    e.preventDefault();
    return false;
});

// 禁止拖拽结束
document.addEventListener('dragend', function(e) {
    e.preventDefault();
    return false;
});

// 更新检查相关函数
function initVersionInfo() {
    // 获取版本信息
    ipcRenderer.send('get-version');
}

function handleUpdateCheck() {
    const btn = updateBtn;
    const originalText = btn.textContent;
    
    // 设置检查中状态
    btn.textContent = '检查中...';
    btn.classList.add('checking');
    btn.disabled = true;
    
    // 发送检查更新请求
    ipcRenderer.send('check-update');
    
    // 5秒后恢复按钮状态（防止无响应）
    setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('checking');
        btn.disabled = false;
    }, 5000);
}

// 更新按钮点击事件
updateBtn.addEventListener('click', handleUpdateCheck);

// 监听版本信息
ipcRenderer.on('version-info', (event, data) => {
    if (data && data.version) {
        versionText.textContent = `版本 ${data.version}`;
    }
});

// 代理设置相关函数
function initProxySettings() {
    // 获取当前代理设置
    ipcRenderer.send('get-download-proxy');
    // 获取当前播放方式
    ipcRenderer.send('get-play-button-config');
}

function toggleProxyPanel() {
    proxyPanel.classList.toggle('show');
}

function closeProxyPanel() {
    proxyPanel.classList.remove('show');
}

function saveProxySettings() {
    const enabled = proxyEnabledSwitch.checked;
    const proxyUrl = proxyUrlInput.value.trim();
    const hideOriginalPlayButton = hideOriginalPlayButtonSwitch.checked;
    
    // 保存代理设置
    ipcRenderer.send('set-download-proxy', { 
        enabled: enabled,
        proxyUrl: proxyUrl || 'https://ghfast.top'
    });

    // 保存播放方式
    ipcRenderer.send('set-play-button-config', { hideOriginalPlayButton });
    
    // 显示保存状态
    const originalText = proxySaveBtn.textContent;
    proxySaveBtn.textContent = '保存中...';
    proxySaveBtn.disabled = true;
    
    // 3秒后恢复按钮状态
    setTimeout(() => {
        proxySaveBtn.textContent = originalText;
        proxySaveBtn.disabled = false;
        closeProxyPanel(); // 保存后关闭面板
    }, 1000);
}

// 代理设置事件监听
proxySettingsBtn.addEventListener('click', toggleProxyPanel);
proxyCloseBtn.addEventListener('click', closeProxyPanel);
proxySaveBtn.addEventListener('click', saveProxySettings);

// 点击面板外部关闭面板
document.addEventListener('click', (e) => {
    if (!proxyPanel.contains(e.target) && !proxySettingsBtn.contains(e.target)) {
        closeProxyPanel();
    }
});

// 监听代理设置响应
ipcRenderer.on('download-proxy-info', (event, data) => {
    if (data) {
        proxyEnabledSwitch.checked = data.enabled !== false; // 默认开启
        proxyUrlInput.value = data.proxyUrl || 'https://ghfast.top';
    }
});

// 监听播放方式响应
ipcRenderer.on('play-button-config-info', (event, data) => {
    if (data) {
        hideOriginalPlayButtonSwitch.checked = data.hideOriginalPlayButton !== false;
    }
});

ipcRenderer.on('download-proxy-set', (event, data) => {
    if (data && data.success) {
        window.log.info('代理设置保存成功');
    } else {
        window.log.error('代理设置保存失败:', data.error);
    }
});

ipcRenderer.on('play-button-config-set', (event, data) => {
    if (data && data.success) {
        window.log.info('播放方式保存成功');
    } else {
        window.log.error('播放方式保存失败:', data.error);
    }
});

// 页面加载完成后读取配置
window.addEventListener('DOMContentLoaded', function () {
    loadConfigData();
    initVersionInfo(); // 初始化版本信息
    initProxySettings(); // 初始化代理设置
    
    // 确保页面加载后域名输入框能够正确获取焦点
    setTimeout(() => {
        domainInput.focus();
    }, 500);
});
