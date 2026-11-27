/* exported loadConfigData */

let historyData = [];
let configRequest = null;
let credentialsRequest = null;
let accessCodeRequest = null;

historyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    historyDropdown.classList.toggle('show');
});

document.addEventListener('click', function (e) {
    if (!historyDropdown.contains(e.target) && e.target !== historyBtn) {
        historyDropdown.classList.remove('show');
    }
});

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

            accessCodeRequest = null;
            fillHistoryCredentials({ domain: item.domain, account: item.account });

            historyDropdown.classList.remove('show');
            
            checkInputs();
        });
    });

    historyDropdown.querySelectorAll('.history-delete').forEach(deleteBtn => {
        deleteBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            
            const index = parseInt(this.dataset.index);
            const item = historyData[index];
            
            historyDropdown.classList.remove('show');
            
            showCustomConfirm(
                `确定要删除 ${item.account}@${item.domain} 的登录记录吗？`,
                () => deleteHistoryItem({ domain: item.domain, account: item.account })
            );
        });
    });

    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            
            historyDropdown.classList.remove('show');
            
            showCustomConfirm(
                '确定要清除所有历史记录吗？',
                clearHistory
            );
        });
    }
}

async function deleteHistoryItem(key) {
    try {
        if (await ipcRenderer.invoke('delete-history-item', key)) loadConfigData();
    } catch (error) {
        window.log.error('删除历史记录项失败:', error);
        showCustomMessage('error', '删除失败', '没能删除这条登录记录，请稍后重试。');
    }
}

async function clearHistory() {
    try {
        await ipcRenderer.invoke('clear-history');
    } catch (error) {
        window.log.error('清除历史记录失败:', error);
        showCustomMessage('error', '清除失败', '没能清除历史记录，请稍后重试。');
        return;
    }
    historyData = [];
    renderHistoryList();
}

async function loadConfigData() {
    const request = {};
    configRequest = request;
    let data;
    try {
        data = await ipcRenderer.invoke('get-config');
    } catch (error) {
        window.log.error('读取配置失败:', error);
        return;
    }
    if (configRequest !== request) return;
    showConfig(data);
}

function showConfig({ config, history }) {
    historyData = history || [];
    credentialsRequest = null;
    accessCodeRequest = null;

    if (config && config.domain) {
        domainInput.value = config.domain.replace(/^https?:\/\//, '');
        if (config.useHttps) {
            document.getElementById('httpsSwitch').checked = config.useHttps;
        }
    }
    if (config && config.account) {
        usernameInput.value = config.account;
    }
    if (config && config.hasAccessCode) {
        fillCurrentAccessCode({ domain: config.domain, account: config.account });
    }

    renderHistoryList();

    checkInputs();
}

async function fillHistoryCredentials(request) {
    credentialsRequest = request;
    let credentials;
    try {
        credentials = await ipcRenderer.invoke('get-history-credentials', request);
    } catch (error) {
        window.log.error('读取历史凭据失败:', error);
        return;
    }
    if (credentialsRequest !== request) return;
    credentialsRequest = null;
    passwordInput.value = credentials.password;
    accessCodeInput.value = credentials.accessCode;
    checkInputs();
}

async function fillCurrentAccessCode(request) {
    accessCodeRequest = request;
    let saved;
    try {
        saved = await ipcRenderer.invoke('get-current-access-code');
    } catch (error) {
        window.log.error('读取当前访问码失败:', error);
        return;
    }
    if (accessCodeRequest !== request || saved.domain !== request.domain || saved.account !== request.account) return;
    accessCodeRequest = null;
    accessCodeInput.value = saved.accessCode;
}

[domainInput, usernameInput, passwordInput, accessCodeInput].forEach(input => {
    input.addEventListener('input', () => {
        credentialsRequest = null;
        accessCodeRequest = null;
    });
});
