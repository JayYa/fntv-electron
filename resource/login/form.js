/* exported restoreFocus */

function restoreFocus() {
    try {
        domainInput.disabled = false;
        domainInput.readOnly = false;
        
        domainInput.focus();
        domainInput.select();
        
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        domainInput.dispatchEvent(clickEvent);
        
        if (domainInput.setSelectionRange) {
            const len = domainInput.value.length;
            domainInput.setSelectionRange(len, len);
        }
    } catch (error) {
        window.log.error('恢复焦点失败:', error);
    }
}

function isFnId(value) {
    return /^[A-Za-z0-9_-]{6,30}$/.test(value);
}

function isValidDomainOrIP(value) {
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

loginBtn.addEventListener('click', function () {
    if (loginBtn.disabled) return;
    
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

    ipcRenderer.send('login', loginData);
    
    const timeoutId = setTimeout(() => {
        loginBtn.textContent = originalText;
        checkInputs();
    }, 5000);
    
    const handleLoginResult = () => {
        clearTimeout(timeoutId);
        loginBtn.textContent = originalText;
        checkInputs();
    };
    
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

document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !loginBtn.disabled) {
        loginBtn.click();
    }
});

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
