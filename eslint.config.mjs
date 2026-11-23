import fs from 'node:fs';
import tseslint from 'typescript-eslint';
import noComments from './lint/no-comments.mjs';
import noNasAddressLog from './lint/no-nas-address-log.mjs';

const COMMENT_BASELINE = JSON.parse(fs.readFileSync(new URL('./lint/comment-baseline.json', import.meta.url), 'utf8'));

const sharedRules = {
    eqeqeq: 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'no-empty': 'error',
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

const PLATFORM_INDEX_FILE = 'src/public/platform/index.ts';
const PLATFORM_HINT = `用 ${PLATFORM_INDEX_FILE} 的 currentPlatform()、currentArch() 和 platformBehavior()`;

const PLATFORM_PROPERTIES = [
    ...['process', 'os'].flatMap((object) => ['platform', 'arch'].map((property) => ({ object, property }))),
    { object: 'navigator', property: 'platform' },
].map(({ object, property }) => ({
    object,
    property,
    message: `${PLATFORM_HINT}，不要直接读 ${object}.${property}。`
}));

const SAFE_STORAGE_SYNC_PROPERTIES = [
    ['isEncryptionAvailable', 'isAsyncEncryptionAvailable'],
    ['encryptString', 'encryptStringAsync'],
    ['decryptString', 'decryptStringAsync'],
].map(([property, replacement]) => ({
    object: 'safeStorage',
    property,
    message: `safeStorage.${property} 在 Electron 46 删除，用 ${replacement}。`
}));

const IPC_HANDLER_FILE = 'src/main/handlers/core/ipcHandler.ts';
const IPC_REGISTER_PROPERTIES = ['handle', 'handleOnce', 'on', 'once', 'addListener', 'prependListener', 'prependOnceListener'].map((property) => ({
    object: 'ipcMain',
    property,
    message: `IPC 处理器用 ${IPC_HANDLER_FILE} 的 registerHandler 注册，不要直接调用 ipcMain.${property}。`
}));

const OS_MODULE = '/^(node:)?os$/';
const OS_PLATFORM_MEMBER = '/^(platform|arch)$/';
const OS_IMPORT_SYNTAX = [
    {
        selector: `ImportDeclaration[source.value=${OS_MODULE}] > ImportSpecifier[imported.name=${OS_PLATFORM_MEMBER}]`,
        message: `${PLATFORM_HINT}，不要从 os 导入 platform 或 arch。`
    },
    {
        selector: `ImportDeclaration[source.value=${OS_MODULE}] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)[local.name!='os']`,
        message: 'os 模块只用 os 这个名字导入，否则 src/public/platform/index.ts 以外的 os.platform()、os.arch() 检查拦不住。'
    },
    {
        selector: `VariableDeclarator[init.callee.name='require'][init.arguments.0.value=${OS_MODULE}][id.type='Identifier'][id.name!='os']`,
        message: 'os 模块只用 os 这个名字导入，否则 src/public/platform/index.ts 以外的 os.platform()、os.arch() 检查拦不住。'
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

const PLATFORM_FUNCTION = '/^current(Platform|Arch)$/';
const PLATFORM_NAME = '/^(win32|darwin|linux)$/';
const PLATFORM_BRANCH_MESSAGE = '平台差异写进 src/public/platform/ 下对应平台的文件，由 index.ts 查表选取，调用处只读结果，不要比较平台。';
const PLATFORM_BRANCH_SYNTAX = [
    `BinaryExpression[left.callee.name=${PLATFORM_FUNCTION}]`,
    `BinaryExpression[right.callee.name=${PLATFORM_FUNCTION}]`,
    `SwitchStatement[discriminant.callee.name=${PLATFORM_FUNCTION}]`,
    `BinaryExpression[operator=/^[!=]==?$/][left.value=${PLATFORM_NAME}]`,
    `BinaryExpression[operator=/^[!=]==?$/][right.value=${PLATFORM_NAME}]`,
    `SwitchCase[test.value=${PLATFORM_NAME}]`,
].map((selector) => ({ selector, message: PLATFORM_BRANCH_MESSAGE }));

const NO_MODULE_EXPORTS = {
    selector: "AssignmentExpression[left.object.name='module'][left.property.name='exports']",
    message: '用 ES export，不要写 module.exports =。'
};

const QUIT_COORDINATOR_FILE = 'src/modules/quit/quitCoordinator.ts';
const LISTENER_METHOD = '[callee.property.name=/^(on|once|addListener|prependListener|prependOnceListener)$/]';
const NO_BEFORE_QUIT_LISTENER = {
    selector: [
        'CallExpression',
        ":matches([callee.object.name='app'], [callee.object.property.name='app'])",
        LISTENER_METHOD,
        ":matches([arguments.0.value='before-quit'], [arguments.0.quasis.0.value.cooked='before-quit'])",
    ].join(''),
    message: `before-quit 只在 ${QUIT_COORDINATOR_FILE} 监听。退出时要做的事向退出协调注册（initQuitCoordinator、onQuitStarted、provideInstallOnQuit），不要自己监听。`
};

const NO_SHUTDOWN_LISTENER = {
    selector: [
        'CallExpression',
        LISTENER_METHOD,
        ':matches(',
        "[arguments.0.value='session-end'], [arguments.0.quasis.0.value.cooked='session-end'],",
        ":matches([callee.object.name='powerMonitor'], [callee.object.property.name='powerMonitor'])",
        ":matches([arguments.0.value='shutdown'], [arguments.0.quasis.0.value.cooked='shutdown'])",
        ')',
    ].join(''),
    message: `系统关机信号（session-end、powerMonitor 的 shutdown）只在 ${QUIT_COORDINATOR_FILE} 监听（listenForSystemShutdown），不要自己监听。`
};

const INTERCEPTOR_FILE = 'src/main/handlers/core/interceptor.ts';
const NO_BEFORE_REQUEST_LISTENER = {
    selector: "MemberExpression[property.name='onBeforeRequest']",
    message: `同一个 session 上 webRequest.onBeforeRequest 只保留最后注册的监听器（#302），拦截器用 ${INTERCEPTOR_FILE} 的 registerBeforeRequest 注册。`
};

const SRC_RESTRICTED_SYNTAX = [NO_MODULE_EXPORTS, ...OS_IMPORT_SYNTAX, ...PLATFORM_BRANCH_SYNTAX];
const SRC_RULE_SYNTAX = [...SRC_RESTRICTED_SYNTAX, NO_BEFORE_QUIT_LISTENER, NO_SHUTDOWN_LISTENER];

const LOGGER_DIR = 'src/modules/logger';
const NO_CONSOLE = {
    name: 'console',
    message: `日志写进 ${LOGGER_DIR} 的日志器，它按 ADR-0014 脱敏；console 绕过脱敏，CI 启动失败时 stdout 还会上传成 artifact。`
};

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
        files: ['**/*.{ts,js,cjs,mjs}'],
        plugins: {
            local: { rules: { 'no-comments': noComments } }
        },
        rules: {
            'local/no-comments': ['error', { baseline: COMMENT_BASELINE }]
        }
    },
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs'
        }
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            sourceType: 'module'
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            nas: { rules: { 'no-address-log': noNasAddressLog } }
        },
        rules: {
            ...sharedRules,
            'nas/no-address-log': 'error',
            'no-restricted-globals': ['error', NO_CONSOLE],
            'no-restricted-syntax': ['error', ...SRC_RULE_SYNTAX, NO_BEFORE_REQUEST_LISTENER],
            'no-restricted-properties': ['error', ...PLATFORM_PROPERTIES, ...SAFE_STORAGE_SYNC_PROPERTIES, ...IPC_REGISTER_PROPERTIES]
        }
    },
    {
        files: [`${LOGGER_DIR}/**/*.ts`, 'src/preload/core/logger.ts'],
        rules: {
            'no-restricted-globals': 'off'
        }
    },
    {
        files: [IPC_HANDLER_FILE],
        rules: {
            'no-restricted-properties': ['error', ...PLATFORM_PROPERTIES, ...SAFE_STORAGE_SYNC_PROPERTIES]
        }
    },
    {
        files: [QUIT_COORDINATOR_FILE],
        rules: {
            'no-restricted-syntax': ['error', ...SRC_RESTRICTED_SYNTAX, NO_BEFORE_REQUEST_LISTENER]
        }
    },
    {
        files: [INTERCEPTOR_FILE],
        rules: {
            'no-restricted-syntax': ['error', ...SRC_RULE_SYNTAX]
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
        files: [PLATFORM_INDEX_FILE],
        rules: {
            'no-restricted-syntax': ['error', NO_MODULE_EXPORTS, ...PLATFORM_BRANCH_SYNTAX, NO_BEFORE_QUIT_LISTENER, NO_SHUTDOWN_LISTENER, NO_BEFORE_REQUEST_LISTENER],
            'no-restricted-properties': ['error', ...SAFE_STORAGE_SYNC_PROPERTIES, ...IPC_REGISTER_PROPERTIES]
        }
    },
    {
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
        files: ['tests/**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs'
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin
        },
        rules: {
            ...sharedRules,
            'no-restricted-properties': ['error', {
                property: '_load',
                message: '替换 require 的模块用 tests/helpers/fakeElectron.cjs：useFakeElectron、useFakeModule 或 withoutElectron。'
            }]
        }
    },
    {
        files: ['tests/helpers/fakeElectron.cjs'],
        rules: {
            'no-restricted-properties': 'off'
        }
    }
];
