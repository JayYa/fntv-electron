/* exported initVersionInfo, initPreferences */

function initVersionInfo() {
    ipcRenderer.send('get-version');
}

async function handleUpdateCheck() {
    if (updateBtn.disabled) return;
    const originalText = updateBtn.textContent;

    updateBtn.textContent = '检查中...';
    updateBtn.classList.add('checking');
    updateBtn.disabled = true;

    try {
        await ipcRenderer.invoke('check-update');
    } catch (error) {
        window.log.error('检查更新失败:', error);
        showCustomMessage('error', '检查更新失败', '检查更新时发生错误，请稍后重试。');
    } finally {
        updateBtn.textContent = originalText;
        updateBtn.classList.remove('checking');
        updateBtn.disabled = false;
    }
}

updateBtn.addEventListener('click', handleUpdateCheck);

ipcRenderer.on('version-info', (event, data) => {
    if (data && data.version) {
        versionText.textContent = `版本 ${data.version}`;
    }
});

function initPreferences() {
    ipcRenderer.send('get-download-proxy');
    ipcRenderer.send('get-mpv-playback');
}

function toggleProxyPanel() {
    proxyPanel.classList.toggle('show');
}

function closeProxyPanel() {
    proxyPanel.classList.remove('show');
}

async function requestSavePreferences(downloadProxy, mpvPlaybackRequest) {
    try {
        const results = await Promise.all([
            ipcRenderer.invoke('set-download-proxy', downloadProxy),
            ipcRenderer.invoke('set-mpv-playback', mpvPlaybackRequest),
        ]);
        const failed = results.find((result) => !result || !result.success);
        return failed ? failed.error || '未知错误' : null;
    } catch (error) {
        window.log.error('保存设置请求失败:', error);
        return '未知错误';
    }
}

async function savePreferences() {
    if (proxySaveBtn.disabled) return;
    const downloadProxy = {
        enabled: proxyEnabledSwitch.checked,
        proxyUrl: proxyUrlInput.value.trim(),
    };
    const mpvPlaybackRequest = { mpvPlayback: mpvPlaybackSwitch.checked };

    const originalText = proxySaveBtn.textContent;
    proxySaveBtn.textContent = '保存中...';
    proxySaveBtn.disabled = true;

    const failure = await requestSavePreferences(downloadProxy, mpvPlaybackRequest);

    proxySaveBtn.textContent = originalText;
    proxySaveBtn.disabled = false;
    if (failure) {
        window.log.error('设置保存失败:', failure);
        showCustomMessage('error', '保存失败', `设置没有保存：${failure}`);
        return;
    }
    window.log.info('设置保存成功');
    ipcRenderer.send('get-download-proxy');
    closeProxyPanel();
}

proxySettingsBtn.addEventListener('click', toggleProxyPanel);
proxyCloseBtn.addEventListener('click', closeProxyPanel);
proxySaveBtn.addEventListener('click', savePreferences);

document.addEventListener('click', (e) => {
    if (!proxyPanel.contains(e.target) && !proxySettingsBtn.contains(e.target) && !customMessage.contains(e.target)) {
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

ipcRenderer.on('mpv-playback-info', (event, data) => {
    if (data) {
        mpvPlaybackSwitch.checked = data.mpvPlayback !== false;
    }
});
