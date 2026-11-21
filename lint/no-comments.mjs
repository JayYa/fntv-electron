import path from 'node:path';

const DIRECTIVE = /^\s*(eslint-|eslint\s|global\s|globals\s|exported\s|@ts-)/;

function isDirective(comment) {
    return comment.type === 'Shebang' || DIRECTIVE.test(comment.value);
}

function relativeFile(context) {
    return path.relative(context.cwd, context.filename).split(path.sep).join('/');
}

function isBlank(line) {
    return line !== undefined && line.trim() === '';
}

function occupiesWholeLines(sourceCode, comment) {
    const lines = sourceCode.lines;
    const before = lines[comment.loc.start.line - 1].slice(0, comment.loc.start.column);
    const after = lines[comment.loc.end.line - 1].slice(comment.loc.end.column);
    return before.trim() === '' && after.trim() === '';
}

function removalRange(sourceCode, comment, next, runFirstLine) {
    const text = sourceCode.text;
    if (!occupiesWholeLines(sourceCode, comment)) {
        let start = comment.range[0];
        while (start > 0 && /[ \t]/.test(text[start - 1])) start--;
        return [start, comment.range[1]];
    }
    const lines = sourceCode.lines;
    const firstLine = comment.loc.start.line;
    const lastLine = comment.loc.end.line;
    const start = sourceCode.getIndexFromLoc({ line: firstLine, column: 0 });
    let end = lastLine < lines.length ? sourceCode.getIndexFromLoc({ line: lastLine + 1, column: 0 }) : text.length;
    const continues = next && next.loc.start.line === lastLine + 1 && occupiesWholeLines(sourceCode, next);
    const blankAbove = runFirstLine === 1 || isBlank(lines[runFirstLine - 2]);
    if (!continues && blankAbove && isBlank(lines[lastLine]) && lastLine + 1 < lines.length) {
        end = sourceCode.getIndexFromLoc({ line: lastLine + 2, column: 0 });
    }
    return [start, end];
}

function commentRunFirstLine(sourceCode, comments, index) {
    let i = index;
    while (i > 0 && comments[i - 1].loc.end.line === comments[i].loc.start.line - 1
        && occupiesWholeLines(sourceCode, comments[i - 1])) i--;
    return comments[i].loc.start.line;
}

export default {
    meta: {
        type: 'suggestion',
        fixable: 'code',
        schema: [{
            type: 'object',
            properties: {
                baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
                autofix: { type: 'boolean' }
            },
            additionalProperties: false
        }],
        messages: {
            comment: '不写注释：说明放进命名、测试或 docs/adr/（ADR-0007）。这个文件有 {{count}} 条注释，基线允许 {{allowed}} 条。',
            stale: '这个文件只剩 {{count}} 条注释，基线还是 {{allowed}} 条：运行 pnpm run comments:baseline 收紧基线。'
        }
    },
    create(context) {
        const { baseline = {}, autofix = false } = context.options[0] ?? {};
        const sourceCode = context.sourceCode;
        return {
            'Program:exit'(program) {
                const comments = sourceCode.getAllComments().filter((comment) => !isDirective(comment));
                const allowed = baseline[relativeFile(context)] ?? 0;
                const data = { count: comments.length, allowed };
                if (comments.length < allowed) {
                    context.report({ node: program, loc: { line: 1, column: 0 }, messageId: 'stale', data });
                    return;
                }
                if (comments.length === allowed) return;
                comments.forEach((comment, index) => {
                    const range = removalRange(sourceCode, comment, comments[index + 1], commentRunFirstLine(sourceCode, comments, index));
                    context.report({
                        loc: comment.loc,
                        messageId: 'comment',
                        data,
                        fix: autofix ? (fixer) => fixer.removeRange(range) : null
                    });
                });
            }
        };
    }
};
