let historyData = [];
// 正在等的凭据回复。连点历史或用户改了表单后这里就变了，迟到的回复对不上，直接丢弃。
let pendingHistoryCredentials = null;
let pendingCurrentAccessCode = null;

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
