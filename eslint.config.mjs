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
            }]
        }
    },
    {
        // 登录页用普通 <script> 加载，不是模块。
        files: ['resource/login/index.js'],
        languageOptions: {
            parser: tseslint.parser,
            sourceType: 'script'
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin
        },
        rules: sharedRules
    }
];
