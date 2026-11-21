window.addEventListener('DOMContentLoaded', function () {
    loadConfigData();
    initVersionInfo();
    initProxySettings();
    
    setTimeout(() => {
        domainInput.focus();
    }, 500);
});
