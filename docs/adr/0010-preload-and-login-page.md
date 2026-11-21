---
status: accepted
---

# preload 插件和登录页的约定

## preload 的加载

- 沙箱里不能读目录，也不能 `require` 相对路径，插件只能在 `src/preload/index.ts` 静态导入，新增插件时加一行，保持字母序（和原来 `readdirSync` 的加载顺序一致）。静态导入先于 `index.ts` 的语句执行，注册钩子时插件都已加载。
- 登录页的桥（`loginPageApi.ts`）排在插件之前导入：插件顶层出错时登录页仍可用（`tests/preloadBundle.test.cjs`）。
- 沙箱里没有 `shell`，打开外部链接走 IPC，地址和来源由主进程校验（`src/main/handlers/plugins/externalLink.ts`）。
- macOS 的窗口按钮由系统绘制（`hiddenInset`），标题栏插件只保留透明拖动区域；其它平台用页面里的自定义窗口控制按钮。

## MPV 接管网页端播放

只有用户明确启用 MPV 时才接管；读取设置失败时保留网页端原生播放。播放请求只在从头播放时带 `restart` 标志，默认载荷和既有契约一致。

### 详情页 URL

从新旧详情页 URL 取播放项标识时，按路由结构识别，不按 GUID 格式，服务端换标识格式时不会失效。标识段不能是路由关键字，`/v/tv/season`、`/v/tv/episode` 这类缺 guid 的路径不算详情页。`/v/tv/episode/<guid>`、folder、person、video、library 等页面不接管主播放键。兼容 `/#/v/...` 的 hash 路由和 query 参数。

### 详情页主播放键（`playButton.ts`、`playMaskButton.ts`）

- 网页端事实（从服务端 JS chunk 确认）：头部操作行是 `div.relative.flex.h-[54px].shrink-0.items-center.gap-2`，里面只有主播放键是 `button`（Semi Button，类含 `!min-w-[150px] !rounded-full`），收藏、已观看、更多都是 `div`。tv、season 页的主键文案是「第 N 季 第 M 集」「第 M 集」「未知集」等，不含「播放」，不能靠文案识别。
- 结构规则：文档顺序上第一个「是父元素的第一个子元素，且父元素带操作行类名（或自身带主键类名）」的 `button`，排除导航、页眉、侧栏、自定义标题栏和 play-mask 内的元素。只在详情页路由上跑，避免误标「收藏」。文案、图标规则在任何路由上都作兜底，任一命中即打标。
- 已打标的主键优先拦截，不依赖文案规则，否则 tv、season 页会拉起网页端原生播放器。主键加载中（disabled、文案「查询中」）时不触发播放。键盘 Enter、Space 和鼠标一样在捕获阶段拦截。
- DOM 变化回调反复触发，已打标的按钮还在文档里时不重新识别。

### 首页「继续观看」菜单（`continueWatchingMenu.ts`、`menuAction.ts`）

- Semi Dropdown 把菜单 portal 到 `document.body`，菜单项向上找不到卡片。所以在捕获阶段监听卡片内「更多」触发器的 `pointerdown`（不拦截）记下 guid，菜单项被按下时消费。guid 只从卡片 DOM 取，不用当前页面 URL 兜底，否则可能播错项目。
- 记忆在超时（给足用户读菜单的时间）、菜单外任意按下、Escape 时清空；按下的是另一张卡片的「更多」时重新记忆。
- 接管后让菜单关闭：Semi 监听 `document` 的 `mousedown` 判断菜单外点击，派发一个以 `body` 为目标的合成事件，延后到本轮事件序列之后，避免菜单在 `click` 之前卸载、`click` 落到卡片上。
- 菜单文案分类是纯函数（`menuAction.ts`），不依赖 DOM 和 electron，可以直接在 `dest/` 上测：去掉全部空白并转小写后，「继续播放」是 `continue`，「从头开始播放」是 `restart`，其它（「移除」「删除」、空值）是 `null`，调用方不接管。
- 不依赖插件的加载顺序：它和播放键拦截的目标互斥，「更多」触发器只被动记忆、不阻断传播。

## 登录页

- 凭据回复按请求配对：连点历史或用户改了表单后，迟到的回复直接丢弃；用户动过表单后以用户输入为准。解不开的凭据回复里是空值，表单留空让用户手动输入。
- 应用更新下载加速地址留空时发空值，由主进程用默认地址；主进程下发的 `proxyUrl` 已回退到默认地址，保存后重新读取，回显实际生效的地址。
