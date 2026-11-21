/* exported initVersionInfo, initProxySettings */

function initVersionInfo() {
    ipcRenderer.send('get-version');
}

function handleUpdateCheck() {
    const btn = updateBtn;
    const originalText = btn.textContent;
    
    btn.textContent = '检查中...';
    btn.classList.add('checking');
    btn.disabled = true;
    
    ipcRenderer.send('check-update');
    
    setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('checking');
        btn.disabled = false;
    }, 5000);
}

updateBtn.addEventListener('click', handleUpdateCheck);

ipcRenderer.on('version-info', (event, data) => {
    if (data && data.version) {
        versionText.textContent = `版本 ${data.version}`;
    }
});

function initProxySettings() {
    ipcRenderer.send('get-download-proxy');
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
    
    ipcRenderer.send('set-download-proxy', {
        enabled: enabled,
        proxyUrl: proxyUrl
    });

    ipcRenderer.send('set-play-button-config', { hideOriginalPlayButton });
    
    const originalText = proxySaveBtn.textContent;
    proxySaveBtn.textContent = '保存中...';
    proxySaveBtn.disabled = true;
    
    setTimeout(() => {
        proxySaveBtn.textContent = originalText;
        proxySaveBtn.disabled = false;
        closeProxyPanel();
    }, 1000);
}

proxySettingsBtn.addEventListener('click', toggleProxyPanel);
proxyCloseBtn.addEventListener('click', closeProxyPanel);
proxySaveBtn.addEventListener('click', saveProxySettings);

document.addEventListener('click', (e) => {
    if (!proxyPanel.contains(e.target) && !proxySettingsBtn.contains(e.target)) {
        closeProxyPanel();
    }
});

ipcRenderer.on('download-proxy-info', (event, data) => {
    if (data) {
        proxyEnabledSwitch.checked = data.enabled === true;
        proxyUrlInput.value = data.proxyUrl;
        proxyUrlInput.placeholder = data.defaultProxyUrl;
    }
});

ipcRenderer.on('play-button-config-info', (event, data) => {
    if (data) {
        hideOriginalPlayButtonSwitch.checked = data.hideOriginalPlayButton !== false;
    }
});

ipcRenderer.on('download-proxy-set', (event, data) => {
    if (data && data.success) {
        window.log.info('代理设置保存成功');
        ipcRenderer.send('get-download-proxy');
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
