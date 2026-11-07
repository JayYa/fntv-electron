/* exported initVersionInfo, initProxySettings */

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
        proxyEnabledSwitch.checked = data.enabled === true; // 默认关闭
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
