const DIRECTIVE = /^\s*(eslint-|eslint\s|global\s|globals\s|exported\s|@ts-)/;

function isDirective(comment) {
    return comment.type === 'Shebang' || DIRECTIVE.test(comment.value);
}

export default {
    meta: {
        type: 'suggestion',
        schema: [],
        messages: {
            comment: '不写注释：说明放进命名、测试或 docs/adr/（ADR-0007）。'
        }
    },
    create(context) {
        return {
            'Program:exit'() {
                for (const comment of context.sourceCode.getAllComments()) {
                    if (!isDirective(comment)) context.report({ loc: comment.loc, messageId: 'comment' });
                }
            }
        };
    }
};
