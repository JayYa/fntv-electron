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

const PLATFORM_PROPERTIES = ['platform', 'arch'].map((property) => ({
    object: 'process',
    property,
    message: `用 src/public/platform.ts 的 currentPlatform()、currentArch() 和 platformBehavior()，不要直接读 process.${property}。`
}));

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
            // module.exports = 整体替换 export 的结果，新函数没加进表时运行时是 undefined，tsc 查不出。
            'no-restricted-syntax': ['error', {
                selector: "AssignmentExpression[left.object.name='module'][left.property.name='exports']",
                message: '用 ES export，不要写 module.exports =。'
            }],
            // 平台判断散在各处时，macOS 和 Linux 分支只能在对应系统上验证。集中到 platform.ts，
            // 由接收平台参数的纯函数决定，在 Windows 上也能测三条分支（tests/platform.test.cjs）。
            'no-restricted-properties': ['error', ...PLATFORM_PROPERTIES]
        }
    },
    {
        // 唯一读取当前平台的地方。
        files: ['src/public/platform.ts'],
        rules: {
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
