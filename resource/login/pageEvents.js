document.addEventListener('click', function(e) {
    if (e.target.classList.contains('github-link')) {
        e.preventDefault();
        const url = e.target.href;
        window.electronAPI.openExternal(url).catch((error) => {
            window.log.error('打开外部链接失败:', error);
        });
    }
});

document.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
});

document.addEventListener('drag', function(e) {
    e.preventDefault();
    return false;
});

document.addEventListener('dragend', function(e) {
    e.preventDefault();
    return false;
});
