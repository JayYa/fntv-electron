const LOG_METHOD = /^(debug|info|warn|error)$/;
const LOGGER_NAME = /^(log|logger|[a-zA-Z]+Logger)$/;
const ADDRESS_NAME = /^(baseUrl|origin|host|hostname|domain)$|[a-z](BaseUrl|Origin|Host|Hostname|Domain)$/;

function nameOf(node) {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression' && !node.computed) return node.property.name;
    return null;
}

function isLogCall(node) {
    const callee = node.callee;
    if (callee.type !== 'MemberExpression' || callee.computed || !LOG_METHOD.test(callee.property.name)) return false;
    const owner = nameOf(callee.object);
    return owner !== null && LOGGER_NAME.test(owner);
}

function* addressNames(node) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
        case 'Identifier':
            if (ADDRESS_NAME.test(node.name)) yield node;
            return;
        case 'MemberExpression':
            yield* addressNames(node.object);
            if (node.computed) yield* addressNames(node.property);
            else if (ADDRESS_NAME.test(node.property.name)) yield node.property;
            return;
        case 'CallExpression':
            yield* addressNames(node.callee.type === 'MemberExpression' ? node.callee.object : null);
            return;
        case 'Property':
            yield* addressNames(node.computed ? node.key : null);
            yield* addressNames(node.value);
            return;
        case 'TemplateLiteral':
            for (const expression of node.expressions) yield* addressNames(expression);
            return;
        case 'ObjectExpression':
            for (const property of node.properties) yield* addressNames(property);
            return;
        case 'ArrayExpression':
            for (const element of node.elements) yield* addressNames(element);
            return;
        case 'SpreadElement':
        case 'TSAsExpression':
        case 'TSNonNullExpression':
        case 'ChainExpression':
            yield* addressNames(node.argument ?? node.expression);
            return;
        case 'BinaryExpression':
            if (node.operator !== '+') return;
            yield* addressNames(node.left);
            yield* addressNames(node.right);
            return;
        case 'LogicalExpression':
            yield* addressNames(node.left);
            yield* addressNames(node.right);
            return;
        case 'ConditionalExpression':
            yield* addressNames(node.consequent);
            yield* addressNames(node.alternate);
            return;
        default:
            return;
    }
}

export default {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            address: '{{name}} 像是 NAS 地址，完整 NAS 地址不进日志（CODING_STANDARDS.md），日志脱敏只是兜底。去掉它，或者先交给 mask*/describe* 这类函数处理后再写。'
        }
    },
    create(context) {
        return {
            CallExpression(node) {
                if (!isLogCall(node)) return;
                for (const argument of node.arguments) {
                    for (const found of addressNames(argument)) {
                        context.report({ node: found, messageId: 'address', data: { name: found.name } });
                    }
                }
            }
        };
    }
};
