# 飞牛影视桌面客户端

本客户端把飞牛影视网页端装进桌面窗口，接管其中的播放，交给 MPV 播放。本文件只定义概念，不写实现。

每个术语写作“中文 (English)”。英文名取自代码里的命名，写代码、提交信息和 issue 时用这个英文名，不要另起名字。

## Language

### 参与方

**NAS (NAS)**：
用户运行 fnOS 的设备，飞牛影视服务是它上面的一个应用。界面上的“服务器”指的就是 NAS 的地址。
_Avoid_: 服务器（界面文案之外）、server

**飞牛影视服务 (FNMedia)**：
运行在 NAS 上的影视服务，保存媒体库、播放进度和已观看标记，也提供网页端。
_Avoid_: 后端、服务器、backend

**网页端 (web UI)**：
飞牛影视服务提供的网页界面，客户端在主窗口里加载它，自带一个网页播放器。
_Avoid_: Web 端、前端、远程页面、frontend

**客户端 (client)**：
本应用，即包住网页端的桌面程序。
_Avoid_: Electron 端、App

**Proxy (Proxy)**：
客户端在本机启动的取流服务，MPV 通过它向飞牛影视服务或网盘取视频流。
_Avoid_: 代理、本地代理、Go 代理

### 播放内容

**播放项 (PlayItem)**：
用户视角的“一集”或一部影片，是播放、进度和已观看的基本单位。
_Avoid_: 视频、媒体、条目、media item

**播放源 (media source)**：
承载某个播放项的一个具体媒体文件；同一播放项可以有多个播放源（不同清晰度或来源）。
_Avoid_: 媒体文件、版本、media file、source（单独使用时）

**播放列表 (playlist)**：
一次播放交给 MPV 的有序播放项序列：剧集是同一季的所有集，其它视频是同一文件夹下的所有视频，其余情况只有当前播放项。
_Avoid_: 剧集列表、队列、queue

**直链媒体 (direct link media)**：
飞牛影视服务为其给出可直接访问地址的播放源，网盘里的文件和 STRM 链接都算。
_Avoid_: 网盘媒体、云盘文件、cloud storage media

### 看剧进度

**播放进度 (play record)**：
某个播放项当前看到的时间点及其总时长；它是“继续观看”和下次续播位置的依据。
_Avoid_: 观看历史、play status、progress（“播放记录”是 play record 的直译，可以用但不推荐）

**已观看 (watched)**：
播放项级别的“这一集看完了”标记，与播放进度相互独立、互不推导；客户端只置位，从不清除。
_Avoid_: 看完、已完成、finished

**接近片尾 (near end)**：
播放比例达到或超过 98%；同一个阈值既决定重新打开时不续播，也决定离开时标记已观看。总时长缺失或不可信时不算接近片尾。
_Avoid_: 播完、片尾

**续播 (resume)**：
打开播放项时跳到其播放进度所在位置接着播；接近片尾时不续播，但播放进度保留。
_Avoid_: 恢复进度、断点续播

**从头播放 (restart)**：
用户主动选择不续播，从起点重看，同时清除该播放项的播放进度；已观看标记不受影响。
_Avoid_: 重新播放、重播、replay

**进度回传 (play record reporting)**：
播放过程中和离开播放项时，把播放进度写回飞牛影视服务。
_Avoid_: 进度同步、上报、progress sync

### 播放入口与接管

**播放入口 (play entry)**：
网页端里任何会把用户带去播放的交互，如详情页主播放键、卡片上的播放键、“继续观看”菜单里的播放项。
_Avoid_: 播放按钮（泛指时）、play button（泛指时）

**接管 (takeover)**：
客户端截下一个播放入口，不让网页播放器接手，改用 MPV 播放对应播放项；只改变“谁来播”，不改变“播什么”和“从哪儿播”。
_Avoid_: 拦截、劫持、intercept

**MPV 接管开关 (MPV playback preference)**：
决定是否接管播放入口的用户偏好；默认开启，只有用户明确关闭时才走网页播放器。
_Avoid_: 隐藏原播放按钮、hide original play button

