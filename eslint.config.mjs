import tseslint from 'typescript-eslint';

const sharedRules = {
    eqeqeq: 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'no-empty': 'error',
    // 浏览器原生弹窗在 Electron 里不可靠，见 CODING_STANDARDS.md 的“进程边界”。
    'no-alert': 'error',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true
    }]
};

const PLATFORM_HINT = '用 src/public/platform.ts 的 currentPlatform()、currentArch() 和 platformBehavior()';

// process.platform、process.arch，以及 os.platform()、os.arch()。
const PLATFORM_PROPERTIES = ['process', 'os'].flatMap((object) => ['platform', 'arch'].map((property) => ({
    object,
    property,
    message: `${PLATFORM_HINT}，不要直接读 ${object}.${property}。`
})));

// no-restricted-properties 只认对象名，os 模块换个写法导入就拦不住，这里把其它写法也禁掉。
const OS_MODULE = '/^(node:)?os$/';
const OS_PLATFORM_MEMBER = '/^(platform|arch)$/';
// 不用 no-restricted-imports 的 importNames：它连 import * as os 也一起拦下。
const OS_IMPORT_SYNTAX = [
    {
        selector: `ImportDeclaration[source.value=${OS_MODULE}] > ImportSpecifier[imported.name=${OS_PLATFORM_MEMBER}]`,
        message: `${PLATFORM_HINT}，不要从 os 导入 platform 或 arch。`
    },
    {
        selector: `ImportDeclaration[source.value=${OS_MODULE}] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)[local.name!='os']`,
        message: 'os 模块只用 os 这个名字导入，否则 platform.ts 以外的 os.platform()、os.arch() 检查拦不住。'
    },
    {
        selector: `VariableDeclarator[init.callee.name='require'][init.arguments.0.value=${OS_MODULE}][id.type='Identifier'][id.name!='os']`,
        message: 'os 模块只用 os 这个名字导入，否则 platform.ts 以外的 os.platform()、os.arch() 检查拦不住。'
    },
    {
        selector: `MemberExpression[object.callee.name='require'][object.arguments.0.value=${OS_MODULE}][property.name=${OS_PLATFORM_MEMBER}]`,
        message: `${PLATFORM_HINT}，不要直接调用 os.platform() 或 os.arch()。`
    },
    {
        selector: `VariableDeclarator[init.callee.name='require'][init.arguments.0.value=${OS_MODULE}] > ObjectPattern > Property[key.name=${OS_PLATFORM_MEMBER}]`,
        message: `${PLATFORM_HINT}，不要从 os 解构 platform 或 arch。`
    }
];

// module.exports = 整体替换 export 的结果，新函数没加进表时运行时是 undefined，tsc 查不出。
const NO_MODULE_EXPORTS = {
    selector: "AssignmentExpression[left.object.name='module'][left.property.name='exports']",
    message: '用 ES export，不要写 module.exports =。'
};

export default [
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error'
        }
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            sourceType: 'module'
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin
        },
        rules: {
            ...sharedRules,
            // 平台判断散在各处时，macOS 和 Linux 分支只能在对应系统上验证。集中到 platform.ts，
            // 由接收平台参数的纯函数决定，在 Windows 上也能测三条分支（tests/platform.test.cjs）。
            // 各种写法的拦截见 tests/eslintPlatformRules.test.cjs。
            'no-restricted-syntax': ['error', NO_MODULE_EXPORTS, ...OS_IMPORT_SYNTAX],
            'no-restricted-properties': ['error', ...PLATFORM_PROPERTIES]
        }
    },
    {
        // 唯一读取当前平台的地方。
        files: ['src/public/platform.ts'],
        rules: {
            'no-restricted-syntax': ['error', NO_MODULE_EXPORTS],
            'no-restricted-properties': 'off'
        }
    },
    {
        // 登录页用普通 <script> 加载，不是模块。
        files: ['resource/login/*.js'],
        languageOptions: {
            parser: tseslint.parser,
            sourceType: 'script'
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin
        },
        rules: sharedRules
    },
    {
        // 测试和冒烟测试脚本，CommonJS，在 Node 里运行。
        files: ['tests/**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs'
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin
        },
        rules: sharedRules
    }
];
