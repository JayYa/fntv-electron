// 更新提示框是原生对话框，只能显示纯文本，也不能滚动，正文过长会把按钮挤出屏幕。
const MAX_LINES = 25;
const MAX_CHARS = 1300;

const NO_NOTES = '暂无更新说明';
const TRUNCATION_HINT = '更多内容请点“查看详情”打开 Release 页面查看。';

// release-please 的版本标题：`## [2.7.0](compare 链接) (日期)`，首个版本没有 compare 链接。
const VERSION_HEADING = /^#{1,3}\s+\[?v?\d+\.\d+\.\d+[^\]\s]*\]?/;
const HEADING = /^#{1,6}\s+/;
const LIST_ITEM = /^(\s*)[*+-]\s+/;
// release-please 条目开头的 `**scope:** `，只认条目开头，正文里的冒号不动
const SCOPE_PREFIX = /^(\s*[*+-]\s+)\*\*[^*:]+:\*\*\s*/;
// 条目末尾的 `([abc1234](commit 链接))` 和 `([#12](issue 链接))`
const COMMIT_OR_PR_REF = /\s*\(\[(?:[0-9a-f]{7,40}|#\d+)\]\([^)]*\)\)/g;
// 提交正文里 `Closes #12` 生成的 `, closes [#12](链接) [#13](链接)`
const CLOSES_REFS = /,\s*closes(?:\s+\[#\d+\]\([^)]*\))+/gi;
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g;

function toPlainLine(line: string): string {
    let text = line
        .replace(SCOPE_PREFIX, '$1')
        .replace(COMMIT_OR_PR_REF, '')
        .replace(CLOSES_REFS, '')
        .replace(LINK, '$1')
        .replace(/\*\*/g, '')
        .replace(/`/g, '');
    text = text.replace(HEADING, '').replace(LIST_ITEM, '$1• ');
    return text.trimEnd();
}

function plainLines(body: string): string[] {
    const lines: string[] = [];
    let afterHeading = false;
    for (const raw of body.split(/\r?\n/)) {
        if (VERSION_HEADING.test(raw)) continue;
        const line = toPlainLine(raw);
        if (line.trim() === '') {
            // 标题下的空行和连续空行都不保留
            if (!afterHeading && lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
            continue;
        }
        lines.push(line);
        afterHeading = HEADING.test(raw);
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
}

function truncate(lines: string[]): string {
    const text = lines.join('\n');
    if (lines.length <= MAX_LINES && text.length <= MAX_CHARS) return text;

    let kept = lines.slice(0, MAX_LINES).join('\n');
    if (kept.length > MAX_CHARS) kept = Array.from(kept).slice(0, MAX_CHARS).join('');
    return `${kept.trimEnd()}\n…\n${TRUNCATION_HINT}`;
}

/**
 * 把 GitHub Release 的 Markdown 正文转成更新提示框里显示的纯文本。
 */
export function formatReleaseNotes(body: string | null | undefined): string {
    const lines = plainLines(body ?? '');
    return lines.length === 0 ? NO_NOTES : truncate(lines);
}
