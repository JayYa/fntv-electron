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
