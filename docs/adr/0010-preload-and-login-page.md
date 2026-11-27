---
status: accepted
---

# preload 插件和登录页的约定

## preload 的加载

- 沙箱里不能读目录，也不能 `require` 相对路径，插件只能在 `src/preload/index.ts` 静态导入，新增插件时加一行，保持字母序（和原来 `readdirSync` 的加载顺序一致）。静态导入先于 `index.ts` 的语句执行，注册钩子时插件都已加载。
- 登录页的桥（`loginPageApi.ts`）排在插件之前导入：插件顶层出错时登录页仍可用（`tests/preloadBundle.test.cjs`）。
- 沙箱里没有 `shell`，打开外部链接走 IPC，地址和来源由主进程校验（`src/main/ipc/app.ts`）。被拒的地址不写进日志：它由页面传入。
- macOS 的窗口按钮由系统绘制（`hiddenInset`），标题栏插件只保留透明拖动区域；其它平台用页面里的自定义窗口控制按钮。

## MPV 接管网页端播放

三个播放入口（详情页主播放键、卡片播放键、「继续观看」菜单项）都由接管 module（`src/preload/core/takeover.ts`，各播放入口的识别在 `playEntries.ts`）拦截：它只读一次 MPV 接管开关，在 `document` 捕获阶段注册唯一一组监听，按下、抬起和 click 的配对与去重只有一份。只有用户明确关闭 MPV 接管开关时才保留网页端原生播放；2 秒内读不到设置时照常接管，和开关的默认值一致（`docs/external-runtime.md`）。接管行为由 `tests/takeover.test.cjs` 在 happy-dom 里加载打包后的 preload、派发真实事件来测。播放请求只在从头播放时带 `restart` 标志，默认载荷和既有契约一致。`restart` 让主进程清除服务端进度，并从 0 秒拉起播放器。

### 详情页 URL

从新旧详情页 URL 取播放项标识时，按路由结构识别，不按 GUID 格式，服务端换标识格式时不会失效。标识段不能是路由关键字，`/v/tv/season`、`/v/tv/episode` 这类缺 guid 的路径不算详情页。`/v/tv/episode/<guid>`、folder、person、video、library 等页面不接管主播放键。兼容 `/#/v/...` 的 hash 路由和 query 参数。

### 详情页主播放键

- 网页端事实（从服务端 JS chunk 确认）：头部操作行是 `div.relative.flex.h-[54px].shrink-0.items-center.gap-2`，里面只有主播放键是 `button`（Semi Button，类含 `!min-w-[150px] !rounded-full`），收藏、已观看、更多都是 `div`。tv、season 页的主键文案是「第 N 季 第 M 集」「第 M 集」「未知集」等，不含「播放」，不能靠文案识别。
- 结构规则：文档顺序上第一个「是父元素的第一个子元素，且父元素带操作行类名（或自身带主键类名）」的 `button`，排除导航、页眉、侧栏、自定义标题栏和 play-mask 内的元素。只在详情页路由上跑，避免误标「收藏」。文案、图标规则在任何路由上都作兜底，任一命中即认定为主键。
- 已认定的主键先于卡片播放键识别，不依赖文案规则，否则 tv、season 页会拉起网页端原生播放器。主键加载中（disabled、文案「查询中」）时不触发播放。键盘 Enter、Space 和鼠标一样在捕获阶段拦截。
- 认定的主键记在接管 module 里，不写进 DOM。DOM 变化回调反复触发，它还在文档里时不重新识别。

### 首页「继续观看」菜单

- Semi Dropdown 把菜单 portal 到 `document.body`，菜单项向上找不到卡片。所以在捕获阶段监听卡片内「更多」触发器的 `pointerdown`（不拦截）记下 guid，菜单项被按下时消费。guid 只从卡片 DOM 取，不用当前页面 URL 兜底，否则可能播错项目。
- 记忆在超时（给足用户读菜单的时间）、菜单外任意按下、Escape 时清空；按下的是另一张卡片的「更多」时重新记忆。
- 接管后让菜单关闭：Semi 监听 `document` 的 `mousedown` 判断菜单外点击，派发一个以 `body` 为目标的合成事件，延后到本轮事件序列之后，避免菜单在 `click` 之前卸载、`click` 落到卡片上。
- 菜单文案分类是纯函数（`menuAction.ts`），不依赖 DOM 和 electron，可以直接在 `dest/` 上测：去掉全部空白并转小写后，「继续播放」是 `continue`，「从头开始播放」是 `restart`，其它（「移除」「删除」、空值）是 `null`，调用方不接管。
- 任何不在菜单项上的按下，包括按在卡片播放键上，都先让菜单忘掉记下的 guid，再交给被按下的播放入口；这个顺序由接管 module 保证，不依赖插件的加载顺序。「更多」触发器只被动记忆、不阻断传播。

