/* exported showCustomConfirm, showCustomMessage */

let confirmCallback = null;

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
