ipcRenderer.on('login-error', (event, data) => {
    const { title, message } = data;
    showCustomMessage('error', title, message);
});

ipcRenderer.on('login-success', (event, data) => {
    const { title, message } = data;
    showCustomMessage('success', title, message);
});

document.addEventListener('click', function(e) {
    if (!historyDropdown.contains(e.target) && 
        e.target !== historyBtn && 
        !e.target.classList.contains('history-delete') &&
        e.target.id !== 'clearHistoryBtn') {
        setTimeout(() => {
            if (!document.activeElement || 
                (document.activeElement.tagName !== 'INPUT' && 
                 document.activeElement.tagName !== 'BUTTON')) {
                domainInput.focus();
            }
        }, 50);
    }
});

window.addEventListener('focus', function() {
    setTimeout(restoreFocus, 100);
});

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('github-link')) {
        e.preventDefault();
        const url = e.target.href;
        window.electronAPI.openExternal(url).catch((error) => {
            window.log.error('打开外部链接失败:', error);
        });
    }
});

document.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
});

document.addEventListener('drag', function(e) {
    e.preventDefault();
    return false;
});

document.addEventListener('dragend', function(e) {
    e.preventDefault();
    return false;
});
