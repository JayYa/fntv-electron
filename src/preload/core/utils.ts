function checkFinalPageUrl() {
    const url = window.location.href;
    return url.includes('/v/movie/') || url.includes('/v/tv/episode/') || url.includes('/v/other/');
}

function checkSeasonPageUrl() {
    const url = window.location.href;
    return url.includes('/v/tv/season/');
}

function checkTVPageUrl() {
    const url = window.location.href;
    return url.includes('/v/tv/');
}

export { checkFinalPageUrl, checkSeasonPageUrl, checkTVPageUrl };
