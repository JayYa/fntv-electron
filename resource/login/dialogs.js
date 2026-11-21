/* exported showCustomConfirm, showCustomMessage */

let confirmCallback = null;

function showCustomConfirm(message, callback) {
    confirmMessage.textContent = message;
    confirmCallback = callback;
    customConfirm.classList.add('show');
}

function hideCustomConfirm() {
    customConfirm.classList.remove('show');
    confirmCallback = null;
    setTimeout(() => {
        domainInput.focus();
    }, 100);
}

confirmCancel.addEventListener('click', () => {
    hideCustomConfirm();
});

confirmOk.addEventListener('click', () => {
    if (confirmCallback) {
        confirmCallback();
    }
    hideCustomConfirm();
});

customConfirm.addEventListener('click', (e) => {
    if (e.target === customConfirm) {
        hideCustomConfirm();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && customConfirm.classList.contains('show')) {
        hideCustomConfirm();
    }
    if (e.key === 'Escape' && customMessage.classList.contains('show')) {
        hideCustomMessage();
    }
});

function showCustomMessage(type, title, content) {
    const messageDialog = document.querySelector('.message-dialog');
    messageDialog.classList.remove('error', 'success', 'warning', 'info');
    
    messageDialog.classList.add(type);
    
    messageIcon.className = `message-icon ${type}`;
    
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
    setTimeout(() => {
        domainInput.focus();
    }, 100);
}

messageButton.addEventListener('click', () => {
    hideCustomMessage();
});

customMessage.addEventListener('click', (e) => {
    if (e.target === customMessage) {
        hideCustomMessage();
    }
});
