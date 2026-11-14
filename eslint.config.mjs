import tseslint from 'typescript-eslint';

const sharedRules = {
    eqeqeq: 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'no-empty': 'error',
    // 浏览器原生弹窗在 Electron 里不可靠，确认和输入走主进程的 dialog 或页面内组件。
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

// Electron 45 弃用、46 删除的 safeStorage 同步方法。
const SAFE_STORAGE_SYNC_PROPERTIES = [
    ['isEncryptionAvailable', 'isAsyncEncryptionAvailable'],
    ['encryptString', 'encryptStringAsync'],
    ['decryptString', 'decryptStringAsync'],
].map(([property, replacement]) => ({
    object: 'safeStorage',
    property,
    message: `safeStorage.${property} 在 Electron 46 删除，用 ${replacement}。`
}));

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

// 调用处拿 currentPlatform()、currentArch() 和字符串比较或 switch，就是把平台分支写在了 platform.ts 外面。
// 差异写进 platformBehavior() 或接收平台参数的纯函数，调用处只读结果（CODING_STANDARDS.md「平台差异」）。
// 先存进变量再比较的写法拦不住，留给审查。
const PLATFORM_FUNCTION = '/^current(Platform|Arch)$/';
const PLATFORM_BRANCH_MESSAGE = '平台分支写进 src/public/platform.ts 的 platformBehavior() 或接收平台参数的纯函数，调用处只读结果，不要比较 currentPlatform()、currentArch()。';
const PLATFORM_BRANCH_SYNTAX = [
    `BinaryExpression[left.callee.name=${PLATFORM_FUNCTION}]`,
    `BinaryExpression[right.callee.name=${PLATFORM_FUNCTION}]`,
    `SwitchStatement[discriminant.callee.name=${PLATFORM_FUNCTION}]`,
].map((selector) => ({ selector, message: PLATFORM_BRANCH_MESSAGE }));

// module.exports = 整体替换 export 的结果，新函数没加进表时运行时是 undefined，tsc 查不出。
const NO_MODULE_EXPORTS = {
    selector: "AssignmentExpression[left.object.name='module'][left.property.name='exports']",
    message: '用 ES export，不要写 module.exports =。'
};

// 退出收尾的先后顺序只由退出协调模块决定，before-quit 只在它那里监听；其它模块向它注册（src/modules/quit/quitCoordinator.ts）。
// 拦截的写法见 tests/eslintQuitRules.test.cjs。事件名先存进变量的写法拦不住，留给审查。
const QUIT_COORDINATOR_FILE = 'src/modules/quit/quitCoordinator.ts';
const NO_BEFORE_QUIT_LISTENER = {
    selector: [
        'CallExpression',
        ":matches([callee.object.name='app'], [callee.object.property.name='app'])",
        '[callee.property.name=/^(on|once|addListener|prependListener|prependOnceListener)$/]',
        ":matches([arguments.0.value='before-quit'], [arguments.0.quasis.0.value.cooked='before-quit'])",
    ].join(''),
    message: `before-quit 只在 ${QUIT_COORDINATOR_FILE} 监听。退出时要做的事向退出协调注册（initQuitCoordinator、onQuitStarted、provideInstallOnQuit），不要自己监听。`
};

// fn_api/core 由主进程和 Proxy 共用，Proxy 服务运行在 utilityProcess 里，两者都不能加载 electron。
// logger、cert_trust 和 fn_api 的主进程层会间接加载 electron，所以只允许引用 Node 内置模块、npm 包和 core 本身。
const NO_ELECTRON = {
    name: 'electron',
    message: 'fn_api/core 和 Proxy 服务不能引用 electron，依赖由调用方通过参数传入。'
};
const ELECTRON_FREE_HINT = '会间接加载 electron。fn_api/core 只引用 core 内的模块，Proxy 服务只引用 fn_api/core，日志和证书信任由调用方传入。';

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
            'no-restricted-syntax': ['error', NO_MODULE_EXPORTS, ...OS_IMPORT_SYNTAX, ...PLATFORM_BRANCH_SYNTAX, NO_BEFORE_QUIT_LISTENER],
            // safeStorage 同步方法的拦截见 tests/eslintSafeStorageRules.test.cjs。
            'no-restricted-properties': ['error', ...PLATFORM_PROPERTIES, ...SAFE_STORAGE_SYNC_PROPERTIES]
        }
    },
    {
        // 唯一监听 before-quit 的地方。
        files: [QUIT_COORDINATOR_FILE],
        rules: {
            'no-restricted-syntax': ['error', NO_MODULE_EXPORTS, ...OS_IMPORT_SYNTAX, ...PLATFORM_BRANCH_SYNTAX]
        }
    },
    {
        files: ['src/modules/fn_api/core/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [NO_ELECTRON],
                patterns: [{ regex: '^\\.\\./', message: `core 以外的模块${ELECTRON_FREE_HINT}` }]
            }]
        }
    },
    {
        files: ['src/modules/proxy_service/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [NO_ELECTRON],
                patterns: [{ regex: '^\\.\\./(?!fn_api/core(/|$))', message: `fn_api/core 以外的模块${ELECTRON_FREE_HINT}` }]
            }]
        }
    },
    {
        // 唯一读取当前平台的地方。
        files: ['src/public/platform.ts'],
        rules: {
            'no-restricted-syntax': ['error', NO_MODULE_EXPORTS, NO_BEFORE_QUIT_LISTENER],
            'no-restricted-properties': ['error', ...SAFE_STORAGE_SYNC_PROPERTIES]
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
