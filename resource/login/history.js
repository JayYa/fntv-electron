let historyData = [];
let pendingHistoryCredentials = null;
let pendingCurrentAccessCode = null;

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

            pendingCurrentAccessCode = null;
            pendingHistoryCredentials = { domain: item.domain, account: item.account };
            ipcRenderer.send('get-history-credentials', pendingHistoryCredentials);

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
                () => {
                    ipcRenderer.send('delete-history-item', { domain: item.domain, account: item.account });
                }
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
                () => {
                    ipcRenderer.send('clear-history');
                    historyData = [];
                    renderHistoryList();
                }
            );
        });
    }
}

function loadConfigData() {
    ipcRenderer.send('get-config');
}

ipcRenderer.on('config-data', (event, data) => {
    const { config, history } = data;
    historyData = history || [];
    pendingHistoryCredentials = null;
    pendingCurrentAccessCode = null;

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
        pendingCurrentAccessCode = { domain: config.domain, account: config.account };
        ipcRenderer.send('get-current-access-code');
    }

    renderHistoryList();
    
    checkInputs();
});

function isPendingLogin(pending, reply) {
    return pending && pending.domain === reply.domain && pending.account === reply.account;
}

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

[domainInput, usernameInput, passwordInput, accessCodeInput].forEach(input => {
    input.addEventListener('input', () => {
        pendingHistoryCredentials = null;
        pendingCurrentAccessCode = null;
    });
});

ipcRenderer.on('history-item-deleted', () => {
    loadConfigData();
});