**播放会话 (playback session)**：
一次播放期间 Proxy 持有的短期授权，只允许取这次播放列表里的播放项。
_Avoid_: session（泛指时）

**直链直连 (cloud direct)**：
直链媒体由 Proxy 直接向直链地址取流，不经过 NAS；默认方式。
_Avoid_: 网盘直连、302、302 重定向

**NAS 中转 (NAS local proxy)**：
直链媒体改由 NAS 中转取流，是直链直连之外的可选方式。
_Avoid_: NAS 网盘代理、NAS本地网盘代理、NAS 代理模式

**片头片尾信息 (skip info)**：
飞牛影视服务为播放项记录的片头、片尾时间点，供 MPV 自动跳过。
_Avoid_: 跳过信息

### 登录与连接

**当前登录 (current login)**：
客户端此刻使用的 NAS 地址、账号和登录凭据；同一时间只有一个。
_Avoid_: 当前配置、当前账户

**登录历史 (history)**：
最近成功登录过的登录方式（NAS 地址或 FN ID）与账号组合，最多 5 条，供用户一键切换。它与当前登录相互独立：删除一条记录不影响当前登录。
_Avoid_: 历史记录、多账户

**访问码 (access code)**：
NAS 在一切访问之前要求的额外口令，独立于账号密码；没有通过它，网页端、接口和取流都到不了飞牛影视服务。
_Avoid_: 网关密码、访问密码

**访问授权 (access grant)**：
通过访问码验证后得到的、按站点区分的通行凭证；下游只拿它，不接触访问码本身。
_Avoid_: 访问 Cookie、网关 Cookie、access cookie

**FN ID (FN ID)**：
飞牛的云端账号，用于在不知道 NAS 地址时经 FN Connect 登录。
_Avoid_: 飞牛账号

**FN Connect (FN Connect)**：
飞牛的远程访问服务，凭 FN ID 找到并连上用户的 NAS（直连地址或中继）。
_Avoid_: 远程访问、中继（指整个服务时）

**目标 NAS (target origin)**：
FN ID 登录过程中，离开 FN Connect 后到达的第一个站点；之后只有它能拿到登录凭据。
_Avoid_: 目标地址、目标站点

**证书信任 (trusted host)**：
用户对某个 NAS 地址自签名证书的放行，按主机和端口记住。
_Avoid_: 忽略证书、跳过校验、skip verify

### MPV 运行时

**MPV 归档 (MPV archive)**：
随客户端分发的 MPV 及其插件、默认配置的完整包，版本只在一处固定。
_Avoid_: MPV 包、第三方依赖

**附带 MPV (bundled MPV)**：
MPV 归档里随客户端分发的 MPV 程序；Windows 上没有自选 MPV 时用它。
_Avoid_: 打包的 mpv、内置 mpv

**自选 MPV (user-chosen MPV)**：
用户自己指定的 MPV 程序；指定后优先于附带 MPV 和自动查找。
_Avoid_: 自定义 mpv、外部 mpv

**便携配置 (portable config)**：
MPV 归档里的默认配置，是同步到用户配置的来源。
_Avoid_: 默认配置、内置配置

**用户配置 (MPV config)**：
用户系统上 MPV 实际读取的配置目录，除托管插件外都归用户所有。
_Avoid_: MPV 配置目录

**托管插件 (managed plugin)**：
由客户端在每次启动时整体替换的 MPV 插件；目前只有弹幕插件。
_Avoid_: 内置插件

### 更新

**更新检查 (update check)**：
客户端查询是否有新版本并提示用户；只提示和打开下载链接，不自动安装。
_Avoid_: 自动更新、auto update

**更新说明 (release notes)**：
新版本提示框里显示给用户的变更条目。
_Avoid_: 更新日志、changelog

**应用更新下载加速 (app download proxy)**：
可选的第三方中转，用于加速从 GitHub 下载安装包；与 Proxy 无关。
_Avoid_: 下载代理、代理、GitHub 代理、download proxy
