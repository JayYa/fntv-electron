

export function checkLibraryPageUrl(url: string) {
    if (!url) return false;
    return url.includes('/v/library/') || url.includes('/v/favorite') || url.includes('/v/list/') || url.includes('/v/folder/');
}