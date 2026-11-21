/* exported showCustomConfirm, showCustomMessage */

let confirmCallback = null;
let focusBeforeConfirm = null;
let focusBeforeMessage = null;

function returnFocusTo(element) {
    if (element && element !== document.body && element.isConnected) {
        element.focus();
        if (document.activeElement === element) return;
    }
    domainInput.focus();
}

function showCustomConfirm(message, callback) {
    if (!customConfirm.classList.contains('show')) {
        focusBeforeConfirm = document.activeElement;
    }
    confirmMessage.textContent = message;
    confirmCallback = callback;
    customConfirm.classList.add('show');
}

function hideCustomConfirm() {
    customConfirm.classList.remove('show');
    confirmCallback = null;
    const element = focusBeforeConfirm;
    focusBeforeConfirm = null;
    returnFocusTo(element);
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
    if (!customMessage.classList.contains('show')) {
        focusBeforeMessage = document.activeElement;
    }
    customMessage.classList.add('show');
}

function hideCustomMessage() {
    customMessage.classList.remove('show');
    const element = focusBeforeMessage;
    focusBeforeMessage = null;
    returnFocusTo(element);
}

messageButton.addEventListener('click', () => {
    hideCustomMessage();
});

customMessage.addEventListener('click', (e) => {
    if (e.target === customMessage) {
        hideCustomMessage();
    }
});