## 登录页

- 凭据结果按请求配对：每次请求记下自己，await 之后不是最近一次请求，或用户已经改了表单，结果就丢弃；用户动过表单后以用户输入为准。解不开的凭据回复里是空值，表单留空让用户手动输入。
- IPC adapter 用 `isLoginPage`（`src/main/common/loginPage.ts`）自己再查一次 `senderFrame` 是不是登录页：preload 的 `file:` 判断在渲染进程里。路径用 `path.relative` 比较，它在 Windows 上不区分大小写，盘符写法不同也算同一个文件。
- 测试（`tests/helpers/loginPage.cjs`）用假 DOM 跑登录页真实的脚本。文件列表取自 `index.html` 的引用，还要和目录内容一致：新文件没接进页面或测试读漏时在这里失败，不会让 `doesNotMatch` 对着空内容通过。脚本按页面加载顺序逐个运行，不拼起来：拼接后函数提升会盖住顺序问题。
- FN ID 的判定只有一份（`src/public/fnId.ts`，不依赖 electron 和 Node 内置模块）：主进程直接导入，登录页经 preload 桥的 `electronAPI.isFnId` 同步调用。FN ID 会拼进 `https://5ddd.com/{fnId}`，只放行不改变 URL 结构的字符（6 到 30 位字母、数字、`_`、`-`）。FN Connect 页面的规则更严（小写字母开头，只含小写字母、数字和单个连字符），但那些规则是逐步加的，老 FN ID 可能不满足，这里不跟进，由 FN Connect 页面自己提示。
- 登录页的设置面板打开时经 `get-preferences` 读快照，之后显示主进程推送的偏好快照（`preferences-snapshot`），托盘改了偏好时随之更新，用户在面板里已改动的控件不被覆盖。保存只发相对快照改动过的偏好（`set-preferences`），没有改动就不发；主进程一次写入，返回保存后的快照，面板用它回显实际生效的值。应用更新下载加速地址留空时发空值，由主进程用默认地址。

## IPC 频道表（`src/public/ipcChannels.ts`、`src/main/ipc/`）

- 所有频道只登记在 `src/public/ipcChannels.ts` 一处：频道名、谁可以调用（只有登录页、只有网页端或两者），以及参数和结果的类型。它不依赖 electron，主进程和 preload 都导入它；登录页桥的放行列表就是表里对登录页开放的频道，接收方向只放行表里的推送频道。
- 页面发给主进程的一律是 invoke，有结果或错误；主进程主动推送的只有 `preferences-snapshot`。没有 send 加 reply 的配对，也没有 `ipcMain.on`：`on` 的处理器抛错会变成主进程未捕获异常，invoke 的错误由 Electron 转给调用方。
- 主进程的处理函数按领域放在 `src/main/ipc/` 下，`index.ts` 的 `startIpc` 把它们交给 adapter（`adapter.ts`）注册，类型要求表里每个频道都有处理函数。adapter 对每个请求依次做三件事：发送方不是主窗口，或调用来源不在表里允许的范围内，拒绝；处理函数的 `parse` 不接受参数（`InvalidPayload`），拒绝；处理函数出错时记日志后照常抛出。拒绝时记一条 warn，只写原因，不写参数（参数由页面传入，可能含凭据）。网页端指主窗口里登录页以外的页面；FN Connect 窗口不加载 preload，发不了 IPC。
- 频道表的约束由 `tests/ipcChannels.test.cjs` 经 adapter 的 interface 检查：每个频道都注册了、调用来源不对时拒绝、参数形状不对时拒绝。登录页测试的假桥（`tests/helpers/loginPage.cjs`）遇到不对登录页开放的频道直接失败。
- `play-movie` 不等一次播放结束才返回：处理函数开始一次播放就返回，播放中的重复请求只记日志。
- 播放请求的凭据只取自主进程的当前登录，不信任远程页面传进来的 token。
- preload 启动后报告自己加载的插件，主进程记一行进程号、沙箱状态和插件列表，手工冒烟靠这条判断沙箱和插件。`osSandboxed` 是系统层面的实际状态，Electron 只在 Windows 和 macOS 上提供。
