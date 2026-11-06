// 页面加载完成后读取配置
window.addEventListener('DOMContentLoaded', function () {
    loadConfigData();
    initVersionInfo(); // 初始化版本信息
    initProxySettings(); // 初始化代理设置
    
    // 确保页面加载后域名输入框能够正确获取焦点
    setTimeout(() => {
        domainInput.focus();
    }, 500);
});
