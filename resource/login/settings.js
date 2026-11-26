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

let shownPreferences = null;

function initPreferences() {
    ipcRenderer.send('get-preferences');
}

function applyPreferences(snapshot, { overwriteEdits = false } = {}) {
    const before = shownPreferences;
    const untouched = (control, property, value) => overwriteEdits || !before || control[property] === value;
    if (untouched(proxyEnabledSwitch, 'checked', before?.appDownloadProxy.enabled)) {
        proxyEnabledSwitch.checked = snapshot.appDownloadProxy.enabled;
    }
    if (untouched(proxyUrlInput, 'value', before?.appDownloadProxy.proxyUrl)) {
        proxyUrlInput.value = snapshot.appDownloadProxy.proxyUrl;
    }
    if (untouched(mpvPlaybackSwitch, 'checked', before?.mpvPlayback)) {
        mpvPlaybackSwitch.checked = snapshot.mpvPlayback;
    }
    proxyUrlInput.placeholder = snapshot.defaultProxyUrl;
    shownPreferences = snapshot;
}

function changedPreferences() {
    const patch = {};
    const appDownloadProxy = { enabled: proxyEnabledSwitch.checked, proxyUrl: proxyUrlInput.value.trim() };
    const shownProxy = shownPreferences?.appDownloadProxy;
    if (!shownProxy || appDownloadProxy.enabled !== shownProxy.enabled || appDownloadProxy.proxyUrl !== shownProxy.proxyUrl.trim()) {
        patch.appDownloadProxy = appDownloadProxy;
    }
    if (!shownPreferences || mpvPlaybackSwitch.checked !== shownPreferences.mpvPlayback) {
        patch.mpvPlayback = mpvPlaybackSwitch.checked;
    }
    return patch;
}

function toggleProxyPanel() {
    proxyPanel.classList.toggle('show');
}

function closeProxyPanel() {
    proxyPanel.classList.remove('show');
}

async function requestSavePreferences(patch) {
    try {
        const result = await ipcRenderer.invoke('set-preferences', patch);
        if (result && result.success) return { preferences: result.preferences };
        return { failure: (result && result.error) || '未知错误' };
    } catch (error) {
        window.log.error('保存设置请求失败:', error);
        return { failure: '未知错误' };
    }
}

async function savePreferences() {
    if (proxySaveBtn.disabled) return;
    const patch = changedPreferences();
    if (Object.keys(patch).length === 0) {
        closeProxyPanel();
        return;
    }

    const originalText = proxySaveBtn.textContent;
    proxySaveBtn.textContent = '保存中...';
    proxySaveBtn.disabled = true;

    const { preferences, failure } = await requestSavePreferences(patch);

    proxySaveBtn.textContent = originalText;
    proxySaveBtn.disabled = false;
    if (failure) {
        window.log.error('设置保存失败:', failure);
        showCustomMessage('error', '保存失败', `设置没有保存：${failure}`);
        return;
    }
    window.log.info('设置保存成功');
    applyPreferences(preferences, { overwriteEdits: true });
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

ipcRenderer.on('preferences-snapshot', (event, snapshot) => {
    if (snapshot) applyPreferences(snapshot);
});
