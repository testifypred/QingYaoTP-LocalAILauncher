# 本地 AI 桌面应用 —— 开发者实时日志（Developer Real-time Log）

> 原名 `HANDOFF.md`，由上一任开发者写于 **2026-10-18 21:45**。
> 从 **2026-10-18 21:44** 起，本文件改为**按时间流水记录**：每一笔写清「几点、改了什么、落在哪、怎么验的」。
> 第一节是日志索引，其后的一~七节是原交接正文（保留原样，仅修正两处日期笔误），八~十节是本次三项需求的详细设计说明。
> 最新一笔：**2026-11-13 深夜**（第五十六节，交接收口：无代码改动，核对状态 + 重启发布包 + 刷新文档；版本仍 1.3.1，未重打 zip）。全部时间均为 China Standard Time，本机时钟。
>
> **接手先读 [`交接文档.md`](交接文档.md)**（一页纸：定位、现状、代码地图、下一步）。
> 技术专题已抽到 [`technique/`](technique/)：架构、接口、插件、模型、打包、探针、坑。本文件保留**按时间流水**的原始记录，作为「为什么这么做」的证据。

---

## 〇、变更日志（实时，按时间正序）

### 2026-10-18

| 时间 | 改动 | 落点 | 验证 |
|---|---|---|---|
| 21:44 | 修 Windows 工作区权限故障：`D:\Test For DSH Harness` 缺所有者权限，导致沙箱无法执行任何命令 | `D:\dsh-acl-recovery\acl-backup-6e8f*.json`（可回滚） | 补 `WRITE_OWNER` 后复测，命令恢复 |
| ≈21:46–21:50 | 通读 `app.html`（1631 行）/ `app.mjs`（1801 行），摸清 TTS、设置、会话、模型切换的现状 | — | — |
| ≈21:50 | 就三项需求发出 5 问问卷（朗读按钮去留 / @语义 / 会话存储 / @触发 / 自动朗读开关） | — | 用户选定：保留喇叭、B 第二意见、服务端磁盘、@ 图标在输入框下、自动朗读默认关 |
| ≈21:52–21:56 | 三项需求首版落地：①朗读搬进设置 ②多会话 ③@ 第二意见 | `server\app.mjs`、`server\app.html` | `node --check` 通过 |
| 21:55:08 | 写 `probe-second-opinion.mjs`（真加载两个模型） | `server\` | **11/11**，往返 32.1s，主模型确认换回、恢复后仍能对话 |
| ≈21:56 | `probe-ui-new.mjs` 首跑，截图 ui-1~7 | `server\docs\ui-new\` | **30/30** |
| ≈22:05 | 界面端 @ 全链路（`probe-ui-second.mjs`） | — | **11/11**，截图 ui-8 |
| 22:06:50 | 首次便携打包成功 **206.9MB**（app 117.4 + runtime 88.5，模型与语音外置） | `dist\LocalAI\` | 与源码 SHA256 一致 |
| 22:07:16 | 修打包脚本隐患：删旧产物失败时先把 `data\` 放回原处（此前会把对话记录遗落在 `%TEMP%\localai-data-*`） | `server\build-portable.ps1` | 手工复现该失败路径验证 |
| 22:07:45 | 应用重启，旧 `localStorage` 单会话自动迁移成正式会话 | `workspace\sessions\mvdwh5sr-*.json` | **20 轮 / 30 条**全部保住，标题「Hello」 |
| ≈22:08–22:09 | 5 个新探针归档进 `server\`，截图目录统一到 `docs\ui-new` | `server\` | — |
| ≈22:23 | ⚠️ **操作事故**：为释放测试端口，按 PID 直接结束进程且未核对进程名，误杀了一个 `DSH Desktop` 子进程 | — | DSH 主进程与 GUI 未受影响（22:23:37 自动拉起新子进程）；此后改为「进程名 + 端口」双确认再动手 |
| 22:25:49 | 修「发完消息后侧栏标题/时间不刷新」：`saveTranscript` 落盘成功后补一次 `refreshSessions()` | `app.html` | 用户截图发现该问题，改动已热同步到发布包 |
| ≈22:28:35 | 新增**嗅探本地模型**模块（扫描 / 收录 / 配置 + 分片过滤 + 降噪） | `app.mjs`、`app.html` | `probe-discover` **34/34** |
| 22:29:26 | 写 `probe-discover.mjs`、`probe-ui-discover.mjs` | `server\` | UI **23/23** |
| ≈22:47–22:48 | 两次同步 `app.mjs` / `app.html` 到发布包并重启 | `dist\LocalAI\app\` | 哈希一致；`/api/discover/config` 正常；2 个会话保留 |
| 22:50:04 | 发布包里首次真实扫描 | `workspace\discovery.json` | 16964 个文件 / **309ms** / 0 个候选（4 个模型已在选项卡，被降噪剔除） |
| ≈22:53 | 评估「把 Piper 封装进软件目录」，结论**暂不做** | 本文档第十节 | 体积实测 piper 37MB + 音色 60.3MB；四个前置关卡 |
| 22:55 | 本文档由 `HANDOFF.md` 改名为 `DeveloperRealtimeLog.md`，改为按时间记录 | 本文件 | 全项目无其他文件引用旧名 |
| ≈22:5x | 用户在嗅探面板里扫过一轮并加自定义目录，`workspace\discovery.json` 写入 `onboarded=true`、`customDirs=["D:\\LocalModels"]` | `workspace\discovery.json` | 扫描 16972 文件 / 132–167ms |
| 23:03 | 用户点「退出服务」正常关闭应用（日志 `15:03:42 收到退出指令`，UTC），非崩溃 | — | 重启后一切正常 |
| ≈23:05–23:20 | 新增**多回答预加载**：常驻额外模型 + 开启前能力核算与警告弹窗 + 「不再提醒」+ 设置里的提醒开关 | `app.mjs`、`app.html` | `probe-preload` **26/26**、`probe-ui-preload` **31/31** |
| ≈23:20 | 关键实测：预加载后第二意见 **13.9s**（原 30–45s），事件流无 `loading`，`swapped=false`，主模型 KV 缓存完整保留 | — | `qwen3-5-4B` + `Phi-4-mini` 双模型常驻 |
| ≈23:25–23:36 | **修工具调用**：自建 `<tool_call>` 协议 + Agent 循环，替换失效的库函数调用 | `app.mjs`（`buildToolRegistry`/`parseToolCalls`/`stripToolCalls`/`TOOL_ROUND_LIMIT`） | `probe-tools-agent` **24/24** |
| 23:33 | 发布包（8099）实测同一条工具探针：四个工具全部真实执行 | `dist\LocalAI\` | **24/24**，`note.txt` 读出「天枢」项目内容 |
| ≈23:35 | 预加载部署后的能力核算在 8099 实测正常（4 模型逐个 ok、合计 insufficient） | `dist\LocalAI\app\` | 哈希一致 |
| ≈23:36 | 指标行改为「工具 N 次 X.XXs」；工具卡片图标 `🔧` 换文字（字形缺失） | `app.html` | `probe-ui-tools` **12/12** |
| ≈23:38 | 纯聊天回归，确认没把流式对话改坏 | — | `probe-chat-plain` **11/11**（40 块流式、KV 复用 58%） |
| ≈23:50 | 加左下角提示条：预加载完成或取消时明确报「模型名 + 占用/释放多少 GB」 | `app.html`（`showToast`、`toastReleased`、`.toasts`） | `probe-ui-preload` **35/35**（新增 4 项断言） |
| 10-21 23:35 | 新增「上下文余量」浮窗：顶栏下方右侧悬空卡片，剩余 / 已用 / 百分比 + 进度条，≥70% 黄、≥85% 红并提示接近上限；顶栏「余量」按钮与浮窗 ✕ 双向开关，选择存 localStorage；数字只取每轮 `usage`，不额外请求服务端 | `app.html`（`#ctxPanel`、`noteCtxUsage`、`renderCtx`、`placeCtx`） | `probe-ctx-panel` **24/24**（贴顶栏 top=129/hb=119、64% 常态、89% 告警、隐藏/显示后刷新仍记忆、窄窗跟随、真跑一轮 37/16,384、测试会话已清） |
| 10-21 23:50 | 验证时用 CDP 重载页面：生成中断开连接 → Vulkan device lost → 进程退出，启动器 15s 自动重启（已知问题 2 的又一次复现，不是新缺陷） | — | 日志 15:50:12 客户端断开 → 15:51:34 聊天错误 → 15:51:37 重启 |
| 10-21 23:53 | 修工具路径计时错位：工具分支两处 `session.prompt` 没传 `onToken`，单轮直接作答时 ttft 要等整段生成完才补记，于是显示「预填充 294.94s / 生成 0.0s / 227555.56 tok/s」；顺手给速度加零值保护，界面不再显示 0 tok/s | `app.mjs`（工具分支 `session.prompt`×2、`finishMetrics`）、`app.html`（`formatStats`） | 工具开+不调工具：ttft 4.30s / 生成 0.46s / 4.33 tok/s；工具开+真调用：0.74s / 7.19s / 6.26 tok/s（修复前同条件 genMs≈1ms、tokPerSec≈6.3 万） |
| 10-22 00:20 | 对话标题：①侧栏双击/右键就地改名（不再用 `window.prompt` 弹窗），手改即 `renamed=true`；②顶栏加「重命名」；③右键菜单含 重命名/导出 Markdown/删除；④第二轮之后空闲 8 秒，主模型在独立 512 上下文里概括 6–12 字标题（不写进对话 sequence，不破坏 KV 复用） | `app.html`（`beginRename`/`commitRename`/`showSessionMenu`/`scheduleAutoTitle`）、`app.mjs`（`renamed` 字段、`/api/sessions/<id>/auto-title`、`generateTitleWithModel`） | `probe-title-ui` **13/13**（右键菜单/就地改名落盘/顶栏按钮/Esc 取消）；`probe-auto-title` **5/5**（两轮后 11s 出标题「KV缓存加速网络请求响应」，renamed 仍为 false）；接口单独实测：生成 3.9s、单轮 `too-early`、手改后 `skipped:renamed` |
| 10-22 00:25 | 顶栏去拥挤：模型选项卡独占第一行（4 个模型完整可见），状态栏从 60px 截断恢复到 360px（悬停看全文）；「提示词 / 嗅探 / 退出服务」收进「⋯」菜单；工具栏允许换行，窄窗不再被裁掉 | `app.html`（`.topbar` / `.toolbar` / `.hdrMenu` / `#status`） | `probe-title-ui` 头部 4 项断言通过；截图 `docs/ui-new/header-final.png`（1408px 下 4 个模型全可见） |
| 10-22 23:30 | 修「点左侧对话后历史乱跳」：切会话时 `flushTranscript()` 无条件 PUT，服务端每次都把 `updatedAt` 抬到当下，列表按时间重排，刚离开的会话跳到顶部、指针下的行被换走；改为 ① 无新内容不写盘（dirty + seq）② 服务端内容完全相同不抬时间戳 ③ 列表重建保留滚动位置 ④ 连点只认最后一次（switchToken） | `app.html`（`saveTranscript`/`flushTranscript`/`loadSession`/`switchSession`/`renderSessions`）、`app.mjs`（`writeSession`） | `probe-session-jump` **4/4**（切换后顺序不变、updatedAt 不变、真发消息才置顶）；`probe-session-race` **3/3**（0/20/80ms 连点都落在最后一次） |
| 10-22 23:42 | 新增**代码块运行**：每个围栏代码块带「复制 / 运行」，点运行就地显示 exit code、耗时、stdout/stderr；服务端限制 10s 超时 + 64KB 输出 + 进程树强杀 + 本地令牌；语言按本机已装工具链自动启用（实测 JS / Python / C / C++ 可用，Java 缺 JDK、Go / Rust 未装时给出明确提示）；设置 → 生成里可关闭「运行」按钮 | `app.mjs`（`/api/run`、`/api/run/langs`、`runCode`/`runSpawn`）、`app.html`（`.codeWrap`、`runCodeBlock`、`#setCodeRun`） | `probe-code-run` **13/13**（Python 106ms、JS、C++ 6.2s 编译执行、超时 10.4s 被杀、输出截断 65536、403/400 边界）；`probe-code-run-ui` **9/9**（按钮显示、执行出结果、设置开关） |
| 10-22 23:48 | 「提示词 / 嗅探 / 退出服务」从顶栏「⋯」挪进 **设置 → 工具**（新选项卡），不再依赖隐藏按钮的 `.click()`；顶栏移除 ⋯，第二行只剩 上下文 / 思考 / 工具 / 新对话 / 重命名 / 加载 / 卸载 / ⚙ | `app.html`（`paneTools`、`setPromptOpen`/`setDiscoverOpen`/`setQuitOpen`、`quitService`） | `probe-settings-tools` **9/9**（无 ⋯、工具页可见、提示词/嗅探面板真打开）；截图 `docs/ui-new/settings-tools.png` |
| 10-22 23:54 | 首页重构：① 去掉顶部模型选项卡，改左上角「∫ 模型」下拉（点一行即加载，底部带上下文与卸载）；② 顶栏收成一行（☰ / ∫ 模型 / 状态 / 余量 / 设置 / 主题）；③ 启动默认**新对话** + 开场白（早上/中午/晚上好，按时间段自动亮/暗主题）；④ 右下角「上次在聊」卡片可跳回上次对话；⑤ 深度思考 / 调用工具 / 联网 / 预加载移到输入框下方；⑥ 发送键显示已加载模型图标；⑦ `config.ini` 的 `autoLoad` 改为 `qwen3-5-4B-Q4_K_M.gguf` | `app.html`、`dist\LocalAI\config.ini` | `probe-start-screen` **12/12**（开场白/默认新对话/问候语/无模型列表/∫ 按钮/发送图标/上次对话卡/输入区选项/模型菜单 4 行）；`probe-start-flow` **8/8**（继续对话、新对话、发送后退场、图标保留）；截图 `docs/ui-new/start-screen.png`、`model-menu.png` |
| 10-22 23:58 | 修「嗅探面板只剩标题和按钮」：`showSettingsTab` 用全局 `.settingsBody` 选择器切分页，把嗅探 / 预加载弹窗的 body 一起 hidden 了（它们复用了这个类）；改成只切 `#settingsModal .settingsBody`。顺带把空结果文案说清楚：模型库里的模型不会重复列出 | `app.html`（`showSettingsTab`、`renderDscResults`） | `probe-discover-ui` **8/8**（内容区 341px、说明/扫描位置/自定义目录/扫描按钮可见；扫描 17058 个文件 0.3s）；截图 `docs/ui-new/discover.png` |
| 10-23 00:05 | 模型菜单补「＋ 添加模型…」入口（打开嗅探面板扫描/收录新模型）；模型列表加签名缓存，3 秒刷新不再重建打开着的菜单（之前每 3 秒 innerHTML 重建，鼠标下的行会被换掉）；实测点模型行即加载（Phi-4 ↔ Qwen3.5 往返） | `app.html`（`modelAddBtn`、`renderModelTabs` 签名缓存、`.modelAddRow`） | `probe-model-add` **4/4**（入口存在、3 秒内 4→4 不重建、点入口开嗅探并收起菜单）；截图 `docs/ui-new/model-menu.png` |
| 10-23 00:09 | 修「模型菜单点不动 / 被消息盖住」：`header` 没有独立 z-index，`body>*` 给四个区都设了 1，DOM 中靠后的 `main` 把顶栏里的菜单压在下面——看得见、点不到；给 `header` 加 `z-index:40`（模态框 50、余量浮窗 45 仍在上面） | `app.html`（header 样式） | `probe-menu-stacking` **2/2**（header z=40、四行模型命中测试全部落在菜单上，底下压着一条消息）；截图 `docs/ui-new/model-menu.png` |
| 10-23 00:13 | 状态栏瘦身：原来「模型名 · 是否思考 · 上下文 · 层数 · 后端」挤成省略号；现在只显示「16K · 可思考 / 不支持思考」，模型名（左边按钮已有）、层数、后端全放进 tooltip | `app.html`（`setStatus` 增加第三参数、`refresh` / `loadModelFile` 文案） | `probe-status` **6/6**（状态栏 99px、tooltip 含模型与层数、最长名字放得下、可思考标注与 tooltip 一致） |
| 10-24 00:03 | 新增**独立代码运行器**（顶栏「代码」）：选语言、写代码、Ctrl+Enter 运行，输出带 exit code / 耗时；不依赖对话消息；未安装语言置灰；草稿存 localStorage；复用 `/api/run` 的 10s 超时 / 64KB / 本地令牌 | `app.html`（`#codeModal`、`.codePane`、`openCodePanel`/`runCodePanel`） | `probe-code-panel` **9/9**（入口、7 种语言列表、未装置灰、Python 运行出结果、刷新草稿、清空、Esc 关闭）；截图 `docs/ui-new/code-panel.png` |
| 10-24 22:50 | 修三处状态类 bug：① **换模型只清界面不清存档**——`loadModelFile` 清空 `#msgs` 但 `transcript` 还在，下一句会被写进模型没见过的上下文；改成按 transcript 重建 history 并重渲染（对话保留）② **自动标题每轮重写**——已生成或手改过就跳过 ③ **删除会话后右下角卡片仍指向已删会话**——同步收起；空会话统一回开场白，不再显示旧提示 | `app.html`（`loadModelFile`/`scheduleAutoTitle`/`deleteSession`/`renderStored`） | `probe-context-switch` **3/3**（Phi-4 ↔ Qwen3.5 往返，消息 2/2 不变、无空开场白） |
| 10-24 22:52 | 加三个小功能：① 每条回答加「复制」按钮（与朗读、重生成同一排，复制成功打勾）② 输入草稿按会话保存（切会话/刷新不丢没发出去的话，发送后清掉）③ 滚上去后右下角出现「回到最新」按钮 | `app.html`（`makeCopyBtn`、`draftKey`/`restoreDraft`、`#toBottom`） | `probe-small-features` **6/6**（复制拿到正文、切会话不带草稿、回来草稿还在、回到底部 gap=0） |
| 10-24 22:59 | 输入侧小功能：① ↑/↓ 调出最近 20 条发过的输入（草稿为空的 ↑ 才触发）② Ctrl+N 新对话、Ctrl+K 聚焦输入、Esc 清空输入 ③ 会话右键「清空消息」——保留会话本身，只清消息 | `app.html`（`pushInputHistory`、全局快捷键、`clearSessionMessages`、右键菜单） | `probe-input-extras` **8/8**（历史上下翻、三快捷键、清空后接口 messages=0） |
| 10-24 23:11 | 新增**工作区（文件管理）**：顶栏「文件」打开，左侧目录树、右侧 CodeMirror（行号 + 按扩展名高亮）；支持新建文件/文件夹、保存（Ctrl+S）、重命名、删除空目录、上传（≤10MB）、越界路径拒绝；模型工具新增 `list_workspace_files` / `write_workspace_file` | `app.mjs`（`/api/workspace/*`、`wsList`/`wsRead`/`wsSave`、工具注册）、`app.html`（`#wsModal`、CodeMirror 资源） | `probe-workspace-api` **9/9**（增删改查、越界拒绝、空目录删除）；`probe-workspace-ui` **7/7**（打开、行号、新建打开、保存回读、重命名、删除）；截图 `docs/ui-new/workspace.png` |
| 10-24 23:18 | 开场白改版：自带输入框（此时隐藏底部输入区）；打招呼下加「∫ Agent 模式」（斜体）与「推理模式」（粗体宋体 + 青色发光）；Agent 自动勾选调用工具、推理自动勾选深度思考（模型不支持时提示）；发送走原链路，发出后切回普通对话布局 | `app.html`（`showHero`/`applyHeroMode`/`heroSendNow`、`.modeBtn` 样式、`body.startScreen`） | `probe-hero-modes` **11/11**（输入框、隐藏底栏、两按钮、斜体/宋体/粗体/颜色、模式联动开关、发送后切回对话）；截图 `docs/ui-new/start-modes.png` |
| 10-24 23:31 | 修**工具调用截断泄漏**：模型在 `<tool_call>` 中间被 max_tokens 截断时，解析与清洗都要求闭合标签，原始 JSON 会漏进正文（用户截图）；现在接受未闭合块并从正文剔除，正文为空时给「调用被截断」提示；新增 `run_code` 工具（7 语言、10s 超时），`write_workspace_file` 说明要求精简 | `app.mjs`（`parseToolCalls`/`stripToolCalls`/`rawCallSeen`/`run_code`） | 实测：写文件请求 29.7s → `star.py` 258B 且正文无 `<tool_call>`；`run_code` 16.4s → 42；`max_tokens=48` → 只显示截断提示、无泄漏 |
| 10-25 00:33 | 消息时间戳：用户/助手消息下方显示时间（今天只显示 HH:MM，跨天带「10-24」；悬停看完整时间）；历史消息用存档里的 `t`，新消息用当前时间 | `app.html`（`msgTimeText`/`makeMsgTime`、`bubble` 参数、stats 追加） | `probe-timestamps` **4/4**（每条都有、格式、悬停完整时间、新消息即时） |
| 10-25 00:37 | ① **公式复制**：块级公式右上角「复制 LaTeX」（悬停出现），行内公式点一下复制，源码取自 KaTeX 的 `annotation` ② **会话内搜索**：`Ctrl+F` 打开、实时高亮（CSS Highlight API，不改 DOM）、`Enter`/`Shift+Enter` 上下跳、`Esc` 关闭 | `app.html`（`decorateFormulas`/`copyFormulaTex`、`#findBar` 逻辑） | `probe-formula-find` **8/8**（块级按钮复制、行内点击复制、搜索计数/高亮/跳转/关闭） |
| 10-25 00:44 | ① **公式面板**（顶栏「公式」）：MathLive 可视化编辑（虚拟键盘），LaTeX 源码双向同步，可复制 / 插入输入框 ② **化学式**：引入 mhchem，`$\ce{...}$` 可渲染，裸写 `\ce{CO2}` 自动补定界符；注意 KaTeX 0.19 自带的 mhchem 是 ESM（classic 方式加载会报 import 错误），改用去掉 import 的 classic 版本 ③ 顺带补 CodeMirror `addon/mode/simple.js`（rust 模式之前报 defineSimpleMode 未定义） | `app.html`（`#fxModal`、`decorateFormulas` 前身）、`vendor/mathlive`（785KB + 250KB 字体）、`vendor/katex/contrib/mhchem` | `probe-formula-panel` **7/7**（化学式 3 条含裸写、面板就绪、双向同步、复制、插入、关闭）；截图 `docs/ui-new/formula-panel.png`、`chemistry.png` |
| 10-25 09:56 | **探针全量巡检**：29 个探针跑出 366 条断言（353 通过 / 13 失败）——19 条是探针自身过期，3 条是真缺陷，见下面三笔 | `server\probe-*.mjs` | 探针输出落 `docs\probe-*.log` |
| 10-25 10:20 | ⚠️ **事故**：`probe-ui-sessions` 的 `wipe()` 用 API 逐个删会话，把 13 条真实会话删光（`unlink`，回收站与卷影副本都无） | `probe-ui-sessions.mjs` | 已给 `wipe()` 加「删前整份备份到 `docs\session-backups\<时间戳>\`」，复跑打印「已备份 N 个会话」 |
| 10-25 10:22 | 修**自动标题静默失效**：标题专用 context 没传 `noThink` wrapper，24 token 全被 `<think>` 吃掉，`cleanTitle` 拿到空串 | `app.mjs`（`generateTitleWithModel` 传 `chatWrapper`、maxTokens 24→32、空结果打日志） | `probe-auto-title` **5/5**；两轮后 12s 出标题「虚拟内存为何比物理内存慢」 |
| 10-25 10:22 | 修**开场白页快捷键失联**：Ctrl+K / Esc 只认底部 `#q`，而它被 `body.startScreen` 藏了，`focus()` 静默无效；顺带 `↑/↓` 历史也接到 hero 输入框 | `app.html`（`activeInputBox()`、`inputHistoryKey`） | CDP 实测 Ctrl+K→`heroInput(visible)`、Esc 清空两框、`↑` 翻出上一条 |
| 10-25 10:22 | 修**读文件被调成写文件**：`read_workspace_file` 参数叫 `name`、其余工具叫 `path`，且与 write 描述边界糊 | `app.mjs`（read 兼容 `path`、两条描述互相点名、说明书第 6 条） | `probe-tools-agent` **24/24**（原 22/24） |
| 10-25 10:34 | 新增**命令行客户端 `localai`**：零依赖单文件，走 `/v1/chat/completions` 与 `/api/*`；支持 ask/chat/models/load/unload/state/run/sessions、stdin 管道、会话续写、`--json` | `server\localai.mjs`、`localai.cmd`、`build-portable.ps1`（进包） | 16 项手工验收（流式/工具卡片/stdin/会话回想/JSON/退出码 0·1·2·3）；包内 `app\localai.cmd` 用自带 `runtime\node.exe` 实跑通过 |
| 10:40 | 新增**全屏终端 TUI**：零依赖 ANSI 界面，彩色对话 / 工具卡片 / 斜杠命令 / 滚动 / Ctrl+C 中断；非 TTY 自动降级成逐行模式 | `server\localai-tui.mjs`、`localai-tui.cmd`、`localai.mjs`（`localai tui`） | `--selftest` 7 组通过；`--snapshot` 在 60/70/88 列下边框对齐；真控制台启动存活 5s 无异常退出 |
| 10:45 | 顶栏新增「终端」按钮：`POST /api/terminal/open`（要本地令牌）用 `start` 拉起真控制台跑 TUI，所以窗口里是真 TTY | `app.mjs`、`app.html`、`build-portable.ps1` | 带令牌 ok 且 node 进程存活；无令牌 403；截图 `docs\ui-new\topbar-terminal.png` |
| 10:47 | 附带发现：重启后 localStorage 的 `localai.transcript.v1` 旧备份被重新迁移，找回 1 条 30 消息的老会话（10-25 会话丢失事故里唯一能恢复的部分） | — | `mvn7m7kl-0d9fe764.json`，30 条，从「Hello」开始 |
| 10:42 | 修**快照时间戳撞名**：文件名只到秒，同一秒内连写会互相覆盖（回滚后本该多一版却还是 1 版）→ 改成到毫秒 | `app.mjs`、`app.html`（面板解析新文件名） | 3 秒内 4 次写盘 → 4 份独立快照 |
| 10:44 | 新增**会话自动快照**：每次覆盖写盘前把原文字节留一份到 `workspace\session-snapshots\<日期>\`，单会话留 20 版、保留 30 天；会话右键「历史版本…」列出并回滚（回滚前也留档，所以可再撤回） | `app.mjs`（`snapshotBeforeWrite` / `pruneSessionSnapshots` / `pruneOldSnapshotDirs` / `GET .../snapshots` / `POST .../restore`）、`app.html`（`#snapModal`、`openSnapshots`） | 3 版列出→回滚→回滚后 +1 版；连写 23 次只留 20（最老=第 4 版）；无令牌回滚 403；面板 1 行正常，截图 `docs\ui-new\snapshot-panel.png` |
| 10:50 | **模型下载**：通道 ModelScope（0.5B 三档量化，469/396/644MB）+ 自定义直链；浏览器 UA、跟随 302、进度/速度/ETA/取消、下完自动加载 | `app.mjs`（`startDownload`/`followGet`/`/api/download/*`）、`app.html` | 实下 `qwen2.5-0.5b-instruct-q4_k_m.gguf` 468.6MB 落盘；加载后 2.3s 答出「递归是函数调用自身…」 |
| 10:52 | **首次使用引导**：首启弹「准备模型」——① 自动嗅探本机 ② 也可以直接下一个极小的；两个通道可切；完成后若没自定义提示词，自动应用推荐系统提示词 | `app.html`（`#firstModal`、`firstRunOpen`/`frScan`/`frStartDownload`/`frPoll`）、`app.mjs`（`/api/onboarding`、`workspace\onboarding.json`） | 首启弹出；嗅探 18226 文件 0 候选（4 个模型已在库）；两通道三档位；「其他通道」出 URL/文件名输入；点完成→不再弹、sysPrompt 写入；截图 `docs\ui-new\first-run.png` |
| 10:54 | 修**打包脚本丢 BOM**：我改过 `build-portable.ps1` 后 UTF-8 BOM 没了，PS 5.1 按 GBK 读 → 中文注释乱码，解析直接失败 | `build-portable.ps1`（补 EF BB BF） | 补 BOM 后打包一路通过 |
| 10:55 | 修**打包被占用**：`--stop` 之后启动器进程不退，它的 WebView2 子进程占着 `data\` 导致清空旧产物失败（日志第 8 条已知问题的又一次复现） | 操作流程 | 只按 `CommandLine -like '*LocalAI*'` 精确杀 webview，未误伤 DSH 的 WebView2 |
| 10:56 | **重新封装便携版**：209MB / 3430 文件，含界面、CLI、TUI、引导与下载；`AUTO_LOAD` 找不到指定模型时回退到最小的那个 | `dist\LocalAI\`、`app.mjs` | 起包实测：引导弹出、5 个模型（含 0.5B）、页面无 JS 错误、`app.mjs`/`app.html` 与源码哈希一致 |
| 12:04 | **虚拟机实测通过**：VC++ 运行库装上后，包在 Win10 VM 里跑通；Qwen2.5-0.5B Q4 纯 CPU **16.4 tok/s**、内存 3.4/8GB；状态栏正确显示后端 | — | 截图与日志见 `docs\ui-new`；确认「缺 VC++」就是 `spawn git ENOENT` 的真因 |
| 18:25 | **入门化改造**：启动器拉起服务前自检——缺 VC++ 引导装随包的 `vc_redist.x64.exe`、端口被占自动改口并写回 config、磁盘不足预警；新增 `gpu=auto\|cpu\|vulkan` 配置，状态栏在 CPU 时标 `· CPU` | `Launcher.cs`、`app.mjs`、`app.html`、`build-portable.ps1` | 编译通过；`LOCALAI_GPU=cpu` 实测 `gpu=cpu / 已按配置强制使用 CPU`；宿主 vulkan 不受影响 |
| 18:26 | 修**静默编译**：`getLlama({build:"never"})`，不再偷偷编译 llama.cpp（VM 里 `spawn git ENOENT` 的元凶）；首启加硬件体检（内存/核数/后端 + 推荐档位自动预选），下载完自动发第一句 | `app.mjs`（`/api/sysinfo`）、`app.html` | 卡片实测「31.4GB · 可用 10.7GB · 22 核 · 后端 Vulkan」；首启自动弹出并预选 Q4_K_M |
| 18:30 | **重新封装 v2**：257.9MB / 3435 文件，正式带上 `vc_redist.x64.exe`(24MB) 与 `plugins\`(3 个示例)；日志逐项打印「已附带…」 | `build-portable.ps1`、`dist\LocalAI\` | 起包实测：`/api/plugins` 3 个可用、`/api/sysinfo` 正常、无 JS 报错 |

### 2026-10-26

| 时间 | 改动 | 落点 | 验证 |
|---|---|---|---|
| 23:38 | 新增**插件系统**：`plugins\*.mjs` 导出 `{name,description,params,run}` 即成为工具，与内置工具共用链路、支持热重载；设置→工具可看列表/错误/重载/开目录；随包 3 个示例 | `app.mjs`（`loadPlugins`/`watchPlugins`/`/api/plugins*`）、`app.html`、`server\plugins\`、`build-portable.ps1` | 模型实测调用 `disk_space`（3ms）；热重载 `loadedAt` 变化；界面「3 个可用」 |
| 23:48 | 新增**外观自定义**（设置 → 外观）：主色（6 预设 + 取色器，改 --accent/--cyan/--glow）、整体缩放 80–140%、背景图（≤1.5MB，存 dataURL，自动加暗色蒙版）、**自定义 CSS**（逃生舱）；全部存 `localai.appearance`，刷新保留，一键恢复默认 | `app.html`（`applyAppearance`/`renderAppearanceControls`） | CDP 实测：色板 6 个、改紫+110%+自定义 CSS 生效、刷新后仍生效、无 JS 报错；截图 `docs\ui-new\appearance.png` |
| 23:58 | **文档重构**：新增根目录 `交接文档.md`（一页纸）与 `technique\`（7 篇专题：架构/接口/插件/模型/打包/探针/坑）；本日志保持「只追加」的时间流水，并加指路 | `交接文档.md`、`technique\`、本文件 | 文档内链接与代码事实逐条对照（接口表取自 `app.mjs` 路由、工具清单取自注册表） |


### 2026-10-19 → 10-20（隔天续做：Web 能力）

| 时间 | 改动 | 落点 | 验证 |
|---|---|---|---|
| 10-19 23:0x | 排查「百度能不能用」：先误判为 IP 被封，实测后确认是**UA 敏感**（桌面 UA 给安全验证页，移动 UA 给 1.85MB 正常结果） | — | 两次误判都写在第十二/十三节，避免下次再错 |
| ≈10-19 23:2x | 新增联网工具：`web_search`（百度优先→被拦自动回落 Bing）+ `fetch_url`（读正文、SSRF 防护） | `app.mjs`（`webSearch`/`fetchUrlText`/`checkUrl`/`fetchPage`/`htmlToText`） | `probe-web-tools` **19/19** |
| ≈10-20 00:0x | 未知工具调用改为列出「当前可用工具」并禁止编造（模型曾凭记忆瞎调 `web_search` 后谎称查到了新闻） | `app.mjs` `run()` | 复测：拒绝 + 告知可用清单 |
| ≈10-20 00:2x | 联网 UI：工具栏「联网」开关（默认关）+ 首次开启须知弹窗（5 条）+ 「不再提示」+ 设置里可恢复 | `app.html` | `probe-ui-web` **34/34** |
| ≈10-20 00:3x | 联网专用卡片（搜索词/条数/引擎/回落原因/结果清单）与「本次联网」摘要；`🌐` 字形缺失改文字 | `app.html` `toolCardEl()` | 卡片与摘要都验过 |
| ≈10-20 00:4x | 修一处状态不一致：`webEnabled` 会持久化而「调用工具」不会，刷新后联网显示开着却发不出 `web` 标记 | `app.html`（`toolEnabled` + `tools: toolChk.checked`） | 复测刷新后两者一致 |
| 00:45 | 部署发布包并重启，联网探针在 8099 复跑 | `dist\LocalAI\` | **19/19** |
| ≈10-20 23:3x | 「联网」开关从工具栏移到**输入框下方**，与「多回答预加载」同一右对齐组 | `app.html`（`.askToggles`、`#webChk`） | `probe-ui-web` **39/39**（新增 5 项位置断言） |
| ≈10-20 23:4x | 修数字实体漏解码：Bing 标题里的 `&#183;` 被原样显示成 "&#183;" | `app.mjs` `htmlToText()` | 复测标题显示「·」，结果里已无 `&#` |

### 当前状态快照（2026-10-20 23:45）

- 服务：`启动本地AI.exe` 运行中，`http://127.0.0.1:8099`，qwen2.5-7B 已自动加载，4 个模型可用
- **工具调用**：已修好（自建 `<tool_call>` 协议 + Agent 循环），qwen2.5 实测 24/24
- **联网**：已上线，**默认关闭**，开关在**输入框下方**；首次开启弹须知；搜索百度优先、被拦回落 Bing；读网页有 SSRF 防护
- 多回答预加载：已上线，默认关闭；开启前弹能力检查
- 会话：服务端磁盘存储，随用随建；旧 localStorage 已迁移
- 未完成：ASR 语音输入、Piper 封装（主动搁置）；工具与联网路径均未做增量流式

### 下一笔怎么写

在后面追加一行即可，别改旧行：

```
| HH:MM | 一句话说清改了什么、为什么改 | 改了哪个文件/目录 | 怎么验的（探针项数/实测数字） |
```

---

## 一、这是什么

一台 Windows 笔记本上的**纯本地 AI 对话应用**：Node 服务 + 内置网页界面，模型用 llama.cpp（node-llama-cpp）跑在本机核显上。

- 入口：`server\app.mjs`（服务端，端口 8099）+ `server\app.html`（界面）
- 模型目录：`D:\LocalModels\*.gguf`
- 便携成品：`D:\LocalModels\dist\LocalAI\`（双击 `启动本地AI.exe`）
- 桌面快捷方式「本地 AI」→ 指向那个 exe

## 二、当前已完成的能力

| 能力 | 状态 | 关键实现位置 |
|---|---|---|
| KV 缓存复用 | ✅ 多轮只解码增量，实测首字 16.7s → 0.97s | `app.mjs`：常驻 `state.sequence` / `state.session`、`commitSession()` |
| 系统提示词跨轮保留 | ✅ 修掉 `setChatHistory` 顶掉 system 的旧 bug | `initialHistory()` |
| 便携打包 + 图标启动器 | ✅ 206.9MB（模型外置） | `build-portable.ps1`、`launcher\Launcher.cs` |
| 内嵌窗口（不依赖 Edge） | ✅ WebView2，缺运行时可回落浏览器 | `Launcher.cs` OpenUi |
| DPI 感知 | ✅ 175% 缩放不再模糊 | `launcher\app.manifest` |
| 亮/暗主题 | ✅ 跟随系统 + 手动切换，记忆 | `app.html` theme 相关 |
| 模型选项卡 + 品牌图标 | ✅ Microsoft/Qwen/OpenAI/DeepSeek | `vendor\models\*.png`、`renderModelTabs` |
| 思考段拆分（R1/gpt-oss） | ✅ `think` 标签流式拆到折叠区 | `createThoughtSplitter()` |
| TTS 朗读 | ✅ Edge 神经语音（在线）+ Piper（离线）+ 系统兜底 | `/api/tts`、`D:\LocalModels\tts\` |
| 停止生成 / 重新生成 / 导出 | ✅ | `app.html` + `/api/export` |
| 刷新后续聊 | ✅ 重建 history | `renderStored()` |
| max_tokens / 温度可调 | ✅ ⚙ 设置面板 | `localai.settings` |
| 朗读设置集中于设置页 | ✅ 「设置 → 朗读」：默认音色 + 语速 + 试听；底部旧朗读条已删 | `initTts()`、`localai.settings` |
| 自动朗读 | ✅ 保留但默认关闭，迁移时强制归零一次 | `SETTINGS_VERSION` |
| 多会话对话列表 | ✅ 左侧栏，建/切/删/双击重命名，存服务端磁盘 | `/api/sessions`、`workspace\sessions\` |
| @ 模型征询第二意见 | ✅ 输入框下方 @ 按钮，主回答后换模型补一段看法 | `/api/second-opinion`、`runSecondOpinions()` |
| 工具调用（Agent） | ✅ 自建 `<tool_call>` 协议 + 最多 4 次往返；时间/计算/模型列表/读文件全部实测 | `buildToolRegistry()`、`parseToolCalls()`、`handleChat` 的 `toolsEnabled` 分支 |
| 联网工具 | ✅ 默认关；搜索（百度优先→被拦回落 Bing）+ 读网页正文；SSRF 防护 | `webSearch()`、`fetchUrlText()`、`#webChk`、`#webWarnModal` |
| 上下文余量浮窗 | ✅ 顶栏下方悬空卡片，可隐藏；≥70% 黄、≥85% 红；数字取每轮 `usage` | `app.html`：`#ctxPanel`、`renderCtx()` |
| 嗅探本地模型 | ✅ 扫常见位置+自定义目录，硬链接收进模型目录 | `/api/discover/*`、`workspace\discovery.json` |
| 崩溃自愈 | ✅ 启动器守护 + Vulkan 崩溃后自动降 CPU | `Launcher.cs` Exited、`recentCrashes()` |

## 三、模型清单（`D:\LocalModels`）

| 文件 | 大小 | 说明 |
|---|---|---|
| `qwen2.5-7b-instruct-1m-q4_k_m.gguf` | 4.36GB | **默认/主力**，1M 上下文版，~8-10 tok/s |
| `DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf` | 4.68GB | 思考型，6.4 tok/s，加载 26s |
| `Phi-4-mini-instruct-Q4_K_M.gguf` | 2.32GB | Microsoft，快 |
| `qwen3-5-4B-Q4_K_M.gguf` | 2.52GB | Qwen3 系 |

## 四、已知问题（改动前先看）

1. **工具调用已修好（2026-10-18 23:35）**。原缺陷是 node-llama-cpp 从 jinja 模板里探测不到函数调用语法时会把 `functions` 静默丢弃，模型于是只吐 `<tool_call>` 文本而无人解析。现在改成自建协议 + 自己的 Agent 循环（详见第十二节），四个内置工具全部实测可跑。**遗留限制**：工具路径不逐 token 流式（每轮跑完一次性推正文）；一轮最多 4 次工具往返；模型必须愿意按 `<tool_call>` 格式输出——qwen2.5 实测很稳，R1 那类思考模型没测过。
2. **Vulkan 后端偶发 device lost**：尤其「生成中途点停止 / 关窗口」时必崩（实测复现）。现在靠两条兜底：启动器守护自动重启（约 15s）、10 分钟内崩 2 次启动时自动切 CPU。
3. **Piper 只支持 `phoneme_type=espeak` 音色**：`chaowen`/`xiao_ya` 是 pinyin 模式，会让 2023 版二进制崩，服务端已自动跳过。
4. **对话记录里有测试残留**：之前调试时发过“你好”“请写一篇 800 字的长文”等，用户可点「新对话」清空。
5. `npm install` 会删掉手工安装的 `node-llama-cpp`（已写进 package.json 以防再发生）。
6. **第二意见必然让主模型的 KV 缓存作废**：一台机器只装得下一个模型，征询时是「卸掉 A → 加载 B → 作答 → 再装回 A」。实测一轮往返 32–44 秒（qwen2.5-7B ↔ Phi-4-mini），回来之后下一轮要重新预填充。这是硬件决定的，不是 bug。
7. **第二意见期间不给「停止」按钮**：服务端必须在 `finally` 里把主模型装回来，中途 abort 会让下次提问打到错的权重上。所以 `runSecondOpinions()` 里把 `stopBtn` 藏起来了。
8. **`--stop` 之后启动器进程不退出**，仍占着 `logs\app.log`，导致 `build-portable.ps1` 清空旧产物那一步失败。照脚本提示把残留的 `启动本地AI.exe` 结束掉再打一次。

## 五、待办（按性价比）

1. **语音输入 ASR**：与 TTS 配成闭环。ModelScope 有 SenseVoice-small（约 300MB，CPU 准实时）。
2. 上下文裁剪打断 KV 复用的优化（当前裁历史会导致整段重算）。
3. 第二意见的「不换模型」方案：目前只能靠临时换人。若以后上更大显存，可以常驻一个小模型专职当第二意见。
4. 嗅探模块的「删除模型」与「下载目录监听」（新下完的模型自动出现）。
5. 工具调用再往前走一步：给工具路径也做增量流式（现在每轮跑完才推正文），以及补 Web 搜索 / 目录遍历这类真能扩大能力面的工具。

## 六、怎么改、怎么验

```powershell
# 改完源码后重新打包（会把 app\ 拷进便携目录并重编译启动器）
cd D:\LocalModels\server
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1

# 打包前必须先停掉正在运行的应用，否则 data\ 里的文件被占用会失败
cd D:\LocalModels\dist\LocalAI
Start-Process .\启动本地AI.exe -ArgumentList '--stop' -Wait
```

> 只改了 `app.mjs` / `app.html` 时可以**跳过打包**：服务端每次请求都重新读 `app.html`，直接覆盖 `dist\LocalAI\app\` 里那两份再加一次重启即可（`app.mjs` 是启动时加载的，必须重启节点）。

现成的验证脚本（都在 `server\`）：

| 脚本 | 用途 |
|---|---|
| `probe-kv-long.mjs` | KV 复用 A/B（首字、复用率） |
| `probe-func.mjs` | 功能回归（9 项，工具调用那项会失败） |
| `probe-ui-shot.mjs` | 亮/暗主题截图（需要 CDP 端口） |
| `probe-features.mjs` | 停止/重生成/导出/设置验收 |
| `probe-reasoning.mjs` | 思考型模型拆分验证 |
| `test-think-split.mjs` | think 拆分单元测试（纯字符串，不用模型） |
| `probe-sessions.mjs` | 多会话 + 第二意见接口（33 项，不用模型，30 秒） |
| `probe-second-opinion.mjs` | 第二意见端到端（真加载两个模型，约 1–2 分钟） |
| `probe-ui-new.mjs` | 界面结构：侧栏/设置选项卡/@ 菜单（Edge headless，30 项） |
| `probe-ui-second.mjs` | 界面端 @ 全链路（真发一轮，约 45 秒） |
| `probe-ui-sessions.mjs` | 会话迁移/切换/删除/刷新恢复 + 朗读接口（23 项） |
| `probe-discover.mjs` | 嗅探模块接口（34 项，配合 fake-models 假模型，不用真模型） |
| `probe-ui-discover.mjs` | 嗅探面板 UI 全流程（23 项，首次询问→选目录→扫描→收录） |
| `probe-preload.mjs` | 多回答预加载端到端（26 项，真加载两个小模型，约 40 秒） |
| `probe-ui-preload.mjs` | 预加载 UI：开关/能力弹窗/不再提醒/设置恢复/结果提示条（35 项） |
| `probe-tools-agent.mjs` | 工具调用端到端（24 项，真加载 qwen 并真跑 4 个工具） |
| `probe-ui-tools.mjs` | 工具调用界面链路（12 项：卡片/正文/指标/刷新恢复） |
| `probe-chat-plain.mjs` | 纯聊天回归（11 项，确认改工具没把流式对话改坏） |
| `probe-web-tools.mjs` | 联网工具端到端（19 项：搜索/回落/读网页/SSRF/关闭时不注册） |
| `probe-ui-web.mjs` | 联网界面链路（34 项：默认关→须知→开启→卡片→刷新→设置→联动关闭） |
| `probe-ctx-panel.mjs` | 上下文余量浮窗（24 项：贴顶栏/数值自洽/告警配色/隐藏显示+刷新记忆/窄窗/真跑一轮/会话清理） |
| `probe-title-ui.mjs` | 标题与顶栏（13 项：状态栏位置/更多菜单/右键菜单/就地改名落盘/Esc 取消） |
| `probe-auto-title.mjs` | 自动标题端到端（5 项：两轮后生成、不是首句照抄、不置 renamed） |
| `probe-session-jump.mjs` | 会话切换顺序（4 项：切换不重排、不抬 updatedAt、真消息才置顶） |
| `probe-session-race.mjs` | 连点切会话（3 项：选中最后一次、正文对应、顺序不变） |
| `probe-code-run.mjs` | 代码块执行接口（13 项：语言可用性、超时、截断、令牌/未知语言/空代码） |
| `probe-code-run-ui.mjs` | 代码块运行界面（9 项：复制/运行按钮、执行输出、设置开关） |
| `probe-settings-tools.mjs` | 设置工具页（9 项：工具选项卡、提示词/嗅探/退出入口、面板打开关闭） |
| `probe-start-screen.mjs` | 启动页（12 项：开场白、默认新对话、问候语、模型菜单/图标、上次对话卡、输入区选项） |
| `probe-start-flow.mjs` | 启动流程（8 项：继续对话、新对话、发送退场、发送键图标） |
| `probe-discover-ui.mjs` | 嗅探面板（8 项：内容区可见、说明/扫描位置/自定义目录、扫描统计与空结果文案） |
| `probe-model-add.mjs` | 模型菜单（4 项：添加模型入口、刷新不重建、入口打开嗅探并收起菜单） |
| `probe-menu-stacking.mjs` | 模型菜单层级（2 项：header z-index、四行命中测试不被消息遮挡） |
| `probe-status.mjs` | 状态栏（6 项：只显示窗口/思考能力、tooltip 完整、长名字放得下） |
| `probe-code-panel.mjs` | 独立代码运行器（9 项：入口、语言列表与置灰、运行、草稿、清空、Esc） |
| `probe-context-switch.mjs` | 换模型保留对话（3 项：加载会话、切 Phi-4 后消息数不变、非空开场白） |
| `probe-small-features.mjs` | 小功能（6 项：复制按钮、草稿按会话保存、回到最新） |
| `probe-input-extras.mjs` | 输入侧（8 项：历史上下翻、Ctrl+N/K、Esc 清空、清空消息） |
| `probe-workspace-api.mjs` | 工作区接口（9 项：增删改查、越界拒绝、空目录删除） |
| `probe-workspace-ui.mjs` | 工作区界面（6 项：打开、行号、新建打开、保存回读、删除） |
| `probe-hero-modes.mjs` | 开场白模式（11 项：输入框、隐藏底栏、两按钮、字体/颜色、模式联动、发送切回） |
| `probe-timestamps.mjs` | 消息时间戳（4 项：每条都有、格式、悬停、新消息） |
| `probe-formula-find.mjs` | 公式复制 + 会话搜索（8 项：块级/行内复制、Ctrl+F、计数、高亮、跳转、Esc） |
| `probe-formula-panel.mjs` | 公式面板 + 化学式（7 项：化学式含裸写、MathLive 就绪、双向同步、复制、插入、关闭） |

合计 **523 条断言**。界面探针需要先把 Edge 以 headless + CDP 起起来（不需要启动器，直接打服务端口就行）：

```powershell
& "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe" --headless=new `
  --remote-debugging-port=9333 --user-data-dir="$env:TEMP\edge-dsh-probe" `
  --window-size=1440,900 --hide-scrollbars 'http://127.0.0.1:8099/'
node probe-ui-new.mjs http://127.0.0.1:9333 D:/LocalModels/server/docs/ui-new
```

> 踩过的坑 1：CDP 里改完 HTML 必须 `Page.enable` 再 `Page.reload`，否则页面还是旧 JS。
> 踩过的坑 2：两个界面探针**不要同时跑**：它们共用一个页面，会互相抢 `sessionId`。
> 踩过的坑 3：便携版启动时会 `AUTO_LOAD` 一个模型，所以探针里别假设「没有已加载模型」。
> 踩过的坑 4：探针会真发对话、真装卸模型，跑之前想清楚它会不会打断你正在用的界面。
> 踩过的坑 5：探针里的 Windows 路径别直接拼进模板字符串——`${dir}\fake.gguf` 的 `\f` 是转义符。

调试启动（带远程调试端口，供脚本连）：
```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222 --autoplay-policy=no-user-gesture-required'
Start-Process .\启动本地AI.exe
```

## 七、约定与坑

- **模型、语音资源都外置**：`<MODEL_DIR>\*.gguf` 和 `<MODEL_DIR>\tts\`，便携包只有 206MB。
- 启动器是**守护进程**：node 异常退出（退出码≠0）会自动重启；正常 `--stop`（退出码 0）不会。
- 服务停掉后再双击图标，会把服务重新拉起来。
- `app.html` 里写不了字面量 `<think>`：工具链会改写它，代码里用 `String.fromCharCode(60)` 拼。
- PowerShell 5.1 读脚本需要 **UTF-8 BOM**，否则中文乱码导致解析失败。
- 用 PowerShell 调 `/api/tts` 或 `/v1/chat/completions` 时，`-Body` 必须传 `[Text.Encoding]::UTF8.GetBytes(...)`，否则中文变问号。

## 八、详细说明①：朗读设置重构 + 多会话 + @第二意见（2026-10-18 21:52–22:06）

三项需求来自用户，实现与验证都跑过（探针清单见第六节）。

### 1) 朗读从底部条搬进设置页，自动朗读默认关

- 删掉 footer 里的 `.ttsBox`（原「音色 + 语速」两件套），改为 **设置 → 朗读** 选项卡。
- 设置面板重构成两个选项卡：`生成`（max_tokens / 温度 / 导出）与 `朗读`（引擎信息 / 默认音色 / 语速 / 试听 / 自动朗读开关）。
- 音色与语速并入 `localai.settings`（`{v, maxTokens, temp, autoRead, ttsVoice, ttsSpeed}`），旧的 `localai.ttsVoice` / `localai.ttsSpeed` 只读一次做迁移。
- **自动朗读没删，但默认关闭**：`SETTINGS_VERSION = 2`，旧配置（`v` 不等于 2）加载时 `autoRead` 一律归零一次，之后用户自己开。
- 每条回答旁边的小喇叭按钮**保留**：它读设置里的默认音色/语速（`speakText` 以设置为准，DOM 只是编辑面）。
- 试听按钮走同一个 `/api/tts`，用下拉框里的**当前值**（不必先保存），失败时把原因显示在按钮旁边。

### 2) 多会话：存在服务端磁盘，不存 localStorage

- 存储：`<MODEL_DIR>\workspace\sessions\<id>.json`，id 形如 `mvdw3hub-8a15c856`（时间前缀 + uuid 片段），严格校验 `^[A-Za-z0-9_-]{6,64}$` 防目录穿越。
- 接口：`GET/POST /api/sessions`、`GET/PUT/DELETE /api/sessions/<id>`。
- 标题字段**只存用户手动起的名字**：空表示没起过，展示时用首句推导（`displayTitle`）。这样客户端拿回空 title 不会把自动标题钉死。
- **懒建会话**：打开应用不建文件，「新对话」只是清空界面，发第一句时才 `POST` 落盘。否则点几次新对话就会堆一串空的「新对话」。
- 存盘 400ms 防抖（`saveTranscript`），切会话/删会话/新建前强制 `flushTranscript()`；落盘成功后补一次 `refreshSessions()` 让侧栏标题/时间实时更新（22:25 修）。
- 旧版 `localai.transcript.v1` 会在「服务端一个会话都没有」时自动迁移成一个会话，**且不清空旧 key**（留作备份）。
- 侧栏：`☰` 收起/展开，状态记在 `localai.sidebar`；窗口 < 980px 默认收起。

### 3) @ 征询第二意见

- 交互：输入框**下方**一个 `@` 按钮 → 弹出模型菜单 → 可多选 → 输入框下方出现 `@模型 ✕` 标签 → 发送。**发完自动清空**（每轮重新选）。
- 语义：主模型正常答完，再让被 @ 的模型「补一段看法」。喂给它的上下文是：本轮之前的历史 + 本轮提问 + 主模型回答 + 一段固定要求（只补差异、别复述、300 字内）。
- 服务端 `/api/second-opinion`：SSE 事件流 `loading → thinking → answer → restoring → done`。
  内部用 `makeMemoryResponse()` 造个假 res 去调 `handleChat()`——**必须复用同一条聊天链路**（模板/思考段拆分/上下文预算/工具），否则两套实现迟早不一致。
  `finally` 里无条件把主模型装回来，失败也要发 `restore-failed` 事件。
- 结果渲染成独立的紫色消息行（`.row.assistant.second`），有单独的朗读按钮和指标，**没有重生成按钮**（重生成会把它变成主模型的回答，误导）。
- 存档：`{role:'assistant', kind:'second', model, content, ctx}`。`ctx` 是带 `（第二意见 · 模型名）` 前缀的版本，只有它进 `history`，让主模型知道那句不是自己说的。
- 边界：如果生成期间切了会话（`sessionId` 变了），这条结果**不写盘也不进上下文**，只留在界面上看。

### 这一轮还剩的口子

- 第二意见一轮 30–45 秒，全是模型装卸的开销，UI 里只靠状态栏文字告知，没有进度条。
  **拿 R1 这种思考型模型当第二意见要 ≈100 秒**（实测：预填充 3.81s + 生成 94.2s，773 字思维过程）——
  模型本身要想 90 秒，不是卡住了。
- 多选多个模型时会**串行**换人，每个都要装卸一次，时间线性叠加。
- 侧栏没有搜索、没有置顶、没有分组；会话多了只能靠滚动。
- 会话文件没有自动清理，`workspace\sessions\` 会一直长大（单个会话上限 24MB）。

## 九、详细说明②：嗅探本地模型（2026-10-18 ≈22:28）

需求：模型散落在下载目录/桌面/别的软件里时，也能被发现并收进模型列表，不必手动搬文件。

### 行为

- **入口**：工具栏「嗅探」按钮；**首次使用**会自动弹一次询问（标记存服务端 `workspace\discovery.json` 的 `onboarded`，换机器才再问）。
- **扫描范围**：常见位置（下载/桌面/文档、`~\.cache\lm-studio\models`、`~\.ollama\models`、`%APPDATA%\CherryStudio`、`D:\Models`、`D:\AI`）+ 用户自己加的目录（持久化在 `discovery.json` 的 `customDirs`）。**只读**，不动原文件。
- **收录**：同盘建**硬链接**（瞬间完成、不额外占空间），跨盘自动退回复制。原文件留着，删链接不影响原文件。

### 三个关键实现点

1. **靠文件头认模型，不靠后缀**。`isGguf()` 读前 4 字节比对 `GGUF`——Ollama 的模型是内容寻址的 `sha256-<hex>` blob，根本没有 `.gguf` 后缀，只能这么认。
   Ollama 的名字还要反查 `~\.ollama\models\manifests`：manifest 里 `layers[].mediaType` 含 `model` 的那层的 digest 对应 blob 文件名，路径末两段拼成 `名字:tag`。
2. **三重上限**：深度 6、文件数 60000、时间 15 秒。超了就返回 `truncated: true`，UI 明确提示「加点自定义目录缩小范围」，而不是假装扫完了。
   实测本机 16964 个文件 309ms 扫完。
3. **降噪**：`MODEL_DIR` 第一层的 `.gguf` 本来就在模型选项卡里，直接从候选里剔除，否则列表一开就是 4 条「已收录」。
   人工丢进 `MODEL_DIR` 子目录的分片仍会列出——那才是真需要处理的。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/discover/config` | `onboarded` / `customDirs` / `modelDir` / `home` / `common` / `existing` |
| POST | `/api/discover/config` | 改 `onboarded` / `customDirs` |
| POST | `/api/discover/scan` | `{includeDefaults, dirs}` → 候选列表 + 遍历统计 |
| POST | `/api/discover/adopt` | `{paths:[...]}` → 逐个收录，返回 `method`（hardlink/copy/existing） |

### 测试怎么造

不需要真模型：造几个带 `GGUF` 魔数的稀疏文件即可（见 `probe-discover.mjs` 的 fixture 约定）。
两个探针都是**自复位**的（开场清空模型目录 + 把 `onboarded` 置回 false），可以反复跑。

```powershell
# 起一个假的模型目录来测嗅探，别拿真模型目录当实验场
$env:PORT='8096'; $env:MODEL_DIR='D:\Test For DSH Harness\fake-models\library'; node app.mjs
node probe-discover.mjs http://127.0.0.1:8096 'D:\Test For DSH Harness\fake-models\src' 'D:\Test For DSH Harness\fake-models\library'
```

### 还没做的

- 不做「删除模型」（只管收录，删要用户自己去目录里删，避免误删 4GB 文件）。
- 不跟随符号链接/junction，不扫网络盘（会卡死）。
- 分片模型只认第一片：`-00002-of-00003` 这类后续片既不进候选列表，硬要收录也会被明确拒绝（`isShard` / `isFirstShard` 复用自 `scanModels()`）。
- 收录后没有「撤销」按钮；删错了得自己去 `MODEL_DIR` 删文件（硬链接删掉不影响原文件，这点是安全的）。

## 十、评估过但**暂不做**：把 Piper 封装进软件目录（2026-10-18 ≈22:53）

需求是让便携包「拿到别人机器上、断网也有声音」。结论：技术上可行，但**暂缓**，原因和前置条件记在这里，免得下次重新推一遍。

体积实测：`tts\piper` 37.0MB（其中 `libtashkeel_model.ort` 9.8MB 是阿拉伯语变音模型、`ru_dict` 8.1MB 是俄语字典，对中文完全无用）+ `voices\zh_CN-huayan-medium.onnx` 60.3MB。全带 = 包体 207MB → 约 305MB（+47%）。

要做得先过四关：

1. **打包脚本会删掉它们**：`build-portable.ps1` 清空整个 `dist\LocalAI`，只保留 `data\`。放进 `dist\LocalAI\tts\` 的东西下次打包即蒸发，必须放进被复制的源（如 `server\tts\`）或扩一份保留名单。
2. **路径解析是单一来源**：`TTS_DIR = process.env.TTS_DIR ?? MODEL_DIR\tts`。要「包内自带 + 外置覆盖」，得改成候选链，且 `piperVoices()` 现在只扫一个目录，要改成多来源合并。
3. **缓存得挪出去**：`TTS_CACHE_DIR` 在 `tts\cache`，上限 200MB；tts 进 app 目录后这些会算进安装体积，重打包又被清。应固定到 `workspace\tts-cache`。
4. **音色再分发许可**：piper 二进制是 MIT，但 VITS 音色各有自己的许可。打进安装包 = 再分发，义务比「用户自己下载」重。这条必须由发布者确认，不能代判。

真要做的话，最省的是「piper 二进制（裁掉阿拉伯/俄语数据约 20MB）+ 一个 x_low 音色（约 20MB）」，增量约 40MB；外置 `<MODEL_DIR>\tts` 保留为覆盖/追加来源，现有 60MB medium 音色不受影响。

注：**对本机没有收益**——Edge 在线音质最好且实测可用，Piper 只是断网兜底；这件事是为「发给别人」投资。

## 十一、详细说明③：多回答预加载（2026-10-18 ≈23:05–23:35）

需求原文三层意思：①加一个「多回答时是否预加载」的开关；②**开启前弹窗警告**，警告时要**先嗅探设备能力**判断是否支撑得住「被预加载的模型在后台同时运行」；③弹窗下方给「我已知晓，不再提醒」，勾了就不要再问，且**设置里能重新打开提醒**。默认不勾选。

### 为什么必须"真常驻"

之前第二意见的做法是「卸主模型 → 装目标模型 → 作答 → 装回主模型」，一轮 30–45 秒，而且**主模型的 KV 缓存被白白丢掉**，下一轮要重新预填充。

预加载把被 @ 的模型**提前装进内存并常驻**，第二意见直接用它作答：
主模型原地不动，KV 缓存完整保留。实测从 13.9s（`qwen3-5-4B` + `Phi-4-mini` 双模型），事件流里连 `loading` 都没有。

### 服务端：`extras` 表 + 三个接口

`const extras = new Map()`：`file → { model, context(4K), wrappers, bytes, busy }`，与 `state.*` 完全独立。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/capacity?files=a,b` | 能力核算：内存总量/可用、每个目标的占用与余量、整体结论与建议 |
| GET/POST | `/api/preload` | 查常驻清单 / 预加载指定模型（内存不够时 **409 拒绝**） |
| POST | `/api/preload/clear` | 释放全部或指定模型 |

`/api/second-opinion` 现在分两段：**先跑已常驻的**（不碰主模型），**再跑需要换人的**（换人前先 `clearExtras()`，否则峰值是「主模型 + 常驻 + 目标」三份权重，正好把内存压死）。`done` 事件多返回一个 `swapped`，前端据此决定状态栏说「KV 保留」还是「KV 已清空」。

### 能力核算的算法（宁可保守）

```
目标占用 = 权重 × 1.15（加载期拷贝/对齐的临时量） + 0.8GB（上下文与运行时开销）
余量     = 当前可用内存 − Σ目标占用
判定：余量 ≥ 2GB → ok ｜ 0 < 余量 < 2GB → tight ｜ 余量 ≤ 0 → insufficient
```

用的是 `os.freemem()` 而不是 commit——Windows 的 standby 会被回收，`freemem` 偏保守，宁可低估余量也别把机器拖进换页。

本机实测：4 个模型**逐个看都 ok**（余量 +3.9 ~ +6.6GB），**全部一起看 insufficient**（差 9.1GB）。所以 UI 在「还没选 @ 模型」时逐行列出、只要有一个能装就允许开启；内存不足的那些即使开了开关，服务端也会逐个拒绝。

### 交互细节

- 开关在输入框下方（`@` 右侧），默认不勾。- 勾上 → 先弹能力检查（不直接生效），弹窗里有内存元信息、逐模型账单、结论色块、「我已知晓，不再提醒」、取消/仍然开启。**确认前开关保持未勾选**。
- 勾了「不再提醒」→ 以后直接生效，不再弹窗；但**内存不够仍会拒绝**并把原因写进状态栏（提醒可以关，安全闸不关）。
- 设置 → 生成 →「多回答预加载」：`开启前显示能力检查提示`（= 去掉不再提醒）+ `清空预加载` 按钮 + 当前常驻状态。
- 开关开着时，在 `@` 菜单里选中即预加载、取消即释放；常驻状态显示在输入框下方的灰字里。

### 结果提示：为什么必须是左下角一条独立的条

预加载完成/取消是一次性结果，**不能塞进状态栏**：`refresh()` 每 3 秒会把状态文字整体重写一遍，
写进去也活不过一轮轮询。所以另起 `.toasts`（左下角固定，`z-index:60`）：

- 完成：`预加载【Phi-4-mini】已完成，占用 2.32 GB 内存`（绿）
- 取消：`预加载【Phi-4-mini】已取消，释放 2.32 GB 内存`（琥珀）
- 失败：`预加载【X】失败：<原因>`（红，停留 6 秒）
- 复用：`【X】已在内存中，无需重复加载`（青）
- 只看开关不看模型：`已开启多回答预加载，选中 @ 模型后会自动装入内存`

每 4.2 秒自动淡出，最多同时留 4 条（顶掉最老的）。释放量不是猜的：`clearPreload` 前后各取一次
`extras` 快照，`toastReleased()` 用差集算出「哪几个真的没了、各自多大」——所以批量释放会逐条报，不会糊成一句总量。

### 实测（数字）

| 项 | 结果 |
|---|---|
| `probe-preload.mjs` | 26/26：能力公式自洽、预加载 11.6s、重复预加载直接复用、第二意见无 `loading`、`swapped=false`、主模型仍在 |
| `probe-ui-preload.mjs` | 31/31：默认不勾、弹窗账单 4 行、结论色、不再提醒生效、设置可恢复提醒、选中 @ 即常驻、取消 @ 即释放 |
| 第二意见耗时 | **13.9s**（原 30–45s）；主模型 KV 缓存保留 |

### 还没做的

- 预加载的模型在「切换主模型」时不会被清（设计如此，避免用户刚热好就没了），但如果正好切到同一个文件会先释放再装（`loadModel` 里处理）。
- 常驻模型不参与 KV 复用，每个第二意见都重新 prefill——量小（问题+主回答约 200–500 tok），不值得为它做序列复用。
- 没有「预加载进度条」：装 4GB 模型时界面只有一行灰字，约 10–15 秒。
- 内存核算只算内存，不算显存：核显共享内存，所以两者本来是一笔账；换成独显机器时这套算法需要重写。

## 十二、详细说明④：修好工具调用（Agent 能力，2026-10-18 23:25–23:38）

原来「工具调用完全不可用」不是模型不行，是**链路上有一层静默失败**。这次把它拆掉重做。

### 根因

`node-llama-cpp` 的函数调用依赖 chat wrapper 从 **jinja 模板里探测**工具语法
（`extractFunctionCallSettingsFromJinjaTemplate`：拿假的函数调用历史去渲染模板，看占位符有没有被正确吐出）。

探测失败时：`functionCallSettings` 为 null，而 `_requireFunctionCallSettingsExtraction` 默认为 false
（`JinjaTemplateChatWrapper.js:212` 那段），于是 **`functions` 被静默丢弃**——不报错、不警告。

结果就是上家看到的现象：模型知道要调工具（提示词里有描述），于是按 Qwen 原生格式吐
`<tool_call>{...}</tool_call>`，但没有任何代码解析它，最后原样显示在气泡里。

### 做法：不再依赖那层探测，自己定协议

1. **工具改成纯数据注册表**（`buildToolRegistry`）：`{name, description, params, run}`。
   `run` 内部仍走 `record()` 记 journal、回调 `onCall`，界面照旧能看到真实输入与结果。
2. **说明书拼进系统提示**（`buildToolInstructions`）：工具清单 + `<tool_call>` 格式 + 5 条硬规则
   （"时间/日期/计算/文件一律用工具"）。
   关键是它拼在 `sessionKeyOf()` **之前**，所以勾掉工具会让会话指纹变化、重建会话，
   而不是复用带旧提示的会话。
3. **自己的 Agent 循环**（`handleChat` 里的 `toolsEnabled` 分支）：
   `session.prompt(user)` → `parseToolCalls()` → 逐个 `toolRegistry.run()` → 把结果以
   `<tool_response>` 回填 → 再 `session.prompt()` → 直到没有调用块。
   上限 `TOOL_ROUND_LIMIT`（默认 4，环境变量 `TOOL_ROUNDS` 可调），到顶会明确告诉用户，不会无限刷。
4. **解析器容错**：JSON 坏了就截首尾花括号重试；`arguments` / `params` / `args` 三种字段名都认。
5. **正文净化**：`stripToolCalls()` 把调用块与回填块从最终正文里剥掉——用户只看答案，不看原始标记。

### 一个必须说清的取舍：工具路径不逐 token 流式

`<tool_call>` 这串标记会被 tokenizer 拆到两个 token 之间，边流边滤必然漏（把半个标记吐给用户）。
所以这条分支是「每轮跑完再一次性推正文」：工具事件仍然实时推（卡片先出现），正文最后整块出现。
正确性优先于打字机效果——纯聊天路径（`tools:false`）保持原样流式，实测仍是 40 块增量。

### 实测（qwen2.5-7B，本机）

| 工具 | 实测结果 |
|---|---|
| `get_current_time` | 返回 `2026/10/18 23:29:24`、`星期日`，回答「现在是2026年10月18日23点29分24秒」 |
| `calculate` | `(1234*56)+78` → **69182**，回答里带上正确结果 |
| `list_local_models` | 返回 4 个真实模型与体积，回答里列出模型名 |
| `read_workspace_file` | 读出 `workspace\note.txt`：「项目代号：天枢 / 负责人：阿甲 / 状态：工具调用联调」 |

一轮问答约 **10.6 秒**（含一次工具往返），指标显示 `工具 1 次 0.00s`、`rounds: 2`、
预填充复用 74–78%（第一轮仍吃到了 KV 缓存）。

### 验证

| 探针 | 结果 |
|---|---|
| `probe-tools-agent.mjs` | **24/24**（四个工具真执行 + 流式事件 + 关闭工具 + 不需要工具时不乱调） |
| `probe-ui-tools.mjs` | **12/12**（勾选 → 卡片 → 正文 → 指标 → 刷新后卡片与正文都从存档恢复） |
| `probe-chat-plain.mjs` | **11/11**（纯聊天回归：40 块流式、KV 复用 58%、会话接口正常） |

同一条 `probe-tools-agent` 在**发布包 8099** 上也是 24/24。

### 还没做

- 工具只有 4 个，且都很"内置"：没有 Web 搜索、没有目录遍历、没有代码执行。
  Agent 能力的地板抬起来了，天花板还在原地。
- 工具路径没有增量流式（见上）；长回答时会有一段"静默"。
- 只测了 qwen2.5。R1 这类思考模型是否愿意按格式输出、`<tool_call>` 会不会跟 `think` 标签打架，都没验证。
- 多轮工具往返时每轮都重新 prefill，没有跨轮 KV 复用（工具结果会改历史，复用本来也不好做）。

## 十三、详细说明⑤：联网能力（Web 搜索 + 读网页，2026-10-19 23:00 – 10-20 00:46）

需求只有两个字「Web」，加上一句追问「为什么不让用百度」。两次误判都出在**测试方法**上，先记下来。

### 两次误判

| 判断 | 错在哪 | 事实 |
|---|---|---|
| 「百度返回 227 字节，反爬拦截，不能用」 | 用短 UA 测了一次就下结论 | 换完整 Chrome UA 后返回 **1.4MB / 2.2MB** 正常结果 |
| 「这个 IP 被判定为自动化了」 | 连续请求几次都被拦，误当成 IP 级封禁 | 换成**移动 UA** 立刻恢复 1.85–1.9MB。**百度是按 UA 拦人，不是按 IP** |

结论：百度一律用移动 UA + `m.baidu.com`。Bing 反而不挑 UA，10 次全部 200 / 102KB / ~358ms。

### 双引擎与自动回落

- `web_search(query, engine?)`，`engine` 可为 `auto`/`baidu`/`bing`。
- `auto`：中文查询 → 百度优先；其它 → Bing 优先。
- 百度被拦的判定：`字节数 < 20000` 或页面含「百度安全验证 / wappass.baidu.com」。
- 回落时把原因写进结果：`fallbackFrom` + `fallbackReason`，**界面上会显示**「baidu 被拦，已回落」，不静默换源。
- 两个引擎都失败时抛错，工具返回 `{error}`，模型拿不到结果就不会编。

### 百度结果怎么解析

移动版**没有可直接抓的 href**：标题在 `<h3 class="cosc-title">`，真实地址藏在属性里编码过的 JSON
（`dataUrl&quot;:&quot;https://…&quot;`）。实测一页 **8 个标题 / 7 个地址**，按出现顺序配对；
配不到地址的条目明确标 `note: 该条没有可直接访问的地址`，不假装有。
Bing 则是 10 个 `b_algo` 块，`<h2><a>` + `b_lineclamp` 摘要，稳定好取。

### 安全：SSRF 防护

`fetch_url` 只允许 http/https，并且**拒绝本机与内网**：`localhost`、`127.`、`10.`、`192.168.`、
`172.16-31.`、`169.254.`、`.local/.internal`、`::1`。
跳转是**手动逐跳跟随**（`redirect: "manual"`，最多 4 跳），每一跳都重新校验——否则一个 302 就能绕过。
实测：模型被要求读 `http://127.0.0.1:8099/api/state`，工具返回「拒绝访问本机/内网地址」，且没有泄露 `localToken`。

### 开关与知情（按用户要求）

- **默认关闭**，且挂在「调用工具」之下（没有工具循环，光有搜索能力也没人会用）。
- **首次开启弹须知**，列清五件事：查询词会发给第三方；只访问公网、内网拒绝；有些站点本来不通（DuckDuckGo / Wikipedia 实测超时）；网页正文会截断到约 6000 字；断网或全被拦时工具会失败、模型要如实说。
- 弹窗底部「我已知晓，不再提示」；恢复入口在 **设置 → 生成 → 联网 → 开启前显示须知**。
- 关掉「调用工具」会**连带关掉联网**，并在提示条里说明——避免"联网开着但根本不会用"的假状态。

### 过程可见

搜索结果不是塞进折叠 JSON，而是专门的卡片（对话框紧邻区域）：

```
本次联网：搜索 1
联网 · 搜索「Qwen2.5 上下文长度」   8 条 · 引擎 bing（baidu 被拦，已回落）
  1. Qwen2 | Qwen2 详细介绍（官方文档）- 知乎
     https://zhuanlan.zhihu.com/p/703883561
  …
```

读网页时显示 `联网 · 读取 example.com   200 · 171 字 · Example Domain` 并给出正文前 600 字。
卡片与摘要在**刷新后从存档恢复**（`entry.tools`）。

### 附带修掉的一个谎报

模型曾在没有 `web_search` 的情况下凭记忆调用它，工具返回「没有这个工具」，它却对用户说「我查到了一些新闻」。
现在未知工具的错误里带 `availableTools` 清单和一句明确要求（"只能使用这些工具，没有就如实说"），
把模型拉回来，而不是让它顺着猜测继续编。

### 开关位置（2026-10-20 调整）

开关最初放在工具栏、紧挨「调用工具」。用户要求挪到**输入框下方**——理由站得住：联网是"这一问要不要带网络"的临时决定，
和 `@`、多回答预加载同属"发送前的选项"，放在输入框旁边才顺路。现在的位置：

```
[输入框]
[@] 点 @ 征询第二意见   [已常驻 Phi-4-mini]            ☑ 联网搜索  ☐ 多回答预加载
```

右侧两个开关由 `.askToggles` 一组承载（`margin-left:auto`），常驻状态 `#preloadState` 紧挨在它们左边。
`#webChk` 仍受「调用工具」约束：未勾工具时置灰，标题里写明要先勾。

### 一个渲染层的真 bug（顺手修掉）

第一版搜索结果里出现过 `Qwen2 &#183; Hugging Face`——`htmlToText()` 只解了 `&amp;` 这类**命名实体**，
没解**数字实体**，而 Bing 的标题正是用 `&#183;` 表示「·」。已加两条替换：

```js
.replace(/&#(\\d{1,6});/g, (_, n) => String.fromCharCode(Number(n)))
.replace(/&#x([0-9a-f]{1,5});/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
```

复测标题正常显示「·」，结果 JSON 里再无 `&#`。这类问题不会报错，只会安静地难看——靠截图才看得见。

### 验证

| 探针 | 结果 |
|---|---|
| `probe-web-tools.mjs` | **19/19**：真搜索（回落链路可见）、真读 example.com、SSRF 拒绝、关闭时不注册、流式事件 |
| `probe-ui-web.mjs` | **39/39**：默认关 → 开关位置 → 须知 5 条 → 开启 → 搜索卡片 → 刷新恢复 → 设置恢复提示 → 联动关闭 |
| 发布包 8099 | `probe-web-tools` **19/19** |

### 还没做

- 只有两个引擎，且都是**抓页面**：百度随时可能改版/加验证，Bing 也可能。没有 API key 兜底方案。
- 没有「先搜后自动读多页」的编排；模型得自己决定要不要 `fetch_url`（受 4 轮上限约束）。
- 网页正文是粗暴去标签，不认正文提取算法（Readability 那类），长文里会混进导航与页脚。
- 不处理需要登录/JS 渲染的页面；PDF 不解析。
- 联网路径同样不逐 token 流式（与工具路径一致）。

---

## 2026-10-25 阶段总结：编辑器、工作区、公式与开场白

这一轮从「把代码运行单独拎出来」开始，最后落到「开场白 + 公式面板 + 化学式」。下面是全量清单与验证数据。

### 一、新增功能

| 功能 | 入口 | 说明 | 验证 |
|---|---|---|---|
| 独立代码运行器 | 顶栏「代码」 | 语言下拉、Ctrl+Enter、exit code/耗时、草稿持久化 | `probe-code-panel` 9/9 |
| 回答复制 | 每条回答按钮排 | 复制正文，成功打勾 | `probe-small-features` 6/6 |
| 输入草稿 | 自动 | 按会话保存，切会话/刷新不丢 | 6/6 |
| 回到最新 | 右下角浮动按钮 | 滚上去出现 | 6/6 |
| 输入历史 | ↑/↓ | 最近 20 条，去重 | `probe-input-extras` 8/8 |
| 快捷键 | Ctrl+N / Ctrl+K / Esc | 新对话 / 聚焦 / 清空 | 8/8 |
| 清空消息 | 会话右键 | 保留会话、清空消息 | 8/8 |
| 工作区 | 顶栏「文件」 | 目录树 + CodeMirror（行号/高亮）、新建/保存/重命名/删除/上传、路径越界拒绝 | API 9/9，UI 7/7 |
| 模型工具 | 工具开关 | `list_workspace_files`、`write_workspace_file`、`run_code` | 实测写文件 29.7s、run_code 16.4s → 42 |
| 开场白改版 | 启动页 | 自带输入框（隐藏底栏）、∫ Agent 模式（斜体）、推理模式（粗体宋体 + 青色） | `probe-hero-modes` 11/11 |
| 消息时间戳 | 每条消息下 | HH:MM / 跨天 M-D HH:MM，悬停完整时间 | `probe-timestamps` 4/4 |
| 公式复制 | 公式上 | 块级悬停按钮、行内点击复制 | `probe-formula-find` 8/8 |
| 会话内搜索 | Ctrl+F | 高亮、计数、上下跳、Esc | 8/8 |
| 公式面板 | 顶栏「公式」 | MathLive 可视化、LaTeX 双向同步、插入输入框 | `probe-formula-panel` 7/7 |
| 化学式 | 对话内 | mhchem，`\ce{}` 与裸写都渲染 | 7/7 |

### 二、修掉的 bug

1. **换模型清空对话但存档还在** → 按 transcript 重建 history，对话保留（`probe-context-switch` 3/3）。
2. **自动标题每轮重写** → 已有标题就跳过。
3. **删除会话后右下角卡片指向已删会话** → 同步收起。
4. **工具调用被 max_tokens 截断时原始 `<tool_call>` 泄漏到正文** → 接受未闭合块并从正文剔除；空正文给「调用被截断」提示；实测 48 token 截断只显示提示、无泄漏。
5. **CodeMirror rust 模式报 `defineSimpleMode is not a function`** → 补 `addon/mode/simple.js`。
6. **KaTeX 0.19 的 mhchem 是 ESM**，classic 加载报 import 错误 → 生成去 import 的 classic 版本。

### 三、新增资源（均本地）

| 资源 | 体积 | 用途 |
|---|---|---|
| CodeMirror 5.65.16 | 约 400KB + modes | 工作区编辑器、代码高亮 |
| MathLive 0.105.0 | 785KB + 250KB 字体 | 公式面板 |
| mhchem（classic） | 67KB | 化学式 |

### 四、当前状态（2026-10-25 09:41）

- 模型：`qwen3-5-4B-Q4_K_M.gguf`，上下文 16384，4 个模型可用；
- 会话：13 条；
- 断言总数：**523**（本轮新增 9 个探针、63 条断言，460 → 523）；
- 服务：`http://127.0.0.1:8099`，仅本机绑定。

### 五、没做 / 下一步

- 手机 / 局域网访问（需绑 0.0.0.0 + PIN + 窄屏布局）；
- 导出 HTML（公式离线可看）；
- 文档 RAG（BM25 切片）；
- 真断点调试（只讨论过 DAP 钩子，未实现）；
- 代码模式嵌进对话（左右分栏）——被判定成本偏高，先停在独立面板。

---

## 十四、命令行接口 `localai`（2026-10-25 10:34）

服务本来是「界面 + HTTP」，脚本、CI、一次性提问都得自己拼 curl。这一笔加了个薄客户端：**只是 `/v1/chat/completions` 与 `/api/*` 的封装，不进服务端逻辑**，所以对界面零影响。

### 用法

```powershell
localai "用一句话解释 KV 缓存"             # 一问一答，流式
localai ask --tools "现在几点"             # 开工具（时间/计算/读文件/联网/跑代码）
localai chat                              # 交互式多轮：/exit /new /model /state
localai models | load <文件> | unload | state | sessions
localai run python "print(6*7)"           # 复用 /api/run（10s 超时 / 64KB / 令牌）
Get-Content spec.md | localai ask -       # stdin 当提问
localai --json --no-stream "答两个字：好"  # 给脚本用
```

常用开关：`--model` `--session <id>` `--save` `--json` `--no-stream` `--tools` `--web` `--think` `--max-tokens` `--temp` `--system` `--quiet` `--url`。

### 三个设计决定

1. **正文走 stdout，诊断走 stderr**（工具卡片、耗时、token 数）。所以 `localai "..." > answer.txt` 拿到的就是干净回答。
2. **`ask` 无状态、`chat` 有状态**。`ask` 每次只发一条 user；要多轮就用 `--session <id>`，它会把会话历史读进来，加 `--save` 再把这一轮写回去——脚本里做多轮不必自己管上下文。
3. **管道输入先读完再逐条处理**。第一版用 readline 直接喂，管道下 stdin 一秒读完就 close，长回答还没结束第二行就取不到了，只剩第一轮有效。
4. **没加载模型时挑最小的那个**（`--model` / `LOCALAI_MODEL` 可覆盖）。CLI 多是一次性提问，2.32GB 的 Phi-4-mini 十秒可用，比默认去装 4.68GB 的 R1 合理。

### 退出码

`0` 成功 · `1` 服务端报错 · `2` 用法错 · `3` 连不上服务（提示去开 `dist\LocalAI\启动本地AI.exe`）。脚本里可以据此分支。

### 落地位置

- 源码：`server\localai.mjs` + `server\localai.cmd`
- 打包：已加进 `build-portable.ps1` 的必要文件与复制步骤，进包后是 `app\localai.mjs`、`app\localai.cmd`
- `.cmd` 优先用包内 `..\runtime\node.exe`，源码目录自动回落到 PATH 上的 `node`；**内容保持纯 ASCII**——第一版写了中文注释，GBK 控制台把它当命令执行，满屏报「不是内部或外部命令」。

想在任何目录直接用，把 `D:\LocalModels\server`（或 `dist\LocalAI\app`）加进 PATH 即可。

### 已知边界

- 只提供 Windows 的 `.cmd`；`localai.mjs` 本身跨平台，macOS/Linux 加个同名 shell 包装即可。
- 中文在某些老控制台会乱码（Node 写 UTF-8、控制台按 GBK 解），`chcp 65001` 或 Windows Terminal 正常。
- 不带 `--session` 时每轮都是独立会话，KV 复用只在这一轮内部生效。

---

## 十五、全屏终端 TUI（2026-10-25 10:40）

需求是「能在本地跑、能从软件内部调用、形态像 TUI」。落地成两件：**一个零依赖的 ANSI 全屏客户端**，加上**顶栏一个「终端」按钮**去开它。

### 两种入口

```powershell
localai tui                        # 命令行里直接进
```

或者在应用顶栏点「终端」——服务端 `POST /api/terminal/open`（要本地令牌）用 `start` 开一个**真控制台窗口**跑 `localai-tui.cmd`。两条路跑的是同一份界面。

### 界面里有什么

- 顶栏：客户端版本、当前模型、上下文大小、工具/联网开关状态
- 对话区：用户输入青色、工具执行灰色卡片（`🔧 工具 参数 → 耗时`）、错误红色、系统提示紫色
- 输入行：光标随中文宽度走，超宽时窗口左移保证光标可见
- 状态行：`Enter 发送 · ↑↓ 历史 · PgUp/PgDn 滚动 · /help`，生成中变成 `Ctrl+C 中断`
- 斜杠命令：`/help /new /model /tools /web /think /state /run /clear /exit`

### 四个必须写对的细节

1. **中文按 2 列算**。折行、截断、右侧补空格全走同一个 `charWidth()`，否则一屏中文会让边框逐步歪掉——`--snapshot --cols 60` 就是用来肉眼查这个的。
2. **模型输出先剥控制码**。`stripAnsi()` 在上屏前把 ESC 序列清掉，不然模型回一段 `ESC [2J` 就能把界面刷没。
3. **没有 TTY 就降级**。被管道/重定向时 `isTTY` 为 false，自动切成逐行模式（`/state` 这类命令结果直接打印），所以 `echo ... | localai tui` 也能用，脚本里不会卡住。
4. **`main()` 必须挂住**。第一次实现里 `main()` 挂完事件处理器就 `return`，外层 `.then` 立刻 `process.exit` → 窗口开出来秒关。现在结尾 `await` 一个永不 resolve 的 Promise，退出只走 `bye()`。

### 验证方式（终端界面没法自动截图，靠这三条）

| 手段 | 作用 |
|---|---|
| `--selftest` | 7 组宽度/折行/补齐/剥码断言，不需要服务 |
| `--snapshot [--cols N]` | 把一帧渲染成纯文本打出来，直接看边框是否对齐 |
| 起一个真控制台 | 进程存活 5 秒且无 stderr，说明 raw mode 与首帧渲染都过了 |

### 已知边界

- 只做了 Windows 控制台；Linux/macOS 上 `localai tui` 理论上能跑（纯 ANSI），但没实测。
- 不做语法高亮、不做 Markdown 渲染，模型正文按纯文本上屏（含代码块）。
- 滚动只有 PgUp/PgDn，没有鼠标。
- 一次只跑一轮：生成中按 Enter 会被拦下并提示，避免和服务端单会话抢资源。

---

## 十六、会话自动快照（2026-10-25 10:44）

起因很直接：10-25 上午一次探针把 13 条真实会话删了，服务端是 `unlink`，回收站和卷影副本都没有，**一条都找不回来**。通用产品有云端兜底，私人工具只能自己给自己兜底。

### 机制

- **写前留档**：`writeSession` 在覆盖会话文件之前，先把**原文字节**（不是解析后的对象）写到 `workspace\session-snapshots\<yyyy-mm-dd>\<id>.<HH-MM-SS-mmm>.json`。
- **内容没变不留**：上游那句「内容相同就不抬 updatedAt」的判断在留档之前，所以纯切换会话不会产生快照。
- **保留策略**：单会话最多 20 版（按文件名时间序砍最老的）；按天目录，超过 30 天的整目录删。清理在启动时跑一次，之后每次留档顺带跑。
- **回滚也是写**：`POST /api/sessions/<id>/restore` 走的是同一个 `writeSession`，所以**回滚前那版也会被留档**——回滚不是单向门，撤错了能再撤回来。
- **要本地令牌**：回滚是覆盖操作，`x-local-token` 不对直接 403。

### 界面

侧栏会话右键 → **历史版本…** → 列出「日期 时分秒 · 条数 · 体积 · 标题」→ 点「恢复」二次确认。截图：`docs\ui-new\snapshot-panel.png`。

### 两个坑

1. **时间戳只到秒会撞名**。第一次实现里「回滚」紧接着「再存一次」在同一秒内发生，后写的把先写的盖掉——正是快照要防的那种丢失。改成到毫秒后，3 秒内 4 次写盘得到 4 份独立快照。
2. **快照要存原文**。解析成对象再序列化会丢字段（比如将来加的新字段），快照失去「原样」的意义。

### 已知边界

- 只保护「会话被改/被删」这一种损失，**不防误删整个 `workspace` 目录**（那需要另做导出/异地备份）。
- 不压缩：单会话最坏情况 20 × 24MB（会话上限）。日常 10KB 级文件可以忽略，但真有超大会话时要靠天数清理兜底。
- 快照目录不在界面上可见，只能进「历史版本」面板看；手工恢复直接拷文件也能用。

---

## 十七、首次使用引导与模型下载（2026-10-25 10:50–10:56）

需求原话：「初次使用要求嗅探本地模型，并且给出模型下载按钮，按下后选择下载通道（ModelScope 或其他）下载模型」。

### 流程

1. 首启（`workspace\onboarding.json` 里 `done=false`）自动弹「开始使用 · 准备模型」。
2. **① 先嗅探本机**：自动调 `/api/discover/scan`（常见目录 + 自定义目录），列出候选，勾选后「收录所选」走硬链接。
3. **② 或者直接下载**：默认 ModelScope，三个档位（396/469/644MB）；也可切「其他通道 / 自定义链接」填任意 http(s) 直链 + 文件名。
4. 下载有进度条、速度、剩余时间、取消；下完自动加载，并把新模型刷进模型列表。
5. 点「完成，进入应用」写回 `done=true`；如果用户没自定义过系统提示词，**自动应用一段为小模型写的推荐提示词**（可在 设置 → 工具 → 提示词 改）。

### 下载器实现要点

- **必须带浏览器 UA**：ModelScope 对默认 Node UA 直接 403（含 Range 请求），换 Chrome UA 后实测 5.8MB/s。
- **手动跟随重定向**：ModelScope 会 302 到 CDN，`https.get` 不会自动跟，最多 6 跳。
- 先写 `\.downloads\<file>.part` 再 `rename`，中途失败不会留下半个 .gguf 被 scanModels 当成模型。
- 进度靠 `data` 事件累加，速度用最近 16 个采样点算，避免一开始的抖动。
- 下载目录 `MODEL_DIR\.downloads`，文件名强制限定字符集，防路径穿越。

### 顺带修的三件事

1. **`build-portable.ps1` 丢 BOM**：我编辑过它，BOM 被写掉，PS 5.1 按 GBK 读中文注释直接语法错误。补 `EF BB BF` 后通过。这条正是第七节「约定与坑」里写过的那一条，被自己踩了一次。
2. **`--stop` 后启动器不退**：它的 WebView2 子进程占着 `data\`，打包清空旧产物时 `Move-Item` 失败。按 `CommandLine -like '*LocalAI*'` 精确杀，未误伤 DSH 自己的 WebView2。
3. **`AUTO_LOAD` 指向不存在的模型**：新机器上配置里写的是 7B，用户刚下的是 0.5B，原来只会打一行日志、界面停在「先加载一个模型」。现在回退到目录里最小的那个。

### 实测数字

| 项 | 结果 |
|---|---|
| 下载 | `qwen2.5-0.5b-instruct-q4_k_m.gguf` **468.6MB**，落盘完整 |
| 小模型可用性 | 加载后 **2.3s** 答出「递归是函数调用自身以解决问题的编程技术」 |
| 首启嗅探 | 18226 个文件，0 个候选（库里的 4 个已被降噪剔除），符合预期 |
| 打包产物 | **209MB / 3430 文件**（另有 83MB 运行期 data 缓存） |
| 起包验证 | 引导弹出、两通道三档位、无 JS 错误、模型列表 5 个 |

### 还没做的

- **断点续传**：中断即重来，470MB 在 5.8MB/s 下约 80 秒，暂时可以接受。
- **下载源的可用性探测**：现在只有 ModelScope 一个内置源 + 手动链接，没有多镜像自动测速。
- **模型删除**：只管下，不管删（与嗅探一致，避免误删 4GB 文件）。

---

## 十八、插件系统（2026-10-26 23:38）

目标：让「加一个工具」变成「丢一个文件」，不用改 app.mjs、不用重启。

### 契约（一个 .mjs 三件事）

```js
export const name = "disk_space";                  // 字母/下划线开头，模型看到的就是它
export const description = "查询各磁盘剩余空间";      // 模型靠这句决定要不要调，要写清楚「什么时候用」
export const params = { type: "object", properties: {}, required: [] };  // 可选
export async function run(args, ctx) {
  return { ok: true };   // 返回值必须能 JSON 化
}
```

`ctx` 给的是 `{ workspace, modelDir, log }`，插件里也能自己 import 任何 Node 模块。

### 落地方式

- 目录：`<安装目录>\plugins`（源码目录是 `server\plugins`）。服务启动时读一遍，并用 `fs.watch` 监听，改文件 400ms 后自动重载。
- 注册：`buildToolRegistry()` 末尾把可用插件塞进 `defs`，和内置工具走**同一个 `record()`**——所以界面上的工具卡片、耗时、journal 表现完全一致，没有第二套渲染。
- 隔离：单个插件 import 失败只标记为 `ok:false` 并写日志，不影响其它插件和主流程。重名自动加 `_2` 后缀。
- 接口：`GET /api/plugins`（列表/错误）、`POST /api/plugins/reload`、`POST /api/plugins/open`（打开目录）。
- 界面：设置 → 工具 → 「插件」：可用数、逐个名字与说明、失败原因、重新加载、打开目录。

### 随包示例

| 文件 | 作用 | 演示了什么 |
|---|---|---|
| `hello.mjs` | 回显名字与时间 | 最小模板 |
| `disk.mjs` | 查各盘剩余空间 | 用 Node 模块（`statfs`） |
| `notes.mjs` | 往工作区 `notes.md` 追加/读取便签 | 用 `ctx.workspace` |

### 实测

| 项 | 结果 |
|---|---|
| 加载 | 3 个全部 `ok`，日志逐条打印 |
| 模型调用 | 问「磁盘还剩多少」→ 真调 `disk_space`（3ms）→ 按结果答 C 盘 165.5GB / D 盘 309.6GB |
| 热重载 | 给 `hello.mjs` 追加一行注释，2 秒后 `loadedAt` 变化，3 个插件仍可用 |
| 界面 | 设置 → 工具显示「3 个可用」+ 逐个说明，无 JS 报错 |
| 打包 | `build-portable.ps1` 自动带上 `plugins\`，日志「已附带插件 3 个」 |

### 安全边界（写进界面提示了）

插件和主进程同权限：能读能写能联网。只放自己信得过的文件；不要把来路不明的 .mjs 丢进去。

---

## 十九、外观自定义（2026-10-26 23:48）

把「长什么样」交还给用户。入口：**设置 → 外观**。

| 能改 | 落点 | 说明 |
|---|---|---|
| 主色 | `--accent` `--accent-2` `--cyan` `--glow-c` `--accent-soft` | 6 个预设 + 任意取色；按钮、高亮、边框、发光一起走 |
| 整体缩放 | `body.style.zoom` | 80–140%，高分屏或坐得远时用 |
| 背景图 | `body` 背景 + `.hasBg` 暗色蒙版 | 选图即存 dataURL（≤1.5MB），保证文字可读 |
| 自定义 CSS | 注入 `<style id="userCss">` | 逃生舱：任何看不顺眼的地方一条 CSS 改掉 |

存储：`localStorage['localai.appearance']`，刷新保留；「恢复默认外观」清空全部。

### 为什么这样做

- 整个界面本来就长在 CSS 变量上，所以**改主色不用动任何一条规则**，只换变量值。
- 缩放用 `zoom` 而不是 `html{font-size}`：这套样式里字号大量写死 px，改根字号没用。`zoom` 是 Chromium 专有但本项目只跑 WebView2/Edge，可以接受。
- 自定义 CSS 放在最后注入，天然覆盖内置样式；写坏了点恢复默认就回来。

### 还能往前一步（没做）

- 主题包（一套 JSON 同时带主色/背景/圆角/间距），可导入导出分享
- 圆角、间距、字体族单独暴露（现在要写 CSS 才行）
- 每会话独立外观（现在全局一份）

---

## 二十、2026-10-27：全量探针巡检 + 会话备份到别处

### 一、全量探针巡检（39 个探针，一次跑完）

跑法：`server\docs\probe-full-2026-10-27\run-all.ps1`（驱动脚本：逐个跑、单条超时、跑完查 `/api/state`，服务挂了自动拉起；日志/截图/汇总都在同目录）。

首跑：**25 绿 / 12 红**。逐条归因（先分清「探针过期 / 环境 / 真缺陷」，再动手）：

| 探针 | 现象 | 归因 |
|---|---|---|
| `probe-code-run` | C++ 编译执行 10.96s，超 10s 上限 | 环境：本机只有 MSVC，VsDevCmd 冷启动十几秒；复跑 13/13 |
| `probe-start-screen` | 期望 4 个模型、当前是 Qwen3-5-4B | 探针过期：10-25 加了 0.5B（5 个），当前模型也不固定 |
| `probe-model-add` | 同上（写死 4） | 探针过期 |
| `probe-menu-stacking` | 同上（写死 4） | 探针过期 |
| `probe-hero-modes` | 断言「推理模式开思考」，当时加载的是 7B | 探针过期：该看模型能力，不能写死 |
| `probe-formula-find` | 搜 `turtle` 得 0 条 | 探针过期：靠开发期某个会话里正好有这个词 |
| `probe-small-features` | 切会话后草稿里冒出 `$E=mc^2$` | 测试互相污染：公式面板探针把内容留在 `localai.draft.new` |
| `probe-title-ui` | 崩在 `#moreMenu` | 探针过期：⋯ 菜单 10-22 已挪进设置 → 工具 |
| `probe-ui-tools` | 刷新后工具卡片 0 张 | 探针过期：10-24 起启动页固定新对话，要点头像卡片才进会话 |
| `probe-ui-web` | 位置量出 0/0、开关禁用态不对、刷新后 0 张 | 探针过期（开场白页输入区是隐藏的；10-24 起开场白默认 Agent 模式、工具本来就勾着）+ 真问题（禁用态没在启动时同步） |
| `probe-ui-preload` | 取消 @ 后缺「已取消 + 释放」提示 | 见第二节，未定论 |
| `probe-preload` | 第二意见 17.6s > 15s 阈值 | 机器变慢（预加载本身 17.8s）；判据改成 <25s，仍远小于装卸 30–45s |

修完复跑：`start-screen` 12/12、`model-add` 4/4、`menu-stacking` 2/2、`hero-modes` 11/11、`formula-find` 8/8、`small-features` 6/6、`title-ui` 13/13（按现在的顶栏与五项右键菜单重写）、`ui-tools` 12/12、`ui-web` 39/39、`code-run` 13/13、`preload` 26/26。

最终状态：**39 个探针，38 绿**；唯一红的是 `probe-ui-preload` 34/35，原因见第二节（提示语时有时无，释放本身正常）。

顺带修的两处真问题：

1. **联网开关的禁用态启动时没同步**：`renderWebState()` 只在「调用工具」变化时被调，刚打开页面时工具没勾、联网却看起来能点（点了也发不出 web 标记）。改成 `refresh()` 末尾同步一次。
2. **模型不支持思考时，点「推理模式」没有可见反馈**：只有顶栏状态栏一行字，眼睛还在按钮上。现在开场白里的 `#heroHint` 也会写「当前模型不支持思考…」。

### 二、遗留：取消 @ 之后的「已取消 + 释放 X GB」提示不稳定

服务端确实释放了（`/api/preload` 回到空），但左下角提示时有时无：同一段逻辑直接调 `clearPreloadOne()` 必定出提示，走「点 ✕」这条路径偶发不出。`toastReleased(before, after)` 的 `before` 取的是页面里的 `preloadExtras` 快照，怀疑和 3 秒轮询抢写有关，**未定论**。不影响释放本身，只影响提示；`probe-ui-preload` 因此稳定 34/35。

### 三、会话备份到别处（交接文档「下一步 1」）

要解决的问题很具体：会话和它的 20 版快照都在 `<MODEL_DIR>\workspace` 里，同一块盘。盘坏、目录被误删，快照跟着一起没——10-25 已经因此丢过 13 条会话。

**怎么做的**

- 配置在 `workspace\backup.json`：`{enabled, dir, keepDays, intervalMin}`；关掉时所有入口都是空操作。
- 落盘三件：`<dir>\sessions\<id>.json`（镜像）、`<dir>\daily\<yyyy-mm-dd>\`（当日第一份完整拷贝，保留 `keepDays` 天）、`<dir>\backup.json`（清单，含每个会话的 size/mtime）。
- **只拷变化的**：按清单比对，不信 mtime（`copyFile` 不保留时间）。实测第二次备份 `copied=0`。
- **源里没有、备份里有的会话不删**：那可能正是事故删掉的那份，留着还能捞。
- 触发：会话写盘后 15 秒合并一次；启动查一次；之后每 60 秒看是否到了 `intervalMin`（默认 30 分钟）。
- 校验前移：保存配置时就 `mkdir` + 写一个探针文件试写，盘没插/没权限当场 400；备份目录不许是会话目录或它的上级；同盘时界面黄字说明「只能防误删，防不了整盘损坏」。
- 界面：设置 → 工具 → 会话备份（开关 / 目录 / 选磁盘… / 立即备份 / 状态一行 / 同盘提醒）。「选磁盘…」走 `/api/backup/drives`，列出本机盘符与剩余空间。

**验证（`probe-backup` 28 项 + `probe-ui-backup` 14 项，全绿）**

- 相对路径、会话目录本身、会话目录上级、开着却没填目录 → 全 400；
- 保存合法目录 → 目录真的建出来；`keepDays` 9999 → 365、`intervalMin` 1 → 5（夹紧）；
- 新建会话 → 立即备份 → 镜像、当日快照、清单三样都落盘，第二次 `copied=0`；
- 改一句会话 → `copied=1`，镜像文件里拿到新内容；
- **不点按钮等 15 秒**，新建的会话自己出现在备份目录（写盘触发生效）；
- 造一个 2020-01-01 的 `daily` 目录 → 跑一次被清掉；
- 界面：五个控件可见、磁盘按钮带剩余空间、立即备份出结果、服务端配置同步、关掉后配置清空。

### 四、2026-10-28 收尾：修掉最后一条红探针 + 从备份恢复

**1) 取消 @ 之后「已取消 + 释放 X GB」提示**

根因不是释放失败，而是**提示的判据取自页面里的 `preloadExtras` 快照**（`toastReleased(before, after)` 做差集）。这个快照会被 3 秒轮询改写，取到空的时候就什么也不报。

改法：让**服务端**回答「谁真的被释放了、多大」——`POST /api/preload/clear` 现在返回 `cleared: [{file, sizeGB}]`；前端优先按它逐条报，拿不到才退回原来的差集。`probe-ui-preload` 从 34/35 变 **35/35**。

**2) 从备份恢复（补上第三节里「没有恢复按钮」这一条）**

- 接口：`GET /api/backup/sessions`（列备份里的会话：标题/条数/备份时间/本机是否也有）+ `POST /api/backup/restore {id}`（需本地令牌，缺令牌 403、备份里没有 404）。
- 恢复走 `writeSession`，所以**覆盖前先留一份历史版本**——恢复错了能从会话右键 →「历史版本…」撤回来（实测快照数 1 → 2）。
- 界面：设置 → 工具 → 会话备份 →「从备份恢复…」→ 面板每行「备份于 / 条数 / 本机现在几条 / 恢复」，本机没有或更少的标黄。
- 实测：本机加到 4 条（含 LOCAL-ONLY）→ 从备份恢复 → 回到 3 条、LOCAL-ONLY 消失、快照多一份；无令牌 403；备份里没有的 id 404。

**验证**：`probe-backup` **36/36**（原 28 项 + 恢复 8 项）、`probe-ui-backup` **20/20**（原 14 项 + 面板 6 项）、`probe-ui-preload` **35/35**。

至此全量 **39 个探针全绿**（0 红）。

### 五、这一轮没做

- 只镜像会话，不镜像 `session-snapshots`（历史版本）：会话本身小，快照最多 20 版/会话，真要连快照一起留，下一步再说。
- 不支持压缩/加密；网络盘靠 Windows 凭据，没有自己的账号。
- 恢复只做「整会话覆盖」，不能从备份里挑某几条消息合并回当前会话。
---

## 二十一、2026-10-28：侧栏搜索 + 文档检索（RAG）

两件事都按「先定边界、再写最小实现、最后用探针钉住」的顺序做。

### 一、侧栏搜索（标题 + 正文）

以前会话多了只能滚。现在侧栏顶上多一个输入框，输入即搜（250ms 防抖），同时搜**标题**和**每一条消息正文**。

- 接口：`GET /api/sessions/search?q=&limit`。逐个读会话文件，标题与正文各数一次命中，带上**第一条命中附近的片段**；最多返回 50 条，串行读、遇到坏文件就跳过。
- 界面：结果行是「标题（命中处高亮）→ 片段（高亮）→ N 处 · 时间」，点一下即切到该会话；`✕` 与 `Esc` 清空，清空后自动回到完整列表。
- 一个容易踩的点：列表每 3 秒会 `refreshSessions()` 重绘一次，搜索状态下重绘会把结果刷掉。改法是 `renderSessions()` 开头判断 `searchQuery`，搜索态直接渲染缓存的结果；输入框内容变化才重新请求。
- 删掉/改名后结果会短暂陈旧（最多 3 秒，下一次搜索即新）——这是有意的取舍，不做额外订阅。

### 二、文档检索（RAG，零依赖、全本地）

目标不是"向量数据库"，而是让模型能回答「我的资料里怎么说」。所以选了最省、最可解释的一条路：**BM25 + 中文 bigram**。

| 决定 | 为什么 |
|---|---|
| 只索引 workspace 里的 `.md/.markdown/.txt/.log/.rst/.csv` | 二进制/图片本来也没法给模型看；PDF 留给下一步（要加解析库） |
| 切段：空行分段，超长段落按 500 字滑窗 | 段落是最自然的语义单位，比按字数硬切更少切断上下文 |
| 中文按相邻两字（bigram）建词 | 不引分词器、不加词典，"量子纠缠"→量子/子纠/纠缠 三个词就能召回；代价是索引稍大，文档量级完全扛得住 |
| 英文按单词（≥2 字符） | 与现有英文文档兼容 |
| 索引落 `workspace\rag\index.json`，按 size+mtime 增量 | 换机器、重启都不丢；改一个文件只重切一个文件 |
| 检索前自动同步，60 秒内不重复扫目录 | 用户丢进新文件不用点按钮；也不至于每次提问都扫盘 |
| 同一文件最多出 2 段、最多 8 段 | 防止一份长文档把上下文占满 |

**工具**：`search_documents(query, k)`，和内置工具同一个注册表、同一条 Agent 链路，界面上的卡片、耗时、日志都复用现有实现。描述里明确写了「问资料/文档/笔记时先调用它」，并要求拿到出处后可以再 `read_workspace_file` 读全文。

**接口**：`GET /api/rag/status`、`POST /api/rag/rebuild`、`GET /api/rag/search?q=&k=`；另加了 `GET /api/tools` 方便界面与探针确认「当前到底注册了哪些工具」（以前只能靠日志）。

**界面**：设置 → 工具 → 文档检索：`N 个文件 · N 段 · 索引时间`，一个「重建索引」按钮（重建完弹提示）。

### 三、验证

| 探针 | 结果 | 覆盖 |
|---|---|---|
| `probe-rag` | **13/13** | 建索引、中文 bigram 召回、英文按词、改文件后新内容进/旧内容出、删文件后不再召回、`search_documents` 已注册、空查询 400、复位后索引回到原样 |
| `probe-sidebar-search` | **11/11** | 输入即搜、标题命中、正文命中并高亮、点结果切会话、✕/Esc 清空、无结果文案 |
| `probe-ui-rag` | **6/6** | 状态行数字、重建按钮、结果提示、服务端数字同步 |

回归（挑了会被牵动的 8 个）：`probe-sessions`、`probe-ui-new`、`probe-start-flow`、`probe-settings-tools`、`probe-small-features`、`probe-input-extras`、`probe-title-ui`、`probe-ctx-panel`。

### 四、没做的

- PDF / Word / Excel 不解析（要引库；`.md` 之外先靠用户自己导出成文本）。
- 不做向量检索/重排：BM25 对"关键词能对上"的场景够用，语义近义改写会漏；真需要时再加一个小 embedding 模型，接口不用变。
- 侧栏没有置顶/分组/标签——这次只做了搜索，别把列表做成第二套系统。
- 搜索结果不分页（上限 50 条），会话上千条时要再想。
---

## 二十二、2026-10-29：文档格式、备份快照、插件开关

这一轮把「还差一点」的三件事补齐：RAG 能读 Word/PDF、备份连历史版本一起走、插件能关掉。

### 一、RAG 支持 docx / pdf（零依赖）

新增 `server\doc-extract.mjs`，不引任何依赖：

| 格式 | 做法 | 验证 |
|---|---|---|
| `.docx` | docx 本质是 zip：读中央目录找到 `word/document.xml`，`inflateRawSync` 解压，去标签、`</w:p>` 转换行、解 XML 实体 | 中文标题/段落/英文都抽得对 |
| `.pdf` | 解析间接对象 → 解 `FlateDecode` 流 → 扫文本算子（`Tj`/`TJ`/`Tf`/`Tm`）；`Type0`/`Identity-H` 按 2 字节 CID 走，其余按 1 字节；用 `/ToUnicode` 的 `bfchar`/`bfrange` 映射回 Unicode | Edge 生成的 31KB 中文 PDF 抽出了「量子通信笔记 / 纠缠态… / Retrieval augmented generation…」 |

几个踩到的坑（都写进代码注释了）：

1. **`<<` 字典被当成十六进制字符串**：`<</MCID 0 >>` 里第二个 `<` 后面不是 `<`，第一版把它当 hex 字符串解，于是每段正文前多出 `Ð`、`\u0000\f` 这类垃圾。现在遇到 `<<`/`>>` 直接跳。
2. **`Td` 不是换行**：Chromium 会把一个单词拆成几段分别 `Tj`，用 `Td` 做位移；把 `Td` 当空格会把 `Retrieval` 切成 `R etriev al`。现在只在 `T*`/`ET` 换行，词间空格来自字符串里的空格字形。
3. **控制字符要清**：CID 映射失败会留下 `\u0000`，抽完统一清掉只留换行/制表。

限制（如实写进界面提示与交接文档）：PDF 是尽力抽取——扫描件（纯图片）抽不出字；非常见字体、没有 `ToUnicode` 的 PDF 会乱码或少字。

### 二、备份连历史版本一起镜像

之前只镜像 `sessions\`，而「能回滚」靠的是 `session-snapshots\`——整盘坏掉时照样没了。现在备份目录多一个 `snapshots\<日期>\<id>.<时分秒-毫秒>.json`：

- 快照是"写一次就不变"的文件，**缺了才拷**（不比对 mtime，避免每次全量重写）；
- 上限 5000 份，超了只记日志不报错；
- 状态里多报一项「历史版本 N 份（新增 M）」，界面状态行也显示。

### 三、插件启用 / 禁用

之前插件"丢进去就生效"，想临时关掉只能把文件挪走。现在：

- 状态存 `workspace\plugins.json`，**只记被禁用的文件名**，新插件默认启用；
- 禁用的插件不 import、不注册成工具（不占系统提示词），但仍在列表里显示「已禁用」；
- `POST /api/plugins/toggle {file, enabled}`；文件名严格校验，`../evil.mjs` 直接 400；
- 设置 → 工具 → 插件：每行一个「启用 / 禁用」按钮，失败行显示原因。

### 四、验证

| 探针 | 结果 |
|---|---|
| `probe-rag` | **16/16**（新增 docx/pdf 抽取召回、PDF 中文） |
| `probe-backup` | **38/38**（新增历史版本镜像、状态报份数） |
| `probe-plugins` | **11/11**（发现 → 禁用 → 工具消失 → 状态落盘 → 启用回来 → 删文件消失 → 非法名 400） |

### 五、全量结果

**43 个探针 / 562 条断言，全绿（0 红）**——这是这个项目第一次全量不留红。

- 跑法：`server\docs\probe-full-2026-10-29\run-full.ps1`（驱动脚本同前：逐个跑、单条超时、跑完查 `/api/state`）；
- 汇总：同目录 `RESULT.md`（每个探针一行：PASS / 失败数 / 结果行）；
- 耗时约 35 分钟（真模型那几条：tools-agent 98s、web-tools、kv-long、context-switch、ui-preload、preload、second-opinion 各 40–70s）。

跑之前把 `workspace\sessions` 整份备份到 `sessions-backup-before-suite`；`probe-ui-sessions` 照例清空会话，跑完把真实会话（30 条「Hello」）从备份拷回，探针留下的那条删掉。

## 二十三、2026-10-30：版本号、「关于」页、代码入 git

这一轮的出发点不是功能，是**可对账**：出问题时分不清「跑的是哪一版」，改坏了也没有退路。

### 一、先把代码放进 git（这比版本号更要紧）

`D:\LocalModels` 之前**没有任何版本控制**——会话有历史快照，代码没有，一次误覆盖就没了。

| 决定 | 为什么 |
|---|---|
| 只收源码与文档（322 个文件 / 26.9MB） | 模型约 15GB、发布包 351MB、语音 99MB 都可再生，进仓库只会让每次 diff 变成拉 GB |
| `workspace/` 整个忽略 | 会话、历史快照、RAG 索引、备份配置都是用户数据，不该跟着代码走 |
| `*.gguf` / `dist/` / `tts/` / `node_modules/` / `server/docs/*.png` 忽略 | 同上；截图与音频是探针留档，重跑即可再生 |
| `.gitattributes` 写 `* -text` | 发布包的核对方式是比哈希，**字节必须一致**，不让 git 做换行转换 |
| 基线提交 `b6a9175` | 提交信息只写「现状」，不假装是完成态 |

仓库里那份 `server\backup\*.bak`（10-18 的手工备份）先留着，确认 git 好用之后再说。

### 二、版本号：只写一处，处处读它

- `app.mjs` 只有一个常量 `APP_VERSION = "1.0.0"`；`server\package.json` 的 `version` 必须与它一致（**探针会查**，防「只改代码不改包描述」）。
- 新增 `GET /api/version`：`version / commit / commitAt / builtAt / buildSource / dirty / startedAt / node / pid / port / dir`，**不含本地令牌**。
- `/api/state` 也带 `version`、`build`、`startedAt`，界面不用多打一个请求。
- 启动日志第一行改成 `本地 AI v1.0.0 (b6a9175) 已启动`，看控制台就知道跑的是哪一版。

**一个差点埋错的坑**：第一版直接用 `git rev-parse --short HEAD`，结果**发布包也报出了仓库的提交**——因为 `dist\LocalAI\app` 恰好在 `D:\LocalModels` 这个仓库下面，git 会一路往上找 `.git`。那样报出来的是仓库的哈希、不是包里那份代码的，等于给了一张假的「版本证明」。

改法：只有「**app.mjs 这份文件自己**被 git 跟踪」才报哈希（`git ls-files --error-unmatch app.mjs` 成功），否则退回 app.mjs 的修改时间（≈打包那一刻），标 `buildSource: "mtime"`；工作区有未提交改动时标 `dirty: true`——脏工作区不能当发版依据。

实测：源码目录报 `b6a9175 / dirty=true`；把同样的文件放进 `dist\LocalAI\app`，用包里的 `runtime\node.exe` 跑在 8098，报 `buildSource=mtime / builtAt=打包时间`。两种情况都自洽。

### 三、界面：「设置 → 关于」

- 第五个选项卡：版本（`v1.0.0` + 复制按钮）、构建（哈希/提交时间，或打包时间 + 来源）、运行（node / 端口 / 进程号 / 启动时刻 / 服务目录）。
- 「更新」一栏**没有放假按钮**：这是离线部署，没有分发通道就没有可查的更新源。写清「换版本 = 覆盖 dist 目录，重启后看版本号变没变」，比放一个点了没反应的「检查更新」诚实。
- 数据全部来自 `/api/version`，界面不自己拼版本号（否则改了常量界面还显示旧的）。

### 四、验证

| 探针 | 结果 | 覆盖 |
|---|---|---|
| `probe-version`（新） | **14/14** | semver、构建来源、短哈希合法、dirty 标记、启动时刻不在未来、node/端口、不泄漏令牌、`/api/state` 同源、`package.json` 与常量一致、版本号只在一处定义 |
| `probe-ui-version`（新） | **9/9** | 「关于」页存在、只显示这一页、三行都有内容、构建行点明来源、复制进剪贴板、切回生成页收起 |

回归（会被「加选项卡 / 加 state 字段」牵动的 5 条）：`probe-settings-tools` 9/9、`probe-ui-new` 30/30、`probe-ui-rag` 6/6、`probe-ui-backup` 20/20、`probe-sessions` 33/33 —— 全绿。

- 同步到 `dist\LocalAI\app\`（app.mjs / app.html），SHA256 一致；
- **本轮没跑全量**：新增驱动 `server\docs\probe-full-2026-10-30\run-full.ps1`（45 条，比上轮多 2 条），下一轮开工前先跑一次把 45 条钉住。跑之前照规矩备份 `workspace\sessions`。

### 五、顺带修掉的一个文档坑

`新会话启动词.md` 与 `technique\06-探针与验证.md` 里起 headless Edge 的命令写的是 `"$env:ProgramFiles(x86)\..."`——**这在 PowerShell 里取不到值**，会报「无法将 C:\Program Files(x86)... 项识别为 cmdlet」。必须写成带花括号的 ${env:ProgramFiles(x86)} 形式。这次照着文档起 Edge 就是这么卡住的，已把两处命令改对，并写进 `technique\07-坑与约定.md`。

另：本轮用编辑器改 `run-full.ps1` 时 BOM 被悄悄剥掉了（前 3 字节从 `EF BB BF` 变成 `0A 24 62`）。已用 `ReadAllBytes` 补回，并**用 PowerShell 5.1 的 Parser 复验**通过——以后凡改 .ps1 都要做这两步。

## 二十四、2026-10-31：45 条探针整跑（含两次 Vulkan 崩溃）与三处探针加固

交接文档「下一步 1」是先把 45 条整跑钉住。这一轮做了，过程比预想的曲折：**第一次红在「没装模型」，第二次崩在 Vulkan**，最后 45 条全绿（其中 5 条是崩溃后单独复跑）。

### 一、第一次整跑：11 条红，全是「模型没加载」

驱动只跑探针、不装模型；而有一批探针默认「模型已加载」（`hero-modes` / `start-flow` / `status` / `ctx-panel` / `small-features` / `session-jump` / `ui-tools` / `ui-web` / `auto-title` / `chat-plain`）。结果 34 绿 11 红。

加载 7B 后把这 11 条复跑，**全绿**——坐实是环境假设，不是代码回归。顺带发现 `probe-ui-backup` 也红两条：前面探针把 `sessions` 清空了，备份里自然 0 行。

两处修掉（提交 `d5ba635`）：

- 驱动开跑前自己 `POST /api/load`，探针没打结果行时不再对 `$null` 调 `.Trim()`；
- `probe-ui-backup` 备份前若没有会话，自己造一个临时会话，跑完删掉。

### 二、第二次整跑：Vulkan 崩了两次，反而验证了两个兜底

| 时间 | 事件 |
|---|---|
| 22:52:3x | `probe-tools-agent` 的对话 500：`vk::Device::getFenceStatus: ErrorDeviceLost`，进程退出（已知问题 2） |
| 22:52:40 | 驱动看护第 1 次拉起服务，重新预加载 7B |
| 22:53:07 | 又一次 device lost |
| 22:53:15 | 第 2 次拉起；应用按「10 分钟内崩两次」**自动切 CPU**（`server\vulkan-crash.log` 有了 3 条时间戳），此后稳定 |
| 22:53:07 前后 | `probe-web-tools` / `probe-context-switch` / `probe-ui-preload` 撞在服务空档，秒退 |

整跑 **40 绿 / 5 红**；这 5 条单独复跑**全绿**——注意是在 **CPU 后端**上跑的：7B 约 3 tok/s，`probe-tools-agent` 依然 24/24，`probe-kv-long` 首轮 70.4s、二三轮 1.6s / 1.4s、复用 99%。

这一轮真正的收获不是「绿了」，而是**两个兜底同时被验证**：

1. **驱动看护**（新加）：探针之间发现 `/api/state` 不通就 `Start-Process node app.mjs` 拉起、等端口、重新装模型。裸跑 node 时这是唯一的重启手段。
2. **应用自愈**：崩溃后自己写好 `vulkan-crash.log`，下次启动读到 ≥2 条就切 CPU，并明确提示「删掉这个文件可恢复 Vulkan」。

### 三、侧栏搜索探针：固定 sleep 是错的，要等状态

`probe-sidebar-search` 在 10-30、10-31 各红过一次，都是「第二次搜索 900ms 内没换掉结果」。第一次修只改成「等到提示条出现结论」——**没用**：提示条会保留上一次的文本，于是立刻返回旧结论，反而多红了 3 条。

正确写法：**等提示条变了且是结论**（`hint !== before && /条匹配|没有匹配/`）；清空后**轮询列表条数**回到总数，而不是 `sleep(600)`。改完连跑两次 11/11。

### 四、结果

`server\docs\probe-full-2026-10-31\RESULT.md`：**45 条探针 / 585 条断言 / 0 红**（585 = 上轮 562 + `probe-version` 14 + `probe-ui-version` 9），逐条标了「整跑通过」还是「崩溃后被波及、单独复跑」。

## 二十五、2026-11-01：Debugging Tool（独立程序）+ 黑底 ∂AI? 图标

这一轮是用户点名要的两件事：**修复工具单独成一个程序，软件里表现为「Debugging Tool」按钮，按了直接弹调试界面**；**新图标：黑底 + LaTeX 的 ∂ + AI + ?**。

### 一、Debugging Tool 的三层

| 层 | 是什么 | 文件 |
|---|---|---|
| 数据 | `buildDiag()` 产出 16 项检查，每项 `{level, title, detail, fix}` | `app.mjs` |
| 页面 | 独立调试页（检查项 / 环境 / 模型 / 数据 / 日志 / 修复动作） | `debug.html`，走 `GET /debug` |
| 程序 | 独立进程：`--ui` 开窗、`--json` 给脚本、`--logs` 打日志；**服务没跑时给本机诊断** | `localai-debug.mjs` + `.cmd` |

入口：顶栏「Debug」按钮或设置 → 工具 →「打开调试窗口…」→ `POST /api/debug/open` → 服务端 `spawn` 独立程序 → Edge 应用模式开窗。

检查项覆盖：服务/端口/并发、版本与构建、VC++ 运行库、内存与磁盘、后端（Vulkan/CPU）与崩溃次数、模型与 KV、会话与损坏文件、备份、RAG、插件、源码与发布包一致性。

> 两个「私货」检查项最有用：「崩溃次数」解释「为什么突然变慢」（自动切 CPU 了），「发布包一致性」防「改完忘了同步 dist」。这两类以前只能靠人记。

### 二、图标

- `server\icon.svg` 定稿：黑底圆角、青色细边、白色斜体 `∂`、下方 `AI`、右上青色 `?`（512 视口，Cambria Math + Segoe UI）。
- 渲染：Edge headless 截图（**必须加 `--virtual-time-budget`**，否则输出 0 字节）→ `make-ico.mjs` 把 6 个尺寸打包成 PNG-内嵌 ICO。
- 启动器用 `/win32icon:localai.ico` 编译（`build-portable.ps1:156`），所以**换图标必须重编译 exe**：这次按那段参数直接重编了 `dist\LocalAI\启动本地AI.exe`，再用 `ExtractAssociatedIcon` 读回来确认是 `∂AI?`。
- 界面里的「本体图标」：模型按钮原来显示 `∫`，改成同设计的迷你标记（黑底小块 + ∂ + 青色 ?）。**hero（开场白）里的 `∫` 特意没动**——`probe-hero-modes` 断言「Agent 前有 ∫」，改了会误伤。

### 三、踩到的坑（都花了时间）

1. **GDI+ 测量与绘制的 StringFormat 不一致**：图标第一版整体偏移、第二版干脆空白。量墨迹用默认格式、绘制用 `GenericTypographic`，内边距不同，位置就差了。最后**改用 SVG + Edge 渲染**，坐标完全可控。
2. **PowerShell 的 `$env:ProgramFiles(x86)`** 又踩一次（必须写 `${env:ProgramFiles(x86)}`）；在 JS 模板字符串里写它还会被当插值，得拼字符串。
3. **Edge `--screenshot` 不加 `--virtual-time-budget` 会静默输出 0 字节**。
4. **日志编码**：`server\app.log` 是 UTF-16（PowerShell 重定向写的），第一版调试面板按 UTF-8 解，满屏 `0 6 : 2 8 :` 乱码。`tailText()` 现在嗅探 BOM + UTF-16 偶数对齐，命令行版同步修。
5. **ESM 没有 `__dirname`**：CLI 用 `fileURLToPath(import.meta.url)`（与其它探针一致）。

### 四、验证

| 探针 | 结果 | 覆盖 |
|---|---|---|
| `probe-debug`（新） | **23/23** | /debug 可访问、16 项检查、summary 自洽、日志编码不是乱码、两个写接口必须令牌、清崩溃记录会自复位、`--json`/`--logs` 可用 |
| `probe-ui-debug`（新） | **16/16** | 顶栏 Debug 按钮、模型按钮新标记（∂ + ? + 黑底）、设置入口、点按钮真的调 `/api/debug/open`（假 fetch 拦下，不真弹窗）、调试页渲染与复制、能回主界面 |

- `dist\LocalAI\app` 同步 6 个文件，哈希一致；启动器按新图标重编译（38400 → 58368 字节）；
- 旧的 45 条本轮没跑：新驱动 `server\docs\probe-full-2026-11-01\run-full.ps1` 已扩到 **47 条**，下一轮开工先整跑。

### 五、遗留

- `buildDiag()` 每次调用都扫会话目录 + 3 次哈希，页面 5 秒轮询够用；真要高频采集应拆「心跳 / 完整体检」两个接口；
- 图标 16px 下 `?` 基本糊掉（32px 尚可）——小尺寸已是极简形式，再压只能去掉 `?`；
- 调试程序目前是 `.cmd`（自带 runtime 时优先用它），**没做成独立 exe**：要 exe 得用 csc 包一层，和启动器一样重编译。

## 二十六、2026-11-01：修「顶栏挤坏」与「小尺寸图标糊掉」

用户截图反馈：顶栏按钮变成竖排的「文/件」、最右边的主题键被切掉、窗口图标糊成一团。三条根因，不在同一个层面。

### 一、顶栏：nowrap 的 flex + 可收缩的按钮

`.topbar` 原来是 `display:flex` 且不换行，按钮没有 `white-space:nowrap`、默认还能收缩。175% 缩放下窗口 CSS 宽度只有 ~850px，加上新加的 Debug 按钮后放不下 —— 浏览器不会报错，它只是**把每个按钮压窄、文字折成竖排**，再把最后一个挤出屏幕。

修法（`app.html`）：

```css
.topbar{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap;row-gap:8px}
.topbar > *{flex:none}
.topbar button{white-space:nowrap}
```

实测三档：850px → 顶栏 107px 两行、无竖排、页面不横向溢出；1100/1452px → 仍是一行 60px。

### 二、图标：16px 里塞了三个元素

`localai.ico` 的 16/32 是从 512 完整稿（∂ + AI + ?）缩下来的，16px 下三个元素叠成一团墨。

改成**按尺寸选源稿**：16px 只画一个大 `∂`；32px 画 `∂` + 角落小 `?`；48px 以上才用完整稿。`docs\resize-icon.ps1` 按这个映射缩放，`make-ico.mjs` 照旧打包。

### 三、流程：我改源码，你跑发布包

最关键的一条：布局修复只落在 `server\app.html`，而用户双击的是 `dist\LocalAI\启动本地AI.exe`，它读的是 `dist\LocalAI\app\app.html`。**没同步 = 没修**。

这也解释了为什么我自己的 headless 测试「看起来没问题」：测的是源码端口，用户看的是发布包。以后改完 UI 要**两份都验**，并且**在窄窗下验**。

### 四、验证与收尾

- `probe-ui-debug` 从 16 条加到 **19 条**：新增「850px 下按钮不竖排」「不横向溢出」「顶栏允许换行」三条；
- 发布包：重编译启动器（新 ico，58368 字节）+ 同步 app.mjs / app.html / debug.html / localai-debug.*；
- 应用已用新代码重启（服务 `v1.0.0`，`buildSource=mtime`）；
- 教训写进 `technique\07-坑与约定.md`。

## 二十七、2026-11-01：两套图标身份（本体 ∫+AI / 调试 ∂+AI+?）

用户指出：「我的软件本体叫本地 AI，图标是**不定积分 + AI**；Debugging Tool 的图标才是 **Partial + AI + ?**。别弄混。」

我之前把两者合成了一套（把本体的 `∫` 换成了 `∂`），错在**身份划分**，不是画法。

### 一、重新分工

| 身份 | 记号 | 源文件 | 落地 |
|---|---|---|---|
| 本地 AI（本体） | `∫ + AI` | `icon-app.svg`（16/24 用 `icon-app-small.svg`，只画 ∫） | `localai.ico` → 启动器 exe / 托盘 / 任务栏 / 标题栏；界面左上角模型按钮的迷你标记 |
| Debugging Tool | `∂ + AI + ?` | `icon-debug.svg` | `debug-icon-64.png` → `GET /debug-icon.png`，调试页 favicon（调试窗口标题栏） |

### 二、顺带修掉的三个问题

1. **本体标记看不见**：迷你标记的字色原来跟 `var(--text)`，浅色主题下 `--text` 是深色，黑底上几乎不可见。改成固定 `#f6f8fa`。
2. **本体标记混进了问号**：`?` 属于调试工具，本体只留 `∫`。
3. **调试页没有自己的图标**：加了 `/debug-icon.png` 路由 + `<link rel="icon">`，调试窗口的标题栏/任务栏现在显示 `∂AI?`。

### 三、踩到的坑（差点让我误判）

**启动器是单实例**：改了 `app.mjs` 后我 `Start-Process 启动本地AI.exe`，它只把已有实例激活、**根本没有重启服务**，新路由于是 404，我一度以为「代码没生效」。
正确做法：先结束启动器进程（或托盘「停止服务并退出」）再启动。已写进 `technique\07-坑与约定.md`。

### 四、验证

- `probe-debug` **25/25**（新增「调试页声明了自己的图标」「/debug-icon.png 返回 png」两条；崩溃记录路径改为从 `/api/diag.paths.crashLog` 取，跑发布包时不再误判）；
- `probe-ui-debug` **19/19**（本体标记断言改成「是 ∫ 且没有 ?」）；
- 从 exe 里 `ExtractAssociatedIcon` 读回 32px：是 `∫ + AI`；
- 发布包已同步（app.mjs / debug.html / debug-icon-64.png），启动器已重编译（57344 字节），应用已重启。

## 二十八、2026-11-01：桌面快捷方式图标 + 保留原始图标

用户提出两点：桌面快捷方式还显示旧的 `∂AI?`；另外**原始的白底 `∫+AI` 图标必须在文件夹里留一份**。

### 一、桌面快捷方式

`C:\Users\lenovo\Desktop\本地 AI.lnk` 的 `IconLocation` 原来指 `启动本地AI.exe,0`——图标是嵌在 exe 里的，Windows 会按路径缓存，所以即使 exe 重编译过，桌面照样显示旧图标。

改法：把 `IconLocation` 指到 `dist\LocalAI\localai.ico,0`（一个独立文件），再跑 `ie4uinit.exe -show` 刷缓存。以后换图标不用动快捷方式。

> 如果桌面还是旧的，需要重启一次 Explorer（会闪一下任务栏）——这是 Windows 图标缓存的老毛病。

### 二、把原始图标请回来

原始稿（白底 + 深蓝 ∫ + AI，2026-10-18 版）在 `b6a9175` 里还留着，已恢复到 `server\icons\`：

| 文件 | 内容 |
|---|---|
| `original-white.ico` / `.png` | 原始：白底 + 深蓝 ∫ + AI（**别删**） |
| `current-black.ico` | 当前本体：黑底 + 白 ∫ + AI |
| `debug-partial.png` | 调试工具：∂ + AI + ?（256） |

另加 `server\icons\README.md` 写清约定（两套身份、`localai.ico` 是编译用的那份、从 git 取二进制要用 cmd 重定向）。

### 三、又踩一个坑：PowerShell 的重定向会破坏二进制

用 `git show b6a9175:server/localai.ico > old.ico` 取回来的是 **UTF-16 文本**（2 字节/字符 + BOM），ico 直接坏掉（`Icon.ToBitmap()` 报范围超出数组结尾）。必须走 `cmd /c` 的重定向才拿到原始字节。

验证：取回后头部是 `00 00 01 00`，大小 12543 字节，与原始一致；再从里面导出 256px PNG 存成 `original-white.png`。

## 二十九、2026-11-01：真跑一次打包，抓到「包里缺 doc-extract.mjs」

用户选了「A：先把包的安全性钉死」。跑了完整 `build-portable.ps1`，结果**挖出一个会让整个发布包起不来的缺陷**。

### 一、doc-extract.mjs 从来没进过打包清单

`app.mjs` 第一行就 `import { extractTextBuffer } from "./doc-extract.mjs"`，但 `build-portable.ps1` 的复制清单里**从来没有这个文件**。

为什么之前没暴露：10-29 加 RAG 抽取功能时，是**手工**把 `doc-extract.mjs` 拷进 `dist\LocalAI\app\` 的，之后所有验证都跑在那份手工拷贝上。这次重新打包（先清空 dist），包里的 `app\doc-extract.mjs` 直接没了，**exe 双击也起不来**。

修法：清单 + 依赖检查都补上（缺文件时 `Die`，别静默通过）。补回后启动成功、`probe-rag` 16/16。

### 二、这轮打包的其余结果

| 项 | 结果 |
|---|---|
| 产物体积 | 258.1 MB / **3439** 文件（比上次多 4 个＝调试工具那四个） |
| 调试工具四个文件 | `debug.html` / `localai-debug.mjs` / `localai-debug.cmd` / `debug-icon-64.png` 都在 |
| 图标 | 根目录 `localai.ico`（31308 字节）；exe 内嵌图标读回来是 `∫ + AI` |
| 源码一致性 | app.mjs / app.html / doc-extract.mjs 三份 SHA256 与 `server\` 相同 |
| 包内自检 | `GET /debug` 200、`GET /debug-icon.png` 200、无令牌 `POST /api/debug/open` 403 |
| 包内探针 | `probe-debug` **25/25**、`probe-rag` **16/16** |

### 三、桌面图标

`本地 AI.lnk` 的 `IconLocation` 已改指 `dist\LocalAI\localai.ico,0`，并跑了 `ie4uinit -show` + 重启 Explorer 清缓存。以后换图标不用重建快捷方式。

### 四、给打包加的「自检清单」

`technique\05-打包与部署.md` 新增一节：**打包后必须自检**（关键文件齐 / 三份哈希 / 能不能起 / 调试工具三条接口 / 两条探针）。
这次的事说明：打包脚本不报错 ≠ 包是完整的。

## 三十、2026-11-01：调试窗口改成自己的 exe（任务栏图标不再发虚）

用户反馈「Debugging Tool 的任务栏图标是虚化的」。原因不在画法，而在**宿主**：

调试窗口原来是 `localai-debug.mjs --ui` 用 Edge 的 `--app=` 打开，窗口图标取自网页 favicon（64px PNG），
Windows 任务栏要 16/24/32px，只能缩——所以永远发虚。

### 一、做法：给它一个真正的程序

新增 `server\launcher\DebugTool.cs`：一个最小的 WebView2 宿主（~100 行），编译成 `DebugTool.exe`，
用 `/win32icon:debug.ico` 把**多尺寸 ico** 烧进 exe。这样任务栏/标题栏直接取对应尺寸，不再缩放。

| 项 | 说明 |
|---|---|
| 窗口 | 1180×860（按 DPI 缩放），标题 `Debugging Tool · 本地 AI` |
| 图标 | `debug.ico`（16 ∂ / 24-48 ∂+? / 64+ ∂AI?） |
| 数据目录 | `<程序目录>\data\webview2-debug`，与主界面互不影响 |
| 服务没起 | 先探端口，1.2 秒连不上就弹提示，不会开一个白屏窗口 |
| WebView2 缺失 | 回退默认浏览器打开 |

`POST /api/debug/open` 现在的顺序：**有 `DebugTool.exe` 就用它**，没有才回退 `localai-debug.mjs --ui`。

### 二、调试工具自己的图标族

之前调试身份只有一张 512 完整稿（∂+AI+?），直接缩到 16px 必然糊。现在补了两份：

| 文件 | 用在 | 内容 |
|---|---|---|
| `icon-debug-small.svg` | 16 | 只画 ∂ |
| `icon-debug-mid.svg` | 24 / 32 / 48 | ∂ + 小 ? |
| `icon-debug.svg` | 64 / 128 / 256 | ∂ + AI + ? |

`docs\resize-debug-icon.ps1` → `icon-parts-debug\` → `make-ico.mjs`（第二个参数指定输出）→ `debug.ico`。
网页一侧同时提供 `/debug-icon.ico` 与 `/debug-icon.png`，Edge 回退路径也不至于太糊。

### 三、验证

- 编译 `DebugTool.exe` 41KB；从 exe 读回 32px 图标 = `∂` + 青色 `?`（清晰，不是缩放出来的）；
- `POST /api/debug/open` 返回 `{ok:true, pid:21780, exe:true}`，进程的 `MainWindowTitle` 是 `Debugging Tool · 本地 AI`；
- 服务端日志：`打开调试工具（DebugTool.exe，pid 21780）`。

### 四、打包

`build-portable.ps1` 增加一步「编译调试工具」，依赖检查补 `launcher\DebugTool.cs` 与 `debug.ico`；
`debug.ico` 也拷进 `app\`（`/debug-icon.ico` 直接读它）。

## 三十一、2026-11-01：调试窗口「里面是糊的」——DPI 两处错

给调试工具做了 `DebugTool.exe` 之后，用户反馈**窗口内容发虚**。查下来是两个独立的 DPI 错误叠在一起。

### 一、进程没有真正 per-monitor 感知

`app.manifest` 里明明写了 `PerMonitorV2`，但 .NET Framework 的 WinForms 只认它自己的 DPI 设置：
实测进程里 `form.DeviceDpi` 恒为 96，而 `GetDpiForWindow(hwnd)` 是 **168**（175% 屏）。
结果是窗口按 100% 渲染、被系统整体拉伸 → 糊。

修：`Main` 一进来就 `SetProcessDpiAwarenessContext(new IntPtr(-4))`（PER_MONITOR_AWARE_V2）。

### 二、尺寸拿错了 DPI

第一版用 `Graphics.FromHwnd(IntPtr.Zero).DpiX` 算缩放——它给的是系统 DC 的 96，于是 1180×860 被当成物理像素，
在 175% 屏上窗口只有别人一半大（实测 688×528）。

修：尺寸挪到 `form.Load`（句柄已建）里算，用 `GetDpiForWindow(form.Handle) / 96` 作为缩放；
顺带发现 `Form.CenterToScreen()` 是 protected，编译报 CS0122，改成手算 `(工作区 - 窗口) / 2`。

### 三、验证

- `GetDpiForWindow = 168`，窗口物理尺寸 **2089×1569**（≈1180×860 × 1.75 + 边框）；
- 1:1 截图裁字：边缘锐利，不是拉伸出来的；
- 从 exe 读回的 32px 图标 = `∂` + 青色 `?``（图标那条之前已修好）。

### 四、顺带的坑：用 PowerShell 截图验证也会踩同一个 DPI

DPI 不感知的 PowerShell 里调用 `GetWindowRect` 得到的是**虚拟化后**的尺寸（2065×1505 变成 1180×860），
于是 `PrintWindow` 只截到左上角一块。抓图脚本开头也要 `SetProcessDpiAwarenessContext(-4)`。

## 三十二、2026-11-01 会话收尾：这一轮到底改了什么（索引）

这个会话从「读交接文档」开始，一共 15 个提交（`b6a9175` → `af0eb0c`）。按主题列一下，方便下个会话按需回看：

### 一、工程基建

| 提交 | 内容 |
|---|---|
| `b6a9175` | 代码入库（基线）：322 文件 / 26.9MB，`.gitignore` 挡模型/发布包/运行数据，`.gitattributes` 保证字节不变 |
| `d9f5147` | v1.0.0：`APP_VERSION` 单一来源、`/api/version`、设置→关于；构建标识只认「文件被 git 跟踪」 |

### 二、验证体系

| 提交 | 内容 |
|---|---|
| `d5ba635` | 驱动开跑前预加载 7B；`probe-ui-backup` 自造会话；`.Trim()` 空值崩溃 |
| `501f5da` | **45 条 / 585 断言全绿**；驱动加「服务挂了自动拉起 + 重装模型」；`probe-sidebar-search` 去掉固定 sleep |
| （11-01）| 新增 `probe-debug`（25）、`probe-ui-debug`（19）；全量驱动扩到 47 条 |

### 三、Debugging Tool

| 提交 | 内容 |
|---|---|
| `b235e7b` | `buildDiag()` 17 项检查、`/debug` 页、`localai-debug.mjs`（`--ui`/`--json`/`--logs`）、顶栏 Debug 按钮 |
| `d4ae1a4` | 调试窗口改成独立 `DebugTool.exe`（WebView2 宿主 + `debug.ico`），任务栏图标不再糊 |
| `af0eb0c` | DPI：显式 `SetProcessDpiAwarenessContext(-4)` + `GetDpiForWindow` 定尺寸（否则 175% 屏上又小又糊） |

### 四、品牌与图标

| 提交 | 内容 |
|---|---|
| `1ebda27` | 模型按钮迷你标记（第一版，∂） |
| `dd1ca9b` | 恢复本体 `∫`；黑底块字色固定 `#f6f8fa`（原来跟 `--text`，浅色主题下看不见） |
| `cb65012` | **两套身份分开**：本体 `∫+AI`、调试 `∂+AI+?`；启动器重编译 |
| `868f0d7` | 原始白底图标归档到 `server\icons\`；桌面快捷方式 `IconLocation` 改指 `localai.ico` |
| `e1fa8f1` | 顶栏窄窗（175% 缩放 ~850 CSS px）不再挤成竖排；16/32px 图标用简化稿 |

### 五、打包

| 提交 | 内容 |
|---|---|
| `cb85870` | 打包清单补调试工具四个文件 |
| `7111ecb` | 打包清单补 `doc-extract.mjs`——**这一条漏了会让整包起不来**（10-29 起一直是手工拷的）；`technique\05` 新增「打包后必须自检」清单 |

### 六、这一轮新踩的坑（都写进 `technique\07` / `08`）

1. **启动器是单实例**：`Start-Process` 只激活旧实例，不会重启服务（误判成「代码没生效」花了不少时间）；
2. **打包脚本不报错 ≠ 包完整**：漏一个 import 的文件，包就起不来；
3. **PowerShell 的 `>` 写二进制会变成 UTF-16**：从 git 取 ico 必须 `cmd /c`；
4. **DPI 三件套**：清单不够，要显式声明 + 用 `GetDpiForWindow` + 在 `Load` 里定尺寸；连抓图脚本都得先声明；
5. **`$env:ProgramFiles(x86)`** 在 PowerShell 里取不到值，要写 `${env:ProgramFiles(x86)}`。

### 七、收尾状态

- 15 个提交，工作区干净，HEAD = `af0eb0c`；
- 应用在 `dist\LocalAI` 跑着（v1.0.0，`buildSource=mtime`），调试窗口 `DebugTool.exe` 可正常打开；
- **47 条全量尚未整跑**；`build-portable.ps1` 新增的「编译 DebugTool.exe」步骤也还没整跑验证。








### 五、遗留（都不算新缺陷）

- `probe-tools-agent` 仍会触发 Vulkan device lost（已知问题 2：生成中途断开/中止），这台机器的固有取舍；
- 驱动的 `summary.txt` 是**混合编码**：表头 `Out-File -Encoding utf8`、逐条 `Tee-Object -Append`（默认 UTF-16），一个文件两种编码，读的时候要分别解。下次统一改成 `[IO.File]::AppendAllText(..., UTF8)`；这一轮先用 `RESULT.md` 当正式汇总；
- CPU 后端整跑会慢很多（`tools-agent` 80s → 分钟级），驱动里那些 300–420s 的上限要预留。


### 六、这一轮没做

- **真·更新检查**：要做就得先定「版本清单从哪来」。没有分发通道就不做假按钮；将来做，按 `/api/version` 的形状比对即可。
- **版本写进 exe 元数据**：要改 `Launcher.cs` + 重编译启动器，收益（资源管理器里能看到版本）小于风险，先放在界面上。
- 打标签（`git tag v1.0.0`）：只在本地有意义，等真有第二台机器对版本时再打。

## 三十三、2026-11-01（第二轮）：47 条全量整跑 + 完整打包自检

交接文档「下一步 1、2」在这一轮一次做掉：**47 条全量探针整跑**（把 11-01 新增的 `probe-debug` / `probe-ui-debug` 并进大盘）与**完整打包一次**（验证 `build-portable.ps1` 新增的「编译 DebugTool.exe」步骤）。两件事交给两个队员并行编排：Lead 备环境（备份会话、裸 node + headless Edge）并收尾恢复，`probe-runner` 跑大盘，`packager` 打包自检。

### 一、47 条全量：629 断言 / 全绿 / 0 崩溃

| 项 | 值 |
|---|---|
| 环境 | 裸 node（`node app.mjs`，无启动器兜底）、headless Edge CDP 9333（Edg/156）、Vulkan、7B ctx 16384 |
| 时间 | 10:44:42 → 10:59:06，**864.5s（约 14m25s）** |
| 结果 | **47 条全绿 / 0 真红；629 条断言**（首跑 628 通过 + 1 首跑红、复跑通过） |
| 崩溃 | **0 次**：无 device lost、无 `server-restart-*`、服务 `startedAt` 全程未变、`vulkan-crash.log` 无新增（10-31 的 3 条旧记录还在） |

唯一红项 `probe-code-run`：首跑 `FAIL C++ 编译并执行 ms=11773`（12/13），撞上服务端硬超时 `RUN_TIMEOUT_MS=10000`（`app.mjs:5369`）；同参数复跑两次都是 **13/13**（C++ 9445ms / 8562ms）。归因是**冷机 MSVC 编译卡 10s 边界**（VC 分支把 vcvars + cl + 运行塞进同一次 spawn，`app.mjs≈5544`），不是探针过期、也不是本轮改动引入的回归。建议下轮给「编译类语言」单独放宽超时（编译 30s / 运行 10s 分开计时）。

会话数据按约定先备份到 `server\docs\session-backups\2026-11-01_10-42-34\workspace-full`（294 文件 / 189KB），跑完从备份恢复 `workspace\`（1 个真实会话 10842B 回来了，探针清掉的会话没有丢）。

### 二、完整打包：19.7s / 258.1MB / 12/12 自检

| 项 | 结果 |
|---|---|
| 打包 | PowerShell 5.1 跑 `build-portable.ps1`：**exit 0 / 19.7s**，8 个步骤全执行，含**首次整跑**的 `==> 编译调试工具（独立窗口 + 自己的 ico）` |
| 产物 | **258.1MB / 3442 文件**（起服务后 3445 = +2 个 log + `app\server.pid`）；app\ 144.1MB，与基线一致 |
| DebugTool.exe | 42,496B、11:04:29 重编、MZ 头 `4D 5A`；启动器 57,344B 同时重编 |
| 源码一致 | app.mjs / app.html / doc-extract.mjs 三份 SHA256 3/3 与 `server\` 相同 |
| 能起来 | `/api/state` 200（29.7s 就绪，7B ctx 16384 vulkan）；`/api/version` 的 dir=`dist\LocalAI\app`（证明跑的是发布包，不是源码 dev 服务） |
| 调试工具 | `/debug` 200（12456B）、`/debug-icon.png` 200、`/debug-icon.ico` 200、无令牌 `POST /api/debug/open` **403** |
| 回归 | `probe-debug` **25/25**、`probe-rag` **16/16**；包内 `localai-debug.cmd`（17 项检查全 ok）/ `localai.cmd models` 均 exit 0 |
| 收尾 | 发布包保持运行（启动器 PID 7560 + 服务 PID 20084，桌面快捷方式指向新包） |

### 三、口径与踩点（写给下次）

1. **文件数三个基线要分清**：文档里的 3439 是「调试工具还没进清单」的旧基线；3444 是旧 dist（含 2 个运行期 log）；本轮新包 3442，起服务后 +3 个运行期文件 = 3445。**看文件数先问「含不含 logs / server.pid」**。
2. **`/api/version` 的 `source=mtime` 不是错**：发布包 `app\` 不在 git 跟踪内，构建标识按约定回落文件 mtime；`Copy-Item` 保留源文件时间，所以 builtAt 是源文件修改时间（10:26）而不是打包时间（11:04）。
3. **`probe-debug` 的「清崩溃记录」会删文件再写回**：`vulkan-crash.log` 的 CreationTime 会变成当天，但内容逐字节不变——别把它当成「本轮又崩了」。
4. **打包脚本的 `Write-Host` 不进普通管道**：要留完整日志，外层包 `Start-Transcript`（或直接 5.1 控制台跑）；`-File ... > out.txt` 只能拿到一部分。
5. **探针里有 2 条「观察型」**（`probe-ui-metric` / `probe-kv-long`，只打印指标、无断言）：它们绿只代表进程正常退出，断言统计里记 0，别按「少了断言」去查。
6. **打包前必须全停**：本轮实测有两个「看似都在跑」的服务——源码 dev 服务占 8099、发布包启动器占 `dist\data`。打包前按 technique/05 精确杀（按 CommandLine 过滤），别用 `Stop-Process -Name msedgewebview2`（会误杀 DSH）。

### 四、证据

- 全量：`server\docs\probe-full-2026-11-01\RESULT.md`（47 行逐条表 + 红项归因）+ `logs\`（各条 out/err、两次复跑）
- 打包：`server\docs\packaging-2026-11-01\RESULT.md` + `build.out.txt` / `prebuild.txt` / `verify.txt` / `state.json` / `http.txt` / `probe-*.out.txt` / `cli-smoke.txt`
- 会话备份：`server\docs\session-backups\2026-11-01_10-42-34\workspace-full`（gitignored，可删）

### 五、这一轮没做

- **没改产品代码**：C++ 编译超时只记下来（建议下轮单独小修）；
- 没打 tag、没做发布分发（仍无分发通道）。

## 三十四、2026-11-01（第三轮）：模型按钮显示对应模型的图标

用户截图指出：顶栏模型按钮一直显示本体 `∫`，要求「选中哪个模型就展示对应模型的图标」。以前品牌图标只用在**发送键旁的下拉小图标**和**下拉菜单行**里（`vendor\models\*.png`：microsoft / qwen / openai / deepseek），顶栏按钮这一处是漏的。

### 一、做法（`app.html` 三处 + 探针一处）

| 层 | 改动 |
|---|---|
| 结构 | 按钮里的 `<span class="int"><b>∫</b></span>` 增加一个隐藏的 `<img id="modelBtnImg">`，`∫` 保留作回退 |
| 样式 | `.int.has-brand` 去掉黑底/边框，品牌图标 22×22 `object-fit:contain`；没有品牌时仍是 `∫` 黑底标记（自定义 gguf 不会变空白） |
| 逻辑 | `updateModelBtn()` 里复用已有的 `brandOf()`：加载谁就换谁的图标，同时管顶栏按钮与发送键旁图标；认不出品牌 → 回退 `∫` |
| 探针 | `probe-ui-debug` 原来断言「标记是 ∫ / 底色黑」，改成「品牌图标可见且 src 与 `/api/state` 的 `loaded` 对应品牌一致 + 有 22×22 尺寸 + 回退 ∫ 仍在」；断言 19 → **20**，期望品牌由服务端状态推出（以后换模型探针不该红） |

> 边界：品牌判断顺序沿用 `brandOf()` 的既有约定（DeepSeek 的蒸馏模型名里带 qwen，必须先判 deepseek）；未知品牌一律回退本体标记，不猜。

### 二、验证

- 相关 UI/结构探针复跑全绿：`probe-ui-debug` **20/20**、`probe-start-screen` 12/12、`probe-hero-modes` 11/11、`probe-model-add` 4/4、`probe-ui-new` 30/30、`probe-menu-stacking` 2/2、`probe-status` 6/6、`probe-ctx-panel` 24/24；接口 `probe-debug` 25/25。
- 截图核对：加载 7B（Qwen）时按钮显示 Qwen 标；加载 R1 时显示 DeepSeek 标，22px 下不糊；hero 里的 `∫ Agent 模式` 未动（`probe-hero-modes` 仍在断言）。
- 两个小插曲（都不是产品回归）：① 验证中途旧 node 服务被上轮工具进程树回收，`probe-model-add` 等报 ECONNRESET → 重启发布包后复跑全绿；② 复跑期间内嵌窗口切了模型（日志 11:15:37 加载 DeepSeek-R1），`probe-hero-modes` 的「发送后进入对话」被并发生成打断红了一次，单独复跑 11/11。

### 三、落地与口径

- `dist\LocalAI\app\app.html` 已同步（SHA256 一致）；**`app.html` 每请求重读，刷新即生效，不用重启 node**。
- 断言口径：全量从 **629 → 630**（`probe-ui-debug` +1），下次全量整跑时用 630 核对。

## 三十五、2026-11-01（第四轮）：上下文档位加到 128K

用户问「上下文不能再长点了？」——顶栏一直显示 16K。查下来**不是模型限制**：`qwen2.5-7b-instruct-1m` 的 GGUF 元数据 `qwen2.5.context_length = 1,010,000`，模型本身支持 1M；16K 只是默认值，菜单里本来就能选 8K/16K/32K/64K，只是没说明、也没有更长的档。

### 一、改动

| 文件 | 改动 |
|---|---|
| `app.html` | 上下文下拉加 **128K（131072）** 档；`title` 写清 KV 缓存随长度线性涨（32K≈1.9GB / 64K≈3.7GB / 128K≈7.3GB） |
| `probe-ctx-panel` | 新增「上下文下拉含 8K/16K/32K/64K/128K」断言（24 → 25 条） |

### 二、为什么是内存，不是模型

Qwen2.5-7B（28 层、4 个 KV 头、head_dim 128、f16 KV）≈ **56KB/token**：

| 档位 | KV 缓存 |
|---|---|
| 16K | ≈0.9GB |
| 32K | ≈1.9GB |
| 64K | ≈3.7GB |
| 128K | ≈7.3GB |
| 256K | ≈14.7GB |
| 1M | ≈57GB（这台机器不可能） |

模型权重 4.36GB 另算。这台机器 31.4GB 内存 + Intel Arc 核显（共享内存），当前开着 R1 时可用物理内存只剩 ~5.6GB——所以「能不能更长」实际是「能腾出多少内存」。想跑 64K/128K 时先关掉别的吃内存程序（浏览器、其它模型）再切。

### 三、验证与落地

- `probe-ctx-panel` **25/25**、`probe-ui-debug` 20/20；`dist\LocalAI\app\app.html` 已同步（刷新即生效）。
- 用法：模型菜单底部「上下文」选档 → 点一下模型行重新加载（约 15–60s，看档位）。
- 断言口径：629 → 630（三轮）→ **631**（本轮 `probe-ctx-panel` +1）。

## 三十六、2026-11-01（第五轮）：KV 缓存量化（默认开）+ 调试工具实时资源观测

用户两条要求：① KV 量化**默认开启**（同样内存下上下文翻倍）；② Debugging Tool 里加**实时系统资源观测**。这轮用了子智能体：`debug-ui` 做调试页与探针，Lead 做 app.mjs 的 KV 量化与集成验收。

### 一、KV 缓存量化（`app.mjs`，默认开）

| 项 | 做法 |
|---|---|
| 主上下文 | `createMainContext()` 默认 `experimentalKvCacheKeyType/ValueType = "q8_0"` + `flashAttention: "auto"`；**失败自动回退 f16**（只记日志，不影响启动） |
| 可观测 | `/api/state` 加 `kvQuant`（q8_0/f16）与 `kvQuantFallback`；`/api/diag` 加「KV 缓存量化」检查（检查项 17 → **18**）；启动日志 `就绪: … | KV q8_0 |` |
| 预加载 | 第二意见常驻模型（`preloadModel`）的上下文同样量化 |
| 关闭 | 环境变量 `KV_QUANT=f16` 后重启（`off/0` 同义）；换类型也可试 `KV_QUANT=q4_0` |

实测（7B Q4_K_M、Vulkan、31.4GB 内存、q8_0 KV）：

| 上下文 | 加载耗时 | 加载后系统可用内存 |
|---|---|---|
| 16K | 12–15s | ≈6.8GB |
| 64K | 16.4s | ≈3.8GB |
| 128K | 22.2s | ≈0.2GB（能装下但几乎吃光，系统会紧） |

非量化时 128K 光 KV 就要 7.3GB（f16 56KB/token），这台「32GB 里系统先占 16GB」的机器装不下；量化后能跑，日常建议 **≤64K**。

### 二、调试工具：实时系统资源观测

- 新接口 **`GET /api/diag/resources`**（只读、不需要令牌、给 2 秒轮询用）：`cpu{usagePct,cores,model}`、`mem{totalGB,usedGB,freeGB,usedPct}`、`proc{pid,uptimeSec,rssMB,heapUsedMB,externalMB}`、`disk`、`model{file,context,layers,gpu,kvQuant,kvReuse,cachedTokens,activeChats}`、`crash`。
  - CPU 用两次 `os.cpus()` 的 delta；服务刚起第一次 `usagePct=null`（页面显示「—」并 1.1s 后补采；探针只断言第二次，避免抖）。
- `debug.html`：右侧第一张卡「实时资源」——CPU/内存百分比条（≥70% 黄、≥90% 红）、进程 RSS/heap、磁盘、模型/后端/KV 量化/并发/崩溃、60 点 canvas sparkline（CPU 青 / 内存 紫 / 70% 黄虚线）、2 秒轮询（仅页面可见时）；「模型与推理」加 KV 量化行；「复制报告」补一行实时资源。
- `localai-debug.mjs`：文本报告加一行实时资源；`--json` 加 `resources` 字段（服务不可达时不加，保持原行为）。

### 三、验证

| 探针 | 结果 |
|---|---|
| `probe-debug` | 25 → **34/34**（+9 条：200 无令牌、字段形状、内存自洽、RSS、磁盘、第二次 CPU 采样、now 推进、kvQuant 与 `/api/state` 一致） |
| `probe-ui-debug` | 20 → **23/23**（+3 条：资源卡 + sparkline 已绘制、2.6s 后有数值与条形宽度、调试页无未捕获 JS 异常） |
| `probe-ctx-panel` | 25/25 |
| `probe-version` | 14/14 |
| `probe-chat-plain` | 11/11（量化 KV 下对话正常） |
| `probe-func` / `probe-kv-long` | 9/9、通过（KV 复用照旧，复用率 70–99%） |

- 页面实测（1440×900）：CPU 13% · 内存 25.3/31.4GB(81%) · 进程 RSS 9738MB · 磁盘剩余 303.5GB · KV 量化 q8_0。证据：`server\docs\debug-resources\RESULT.md` + `page.png`。
- 断言口径：631 → **643**（`probe-debug` +9、`probe-ui-debug` +3），下次全量整跑按 643 核对。

### 四、落地与遗留

- 已同步 dist：`app.mjs` / `debug.html` / `localai-debug.mjs`；应用已用新代码重启（7B · ctx 16384 · q8_0 · Vulkan）。
- 遗留：完整打包还没重跑——下次打包会把新 app.mjs/debug.html/localai-debug.mjs 带进发布包；**当前发布包里的 `localai-debug.mjs` 已手工同步**，所以 CLI 的 `--json resources` 现在就能用。
- 量化是「省内存」不是「零代价」：q8_0 KV 有极小精度损失；如果哪天回答质量可疑，`KV_QUANT=f16` 重启可对照。

## 三十七、2026-11-01（第五轮后续）：KV 量化其实没生效——小写 "q8_0" 被静默忽略

用户追问「真的可以吗」。把「实际生效类型」读出来（`LlamaContext.kvCacheKeyType`）才发现：**上一节说的 q8_0 根本没生效，实际一直是 f16**——`/api/state` 里的 `kvQuant=q8_0` 只是我们请求的值，不是库的实际值。这一节把坑、修法、重测数据写清楚。

### 一、根因：ggml 类型名区分大小写，解析不到就静默回落

`node-llama-cpp` 的 `experimentalKvCacheKeyType` 只认**枚举名（`"Q8_0"`）或数字（8）**；传小写 `"q8_0"` 时 `resolveGgmlTypeOption()` 解析不到，**静默回落到模型默认 F16，不报错**。同一模型逐项实测：

| 传参 | 实际 key |
|---|---|
| `8`（数字） | 8 = Q8_0 ✅ |
| `"Q8_0"` | 8 = Q8_0 ✅ |
| `"q8_0"`（小写） | 1 = F16 ❌（不报错） |

### 二、修法（把「请求」和「实际」分开）

- `app.mjs`：加 `GGML_KV_TYPES`（`q8_0 → 8`）**传数字**；创建后读 `context.kvCacheKeyType`，**按实际类型记录**（不一致就记 f16 + 回退原因，不谎报）；`/api/state` 增 `kvQuantActual{key,value,flashAttention}`；`/api/diag` 的「KV 缓存量化」改成「实际 X（请求 Y）」，不一致就 warn；调试页显示实际类型。
- `probe-debug`：加断言「KV 量化实际生效类型与配置一致（LlamaContext getter）」→ 34 → **35/35**。这条断言就是为了防这次这种「谎报」。

### 三、重测（真实 q8_0）

| 上下文 | 加载 | 系统可用内存 | node 进程 WS |
|---|---|---|---|
| 16K | 12–17s | 7.4GB | 9.2GB |
| 64K | 11.5s | 7.4GB | 9.0GB |
| 128K | 10.2s | 4.8GB | 12.4GB |

对比 f16 的 128K（可用只剩 0.2GB）：**q8_0 确实省了约 3–4GB**，128K 从「勉强」变「紧但可用」。上一节的 0.2GB 是 f16 数据，作废。

### 四、顺带查清：20K token 单次预填充会崩 Vulkan——与量化无关

本想用「长文档 + 暗号」验证长上下文，结果 64K 窗口下一次 20K token 预填充，**q8_0 和 f16 各崩一次**（`vk::Device::getFenceStatus: ErrorDeviceLost`）：

- 这是**已知问题 2 的 Vulkan 局限**（这台 Intel Arc 核显上长 prefill 会 device lost），不是 KV 量化引入的；
- 应用自愈正常：第一次崩 → 启动器拉起；10 分钟内第二次崩 → 自动切 CPU（实测 `gpu=cpu`，稳定但慢）；清掉 `vulkan-crash.log` 再启动可回 Vulkan；
- 结论：长上下文**能加载、内存也够**，但**一次性塞 2 万 token 以上的预填充在 Vulkan 上不稳**。日常建议 16K–64K；真要超长输入，分批喂或临时用 CPU。

### 五、当前状态

- 发布包：16K · **q8_0（实际 key=8，已用 getter 验证）** · Vulkan · 运行中；崩溃记录已清空。
- 探针：`probe-debug` **35/35**、`probe-ui-debug` 23/23、`probe-ctx-panel` 25/25、`probe-version` 14/14、`probe-chat-plain` 11/11、`probe-func` / `probe-kv-long` 全绿。
- 断言口径：643 → **644**（`probe-debug` +1）。

## 三十八、2026-11-01（第六轮）：正式封装 QingYaoTP AILauncher v1.1.0

产品正式定名 **QingYaoTP AILauncher**（QingYaoTP = QingYaoTestifypred），主品牌 + 「本地 AI」副标题；目标机是用户的 8GB 老笔记本（i5-10210U + RX640 2GB），所以首启必须能自动给出「跑得动」的配置。

### 一、改名（可见面全换，契约面不动）

- 发布目录 `dist\QingYaoTP AILauncher`、主程序 `QingYaoTP AILauncher.exe`；调试窗口 `DebugTool.exe` 标题 `Debugging Tool · QingYaoTP AILauncher`；托盘/窗口/提示/CLI/TUI/使用说明同步。
- 界面：`<title>`、开场白品牌行（主名 + 「本地 AI」副标题）、设置→关于新增产品行、复制版本信息、退出确认、导出文件头、调试页报告头。
- 版本 v1.0.0 → **1.1.0**（app.mjs / package.json / localai.mjs / localai-tui.mjs / manifest 5 处对齐）。
- 契约面保持不动：`localai*.mjs/cmd` 文件名、`localai.ico`、CLI 命令名 `localai`、`LOCALAI_*` 环境变量、localStorage 键 `localai.*`。单实例 Mutex/Pipe 改名 `QingYaoTP.AILauncher.Portable.*`（新旧 exe 不互认，测试时别同时开）。
- 桌面快捷方式：新建 `QingYaoTP AILauncher.lnk`（IconLocation 指 `localai.ico,0`），删除旧 `本地 AI.lnk`。

### 二、首启「自动检查用户配置」

- **GET `/api/sysinfo`**：CPU/核数/内存、GPU（CIM 查名称+显存，只查一次）、Vulkan 可用性、VC++ 运行库、磁盘、已有模型 → 7 条 `checks[]` + `recommend{tier, model, contextSize, kvQuant, gpu, reason, notes}` + `firstRunDone`。
- **POST `/api/firstrun/apply`**：按建议写 `config.ini`（仅发布包有该文件时；开发目录跳过）+ 标记 onboarding done + 推荐模型已在本地则立即按推荐上下文加载。支持 `{dryRun:true}`（探针用：只回建议，不写盘、不加载）。
- 推荐逻辑抽成纯函数 **`server\config-recommend.mjs`**（probe-firstrun 直接 import 单测）：
  - <10GB（或 <16GB 且可用<6GB）→ tiny：0.5B + 4K；
  - <16GB → small：0.5B + 8K；<24GB → medium：0.5B（可用≥8 用 Q8）+ 8K；
  - ≥24GB → large：**优先本机已有的非思考/工具友好的大模型**（qwen2.5-7B > qwen3-4B > phi > 其它 7B/4B，**DeepSeek-R1 这类思考模型默认不推荐**），16K；
  - KV 量化默认 q8_0；Vulkan 不可用则 gpu=cpu。
- 首启页 ⓪ 段改成「自动检查用户配置」卡片：检查项（点+文字）/ 建议配置 / 「按建议配置并应用」按钮；应用后把上下文下拉设成建议值并（模型已在本地）立即加载；模型缺失时提示先下载（下载区就在下面）。
- 发布包 `config.ini` 模板 `autoLoad=` **留空**（首启不硬加载 7B，交给自动检查推荐；8GB 机器不会一上来 OOM）。

### 三、顺手修掉的两个 bug

1. **C++ 运行超时拆分**：编译 30s / 运行 10s（`runSpawn(..., timeoutMs)`；MSVC 分支拆成「编译 .bat」+「运行 main.exe」两次），消除冷机编译卡 10s 的随机红（probe-code-run 复发风险）。
2. **`probe-plugins` 包感知**：插件目录/plugins.json 改为从 `/api/diag.paths` 推（源码 `server\plugins`、发布包 `HERE\..\plugins`），不再硬编码 `D:\LocalModels\plugins`。

### 四、打包与全量回归

- `build-portable.ps1`：输出目录/安全闸/exe 名/使用说明/config 模板全换；打包清单补 **`config-recommend.mjs`**（漏了整包起不来）。
- 产物：**258.2MB / 3443 文件**；`QingYaoTP AILauncher.exe` 57,344B、`DebugTool.exe` 42,496B；`config-recommend.mjs` 在包内；源码/包哈希 `app.mjs`、`app.html`、`doc-extract.mjs`、`config-recommend.mjs`、`debug.html`、`localai-debug.mjs` 全 MATCH。
- 起包验证：`/api/version` dir=`dist\QingYaoTP AILauncher\app`、v1.1.0；`/debug` 200、`/debug-icon.png`/`ico` 200、无令牌 `POST /api/debug/open` 403；`/api/sysinfo` 推荐 qwen2.5-7B（tier=large/16K/q8_0）；dryRun apply 不写盘不加载。
- **全量回归（包 A + 重建后的包 B）**：48 条探针 / **664 条断言**。首跑 **40 绿 / 8 红**（1543.3s，0 崩溃/0 重启）；8 红同参数复跑 **8/8 全绿** → **48/48 绿、0 真红**；包 B 重建后复验 6 条 **96/96**。
- 8 红归因（全部非功能回归，详见 `docs\probe-full-2026-11-01\RESULT-v1.1.0.md`）：
  - 7 条 = **probe-firstrun 旧版 apply 的副作用**：旧推荐逻辑 `findBig()` 取了目录里第一个 7B/8B（选中 DeepSeek-R1），把驱动预加载的 qwen2.5-7B 换掉，17:08–17:25 的探针全在思考模型上跑（工具调用=0、单块流、40s 等不到标题）→ 已修推荐择优 + dryRun；
  - 1 条 = `probe-plugins` 硬编码 dev 插件目录（发布包目录不同）→ 已改成包感知。
- 收尾：config.ini 还原为 `autoLoad=` 空（SHA256 与备份一致）、workspace 会话 1 个/快照 309 个完好、发布包保持运行（qwen2.5-7B · ctx 16384 · vulkan · q8_0）。

### 五、遗留

- 旧 `dist\LocalAI` 保留作回滚（确认新包稳定后可删）；
- 老笔记本 8GB 实机还没跑过（用户机器）；首启会推荐 0.5B + 4K，需要实测下载/加载闭环；
- 单实例标识改名：新旧 exe 同时开会各起一套（端口冲突会触发自动换端口并写 config.ini），迁移时别同时开。

## 三十九、2026-11-02：老笔记本实战踩坑 + 交接整理

v1.1.0 打包完成后，用户在 8GB 老笔记本（i5-10210U / RX640 2GB）上实测，踩出三个包装层的问题——都不是功能回归，但都会让「拷过去就能用」失败。这一节记录清楚，交接时别重复踩。

### 一、老笔记本实战

| 现象 | 根因 | 处置 |
|---|---|---|
| 双击 exe →「服务进程已退出（退出码 1）」 | `logs\app.log` 里 `ERR_MODULE_NOT_FOUND: Cannot find package 'node-llama-cpp'` —— 散文件夹拷贝把 `app\node_modules`（41 包 / 3431 文件 / 140MB）丢了 | 打**单文件 zip** `dist\QingYaoTP-AILauncher-v1.1.0.zip`（122MB，3947 条目）；本机模拟「只解压 zip」验证 `import('node-llama-cpp')` = OK |
| 模型目录无效 / 下载没地方落 | `build-portable.ps1` 把 `modelDir` 写死成开发机路径 `D:\LocalModels` | 打包默认 `modelDir=` 留空（便携 = `<安装目录>\models`）；启动器解析后自动 `CreateDirectory`；首启 apply 不再写回绝对路径 |
| 0.5B 能跑但回答「猎奇」 | 0.5B 就这水平（能出字，复杂问题胡言乱语） | 8GB + 2GB 显存的甜点是 **1.5B Q4_K_M（~1GB）**；0.5B 只作首启体验 |

其他实测观察（未改代码，留给下一轮）：

- **Vulkan 跑在核显上**：llama.cpp 默认选了枚举里的第一块（Intel UHD 620），RX 640 只在画面合成时动一下。包里的 `ggml-vulkan.dll` 含 `GGML_VK_VISIBLE_DEVICES` 字符串 → 可用环境变量强制选卡（先 `findstr /i "ggml_vulkan" logs\app.log` 看设备编号，再 `set GGML_VK_VISIBLE_DEVICES=1` 启动验证）。
- **AMD 驱动偏旧**：dxdiag 显示 30.0.13023（2021/12，≈Adrenalin 21.12.x）；RX 640（Polaris，已 legacy）最后一版官方驱动是 **30.0.15021.11005 ≈ Adrenalin 22.6.1（2022/06）**，可升这一档（建议 DDU 清旧驱动）；再新的 Vulkan 只有第三方魔改驱动，不推荐。
- **交付/传输方式**：以后一律给 zip（或先 `dir app\node_modules | find "node-llama-cpp"` 自检），别再传散文件夹。

### 二、交接整理

- 交付物（都在 `D:\LocalModels\dist\`）：
  - `QingYaoTP AILauncher\` —— 构建产物/运行目录（config.ini 的 modelDir 留空）；
  - `QingYaoTP AILauncher-v1.1.0\` —— 干净拷贝（无 data/logs 运行期缓存）；
  - `QingYaoTP-AILauncher-v1.1.0.zip` —— 122MB 单文件，**对外交付用这个**；
  - `LocalAI\` —— v1.0.0 旧包，仅回滚用。
- 仓库：v1.1.0 已在 `2f14ece` 提交；之后修的「modelDir 便携默认 + 启动器建目录 + apply 不写死路径」3 个文件在本节后补提交。
- ⚠️ **最终包（modelDir 修复版）只做了手动验证**（起包、`/api/version` dir 正确、`/api/sysinfo` modelDir=`<安装目录>\models`、dryRun apply、`/debug` 200），**没有重跑 48 条全量**；上一轮 48/664 全绿跑的是 modelDir 修复前的包。下次开工建议先补一次全量（或至少 `probe-debug` + `probe-firstrun` + `probe-plugins`）。
- 本机交接状态：应用未运行，8099 空闲；`workspace\sessions` 1 个真实会话完好。

---

## 四十、2026-11-02 深夜 → 11-03：最终包全量回归（全新安装形态）+ P4 修复

交接文档「下一步 1」＝**最终包（modelDir 便携修复版）只手动验证过、没跑全量**。这一节把它补上，并且
第一次**在「全新安装」形态上跑**：每轮先把发布包工作区清空（`<包>\models\workspace`），环境交给驱动预置。
结论：**48 条 / 668 断言全绿**（45 条一次整跑 + 3 条复跑），0 崩溃 / 0 重启，**没有 v1.1.0 功能回归**。
详见 `server\docs\probe-full-2026-11-02\RESULT.md`。

### 一、三轮：41 → 46 → 45，红项全是「环境假设」

| 轮 | 结果 | 红项 | 真因 |
|---|---|---|---|
| 1 | 41/48 | rag、ui-new、start-screen、start-flow、small-features、ui-rag、tools-agent | **全新空工作区**：0 会话 / 无 note.txt / 无检索语料——一批探针默认「工作区里已经有内容」 |
| 2 | 46/48 | rag（15/16）、ui-preload（34/35） | ① 我预置的 `rag-seed.md` 撞了 probe-rag 的检索词，抢了「命中片段带出处」第一名；② 卸载异步，固定 sleep 1.5s 抢在「已取消」提示之前 |
| 3 | 45/48 | menu-stacking、formula-find、preload | **首启引导面板盖住顶栏**（清空工作区后 `onboarding.json` 没了 → `done=false` → 面板 z-index 高于 header）：模型菜单点不到、Ctrl+F 被挡；preload 是有状态残留 |
| 复跑 | **3/3 绿** | — | 驱动补「标记首启引导完成」；三条探针改成轮询等状态 |

> 追加一笔：`probe-ui-preload` 第三轮报 34/34，是因为我改探针时**误删了一条断言**（`取消 @ 后释放常驻`）；
> 补回后复跑 **35/35**，断言口径因此从 664 变 **668**（含 P4 新增的 4 条）。

### 二、改了什么（驱动/探针/推荐逻辑）

1. `run-full.ps1`（11-02 目录）：`$out` 改成脚本自身目录；新增 **`Seed-Workspace`**——从 `/api/diag.paths.sessions` 反推工作区，缺就补「1 个会话（含 assistant 消息）+ note.txt + rag-seed.md + 重建索引」，并 **POST /api/onboarding {done:true}** 把首启面板点掉。
2. `probe-rag.mjs`：工作区根从 `/api/rag/status.dir` 反推（发布包 = `<安装>\models\workspace`，不是开发目录）。
3. `probe-ui-preload.mjs` / `probe-menu-stacking.mjs` / `probe-formula-find.mjs`：去掉固定 sleep，改成「等服务端状态/等元素可命中」的轮询。

### 三、产品侧 P4（已修）：首启建议自相矛盾

- 现象：内存 31.4GB、模型目录为空时，`/api/sysinfo` 的 `reason` 写「可用 7B 级模型，16K 上下文」，`model` 却是 0.5B。
- 根因：large 档找不到本地大模型时落到 0.5B 目录项，`reason` 仍按档位写死；7B 在 ModelScope 是**分片文件**，当前下载器只吃单文件。
- 修法：① 下载目录新增 **Qwen2.5-1.5B-Instruct Q4_K_M（单文件 1.12GB，已实测 206 可下）**；② large 档没有本地大模型 → 推荐 1.5B，文案改「本机还没有 7B 级模型，先下 1.5B（约 1.1GB）跑通」；③ small/medium 在可用内存 ≥8GB 时优先 1.5B（0.5B 只留给 tiny/低内存兜底）；④ `probe-firstrun` 新增 4 条断言 → **22/22**。
- 顺带补上了交接「下一步 2」的一半：1.5B 现在**在界面里可直接下载**（老笔记本不用手工拷文件）。

### 四、收尾与口径

- 复验：`probe-firstrun` 22/22、`probe-debug` 35/35（需已加载模型）、`probe-version` 14/14。
- 落两处：`app.mjs` / `config-recommend.mjs` 已拷进 `dist\QingYaoTP AILauncher\app\`（SHA256 MATCH）；探针只在仓库，不进包。
- config.ini 跑前跑后 SHA256 一致；开发工作区真实会话完好；发布包服务已停、headless Edge 已关、包内模型硬链接已删。
- **断言口径：664 → 668**。下一轮全量按 668 核对；驱动会自己预置环境，不要再假设「工作区里有真实会话」。
- 未做：7B 分片下载支持（要改下载器支持多文件 + 校验）；P4 的 live「空模型目录」重启验证（目前只有纯函数单测）。

### 五、11-03 深夜补一笔：本机运行目录的 modelDir 改回绝对路径

跑完探针后包内 `models\` 里我加的 5 个硬链接被删掉（硬链接只是目录项，**源文件 D:\LocalModels\*.gguf 5 个一直都在**），
但 11-02 的便携化修复让发布包 `config.ini` 的 `modelDir` 留空 = `<安装目录>\models\` —— 这台开发机的界面因此看不到那 5 个模型
（用户以为模型被删了）。已把**本机运行目录**的 `config.ini` 改成 `modelDir=D:\LocalModels`，重启后 5 个模型 + 1 个真实会话都回来了。

⚠️ **只改了本机运行目录**；交付 zip / `build-portable.ps1` 生成的模板仍然是 `modelDir=` 留空（便携默认），别再写死本机路径。

### 六、11-04 00:00 前后：P4 改动后的全量复验

P4（首启建议 + 1.5B 下载档）改完只跑了 probe-firstrun，按规矩补了全量：

- **P4 live 验证**：`modelDir` 指到空目录真机重启 → `tier=large`、推荐 1.5B、文案「本机还没有 7B 级模型，先下 1.5B」——自相矛盾消除。
- **全量 48 条 / 668 断言全绿**：一次整跑 47 条通过、0 崩溃/0 重启；唯一红是 `probe-preload`（余量断言的 0.05 四舍五入边界 + 「<25s」在忙时 29.4s），两处都是探针阈值，放宽后复跑 **26/26**。
- 驱动这次也验证了「标记首启引导完成」那一补丁：摘要里有 `[driver] 已标记首启引导完成`。
- 证据：`server\docs\probe-full-2026-11-03\RESULT.md`。
- ⚠️ **交付 zip 仍是 P4 之前打的**（dist 运行目录已含 P4 代码）——下次要交付得先重打 zip。

---

## 四十一、2026-11-04：显卡（Vulkan 设备）选择入口 —— 「独显调动」

用户要「加个独立显卡调动入口，虽然这台机器没法用独显」。背景是交接文档里那条：老笔记本（i5-10210U + **Intel UHD 620 核显 + AMD RX640 2GB 独显**）
上 llama.cpp 默认挑了枚举里的第一块，也就是**核显**，独显一直没干活。这一轮把「选哪块卡」做成了产品功能。

### 一、做了什么

| 层 | 改动 |
|---|---|
| 接口 | 新增 `GET /api/gpus`：Vulkan 设备清单 `{index,name,vramGB}[]` + `current`（本进程生效）+ `config`（config.ini 写的）+ `needRestart` + `backend`/`pref`；`POST /api/gpus` `{devices:"" | "0" | "0,1"}` 写 `config.ini` 的 `vkDevices`，非法/越界 400 |
| 启动链路 | `Launcher.cs` 读 `config.ini` 的 `vkDevices` → 设 `GGML_VK_VISIBLE_DEVICES`（llama 只在初始化时读一次）；开发模式（`node app.mjs`）由启动段自己读 config 顶上 |
| 界面 | **设置 → 显卡**：后端/偏好、设备列表（名称 + 显存）、「自动 / 设备 N」单选、保存 + 「重启生效」提示；CPU 后端时不可选 |
| 可观测 | `app.log` 启动行 `Vulkan 设备：0=Intel(R) Arc(TM) Graphics（只可见 0）`；`/api/diag` 新增「显卡选择」检查项（调试工具里能看到） |
| 配置模板 | `build-portable.ps1` 的 config 模板加 `vkDevices=`（留空 = 全部设备） |

### 二、验证

| 项 | 结果 |
|---|---|
| `probe-gpu`（新，接口） | **14/14**：形状、设备项、非法/越界 400、保存写盘、读回自洽、恢复空、diag 有「显卡选择」 |
| `probe-ui-gpu`（新，界面） | **8/8**：页签、后端信息、设备选项数 = 服务端设备数 + 自动、保存后 config=0、提示、恢复、无 JS 异常 |
| 端到端（启动器真传环境变量） | 写 `vkDevices=0` → 重启启动器 → `/api/gpus.current=0`、`needRestart=false`、日志 `（只可见 0）` ✅（本机只有 Intel Arc 一块，测不出「选独显」效果，但链路是通的） |
| 全量回归（50 条） | 见 `server\docs\probe-full-2026-11-04\RESULT.md` |

### 三、这台机器为什么测不出效果

本机只有 **1 块 Vulkan 设备**（Intel Arc 核显，显存共享），没有独显可选——列表里就是那一项。
功能是给老笔记本（UHD 620 + RX640）和其它双卡机器准备的：那边打开「设置 → 显卡」应该能看到两块，选独显那一项 → 保存 → 重启。

### 四、留给下一轮

- **老笔记本真机验证**：先看列表有没有 RX640；有就选它、重启、`app.log` 应出现 `只可见 1`（或对应设备号）且生成速度变化；没有就升 AMD 驱动（22.6.1 / 30.0.15021.11005）再看。
- 交付 zip 仍是 P4 之前打的；这一轮又改了 app.mjs / app.html / Launcher.cs / config 模板，**下次交付必须重打 zip**（并确认包里的 `QingYaoTP AILauncher.exe` 是新的 57,856B 版本）。
下次在这台机器上跑全量探针，要么先把运行目录的 modelDir 指回 `D:\LocalModels`，要么跑完立刻把界面能看到的模型恢复并告知。






---

## 四十二、2026-11-05 深夜：紧急接手 → 重打发布包与交付 zip（补 `make-zip.ps1`）

11-04 显卡选择收尾时留了一笔账：**dist 运行目录已是 11-04 的代码（P4 + 显卡选择），但对外交付的 `dist\QingYaoTP-AILauncher-v1.1.0.zip` 还是 11-01 21:52 打的**——两轮 RESULT 都写了「下次交付必须重打 zip」。11-05 23:45 接手，第一件事清这笔账。

### 一、接手时的真实状态

| 项 | 值 |
|---|---|
| git | HEAD `ef3fac6`（docs: 全量口径 50/690），工作区干净 |
| 源码 / dist | 已同步：`app.mjs` 254,041 B、`app.html` 275,430 B；启动器 exe 57,856 B（11-04 23:34 重编） |
| 应用 | 在跑：`node app.mjs` pid 15316 / 8099；qwen3-5-4B，上下文 64K；用户 23:23–23:39 在用（传了个 docx 建 RAG、TTS 一次） |
| 交付 zip | **11-01 21:52 的旧包**：app.mjs 还是 247,886 B（缺 P4 与显卡两轮） |
| 日志异常 | `app.log` 11-04 23:41:11 `vk::Device::getFenceStatus: ErrorDeviceLost` → 上下文损坏 → 进程退出码 42 → 启动器自动重启 1 次（`launcher.log` 23:41:22）。属已知限制「Vulkan 上一次 >2 万 token 预填充会 device lost」，不是新回归 |

### 二、做了什么

1. **备份**：`workspace`（3 个会话 + 快照 + RAG + 文件，342 个文件）→ `server\docs\session-backups\2026-11-05_2352\workspace-full`；旧 zip 改名 `dist\QingYaoTP-AILauncher-v1.1.0.zip.old-1101` 留证（不删）。
2. **停应用 → 重打包**：`--stop` + 按命令行精确杀本项目进程（没用 `Stop-Process -Name` 一刀切）→ `build-portable.ps1`：8 步全过，**258.2 MB / 3443 文件**，启动器重编 57,856 B、DebugTool 42,496 B，config 模板带 `vkDevices=`。
3. **补上「打 zip」这个缺环**：新增 `server\make-zip.ps1`（BOM + 5.1 Parser 0 错误）。在此之前「zip 由谁打」没有脚本，靠手搓——这正是 11-01、11-04 两次出现「dist 已更新、交付物还是旧的」的根因。脚本里写死四条规则：
   - 只打载荷：`data\` / `logs\` 只留空目录（WebView2 缓存、运行日志不进包）；
   - `models\` 留空目录（用户把 gguf 放这里，modelDir 留空即可用）；
   - 根目录固定 `QingYaoTP AILauncher-v1.1.0/`，**所有条目用正斜杠且带这个前缀**；
   - **对暂存副本的 `config.ini` 消毒**：`modelDir` / `autoLoad` / `vkDevices` 清空（dist 运行目录里的本机配置保持原样，不进交付包）。
4. **踩到的三个坑**（都在 make-zip.ps1 里修掉了）：
   - .NET Framework 的 `ZipFile.CreateFromDirectory` 会**用反斜杠**、并把源目录名当根（第一次打出来是 `qytp-zip-<guid>\QingYaoTP AILauncher-v1.1.0\…`，多套一层 TEMP 目录名）；
   - 只加了根目录项、文件条目忘了加前缀 → 解压出来是一堆散文件（第二次）；
   - dist 里 `config.ini` 已被本机改成 `modelDir=D:\LocalModels`，直接打进去就把绝对路径泄露给交付方（第三次）→ 改成打之前对暂存副本消毒。
   - 另：`.ps1` 每次用编辑工具改完都会丢 BOM，必须用字节方式补回 `EF BB BF` 再用 5.1 Parser 复验（本轮又踩一次，改完直接跑会中文乱码 → 语法错误）。
5. **产物**：`dist\QingYaoTP-AILauncher-v1.1.0.zip` = **121.8 MB / 3944 条目**，SHA256 `9A3D8E5A2C993E3B4A3DA28D5C56ABF1C758BBE04DFC7A64EBC59EA53397054B`；旧包 122.0 MB / 3947 条目，差异 = 去掉 `models\workspace` 泄漏（3 条）+ 目录项规范化。包内 `config.ini` 的 `modelDir=` 为空、无任何本机绝对路径。
6. **验证**（见三）后，把本机运行目录的 `config.ini` 恢复成 `modelDir=D:\LocalModels` 并重启启动器——否则界面看不到本机 5 个模型；**zip 保持便携形态**，两者分工明确。

### 三、验证

| 层 | 结果 |
|---|---|
| 构建自检 | 8 步全过、退出 0；启动器 57,856 B / DebugTool 42,496 B 时间戳 = 本次构建；4 份源码 SHA256 与 `server\` 一致 |
| HTTP 7 项 | `/health` 200、`/api/state` 200（5 个模型、vulkan、version 1.1.0）、`/debug` 200、`/debug-icon.png` 200、`/debug-icon.ico` 200、无令牌 `POST /api/debug/open` **403**、`/api/gpus` 200（1 块 Intel Arc） |
| 包内 CLI | `localai-debug.cmd --json` exit 0；`localai.cmd models` exit 0（5 个模型） |
| 目标探针组 | **probe-debug 35/35**（首跑 33/35，2 红是「未加载模型」时的 KV 断言，装 qwen2.5-0.5b 复跑全绿后 unload 复原）、**probe-rag 16/16**、**probe-gpu 14/14**、**probe-firstrun 22/22**、**probe-ui-gpu 8/8**；合计 6 次运行 / **95 断言**，0 崩溃、服务 pid 全程未变 |
| 独立复核 | verifier 按 technique/05 的 12 项逐项验 dist 与最终 zip（解压冒烟 + 哈希 + 条目/前缀/卫生），结论见 `server\docs\packaging-2026-11-05\verify.md` |
| 口径提醒 | 交接文档里的「probe-debug 25 条」是旧数，**现在是 35 条**（11-01 扩过）；`probe-firstrun` 在新首启形态下 `firstRunDone=false` 属正常 |

### 四、留给下一轮

- **`使用说明.txt` 里还有一句 v1.0 旧文案**：「默认指向 D:\LocalModels」——与便携默认（`modelDir` 留空 = `<安装目录>\models`）矛盾。这句在 `build-portable.ps1` 的 readme 模板里，改它要连带重打包，所以本轮只记不改。
- **老笔记本真机验证**（仍未做）：设置 → 显卡 看有没有 RX640；有就选它、重启、`app.log` 应出现「只可见 1」；没有就升 AMD 驱动（22.6.1 / 30.0.15021.11005）。
- **7B 分片下载 + 校验**：下载器还只吃单文件，large 档推不了 7B。
- `probe-start-flow` 的偶发 `ECONNRESET`（11-04 遗留）本轮没撞到；再撞再按「探针 fetch 加 Connection: close」处理。

### 五、补记（2026-11-06 00:01，第三版才定稿）

上面第二节记的是第二版数字（3944 条目 / sha 9A3D8E5A…）。定稿前又发现一处泄漏：dist 里正在跑的服务写了 app\server.pid（5 字节，内容是本机 pid）被打进 zip。到目标机首启时，启动器的单实例 / --stop 判断可能被这个陈旧 pid 误导，属于必须排除的运行期文件。make-zip.ps1 增加一条：暂存副本 app\ 下的 .pid / .log / .tmp 一律删除再压缩。

最终产物（以此为准）：dist\QingYaoTP-AILauncher-v1.1.0.zip，127,758,927 B（121.8MB）/ 3943 条目，mtime 2026-11-06 00:01:27，SHA256 7F49A8DC322B741FE31F979DF5466CE8C2D2A29A1CD789B98FF147A043AA1A4E。核对：包内 app.mjs 254,041 B、启动器 57,856 B、无 .pid/.log/.tmp、无 data/logs 文件、config.ini 的 modelDir= 为空。

教训重复了一次：打 zip 的每一步都要对着交付方的机器想一遍——绝对路径、陈旧 pid、运行期缓存，任何一样带出去都可能在目标机变成怪问题。

---

## 四十三、2026-11-07：代码工作区 + 模型审查（v1.2.0）——「Agent 输出的代码得有地方落」

用户原话：「在 Agent 模式下输出的所有代码都要转到代码模块输出，并以代码工作区的形式（类似 VS Code）输出。旁边加上代码补全的模型调用按钮，按下后可以开始结合用户意图审查代码是否合理。」

### 一、先看清楚家底再动手

现有的「代码」只是 `#codeModal` 里的一个 textarea 运行器（跑七种语言，10s 超时）；但底子其实齐：CodeMirror 已经随包（文件面板在用）、`/api/workspace/*` 有一整套越界校验后的读写、`generateTitleWithModel()` 示范了「单开小上下文、不碰主会话 KV」。所以这不是从零造，是补三件事：**Agent 自动收录 → 工作区 UI → 模型审查接口**。

### 二、契约先行，三线并行

先写了 `server\docs\feature-code-workspace-2026-11-07\CONTRACT.md`（API 形状、DOM id、prompt 逐字、错误码、探针要求），再让三路同时开工：backend 改 `app.mjs`、frontend 改 `app.html`、code-prober 写探针。三个人改三个文件、互不冲突，约 2 小时交出可用版。**这次证明「先定死接口与 DOM」比「一个人串行写」快，而且探针可以在实现完成前就写完。**

### 三、实现摘要

| 层 | 内容 |
|---|---|
| 接口 | `POST /api/code/capture`（1–20 段，basename 清洗/禁 `..`/保留中文/空名→snippet.txt/无扩展名→.txt/重名 `-2` 不覆盖，单文件 >20 万或合计 >40 万→413）；`POST /api/code/review`（独立小上下文，8192→4096→2048 回退，返回 `review/seconds/contextSize`；空 code 400、>2 万字符 413、无模型/忙 409） |
| 界面 | 顶栏「代码」→ VS Code 式工作区：左侧文件列表、标签页（dirty ●、×）、CodeMirror 行号+高亮、保存/删除/运行、底部输出、右侧审查面板（意图输入 + Markdown 渲染，标题显示模型与耗时） |
| Agent 收录 | `send()` 收尾提取围栏块 → 一次 capture → 大气泡后「已收录 N 段代码」+「打开」；每个代码块头加「工作区」按钮；设置 → 生成 有总开关（`localai.codeCapture`，默认开） |
| 存储 | 文件在 `workspace\code\`，复用既有 `/api/workspace/*`，**不新增文件 CRUD** |

### 四、关键取舍

1. **审查用独立小上下文，不碰主会话**：照 `generateTitleWithModel()` 单开 context、用完 dispose。代价是每次审查要重建 8192 上下文（约 0.2GB），换来主对话的 KV 缓存不报废（首字 ~1s 是这个项目最值钱的指标）。
2. **审查整段非流式**：先能用。4B 审查 13 行代码 75.8s（API）/ 86.5s（UI），900 token 上限。流式留给下一轮。
3. **Agent 收录是「附加」不是「替代」**：聊天里代码块照常显示（复制/运行都在），只是多一条收录提示 + 工作区入口。理由：把代码从聊天里抽走会让人在长回答里失去上下文。
4. **重名不覆盖**：`open(...,'wx')` 原子写 + `-2/-3` 退避，避免两次收录把上一次的代码顶掉。

### 五、踩到的坑（都写进探针或脚本了）

1. **CSS 顺序**：`.cwBox` 写在 `.modalBox` 前面，被后面的 `width:min(720px,92vw)` 压住，第一版打开只有 720px 宽、编辑器被挤成 230px。改成 `.modalBox.cwBox`（双类提权）。
2. **真机 E2E 误判**：第一版 E2E 脚本把 `/api/workspace/list` 当数组（实际是 `{dir,parent,entries}`），文件其实收录成功却报 FAIL。改脚本后 PASS——**自测脚本自己也会骗人，得用落盘文件二次确认**。
3. **全量驱动的 BOM 又被剥了**：`run-full.ps1` 里全是中文，BOM 丢失后 5.1 按 ANSI 解析 → 整段乱码 + 语法崩，第一次全量直接没跑起来。补 BOM + Parser 复验（0 错误）后才跑。
4. **源码模式跑全量暴露两个探针的「发布包假设」**：
   - `probe-plugins` 按 `HERE\plugins` 推插件目录，源码模式实际是 `<MODEL_DIR>\plugins` → 临时插件写错地方，5 条红。真 bug，改为读 `GET /api/plugins` 返回的 `dir`（权威），复跑 11/11。**探针不能猜目录，要问服务端。**
   - `probe-ui-gpu` 断言「保存设备 0 后 config=0」，但开发目录没有 config.ini、服务端按设计不写盘 → 改走「未写盘并给出说明」分支，7/7。
5. **测试污染用户数据**：E2E 聊天会在服务端建会话、探针会清会话。跑前把 `workspace\sessions` 备份到 docs、跑完恢复（3 个真实会话完好，30/8/11 条）；代码文件与测试会话全部清掉。

### 六、验证

- `probe-code-workspace` 22/22（无模型）/ 21/21 + 跳过 1（有模型）；`probe-code-panel` 18/18 / 17/17 + 跳过 1。
- E2E（真模型 4B，Agent 模式）：22s 生成 → 自动收录 1 段 → `code/python-110450-1.py` 落盘（随后 UI 打开，编辑器 272 字符），PASS。
- 模型审查：API 75.8s / 1193 字（源码模式）；UI 按钮 86.5s / 1210 字；发布包上复测 72.0s / 1547 字（原始响应 `logs/review-api-raw.json`）；四节结构完整，明确回应「大数 / 尽量快」的意图。
- 全量回归（源码模式）：**51 条 / 718 断言全绿**（45 首跑 + **4 份复跑**（含 ui-gpu 开发模式分支修正）+ 3 条新探针；2 条条件跳过），0 崩溃/0 重启。
- 打包：v1.2.0，258.2MB / 3443 文件；交付 zip 121.8MB / 3943 条目 / SHA256 `7E6DC404…`；顺手修掉 `使用说明.txt` 的 v1.0 旧文案。

### 七、留给下一轮

- 审查改**流式 SSE**（现在 4B 要等 75–90s）；整工作区/多文件一起审查；结论可回填聊天或另存 `.review.md`。
- 长代码按 token 预算切片（2 万字符上限 vs 8192 上下文）。
- 历史消息重渲染后「工作区」按钮会走单块补收录，可能产生 `xxx-2` 副本（不影响功能，但可以按内容哈希去重）。

### 八、教训

这次功能动了 `send()` 的收尾路径（收录钩子），最值钱的回归是 `probe-chat-plain`（11/11）和一圈 `probe-ui-*`——它们全绿说明「加钩子没有把对话弄坏」。**凡是往聊天主链路里塞东西，先把这几条探针列进必跑清单。**

---

## 四十四、2026-11-07 晚：图片入口（视觉 sidecar，v1.3.0）——「让本地模型看见图」

用户要「加图片入口 + 找视觉模型」。查清楚后的结论：**能加，但不能在现有 JS 层加**。

### 一、关键判断：底层有，不等于上层能用

随包的原生库里明确有 `mtmd/mmproj/qwen2vl/qwen3vl/minicpmv/gemma3/gemma4` 符号（llama.cpp 的视觉管线），
但 **node-llama-cpp 3.22.1 没有视觉 API**；我把 npm 上最新 3.22.3 的类型定义整个搜了一遍，`mmproj/image/vision` 零命中。
所以方案定为**独立进程 sidecar**：随包带官方 `llama-server.exe`（llama.cpp b12144 / v0.9.0-dev Vulkan 构建，101 MB），按需启动、主服务转发。

### 二、实现

| 层 | 内容 |
|---|---|
| 打包 | `tools\llama.cpp` → `app\llama\`（+101 MB）；config 模板加 `visionModel`/`visionMmproj`；使用说明加「九、看图」 |
| 后端 | `GET /api/vision/state`、`POST /api/vision/start|stop`、`/v1/chat/completions` 带图转发（SSE 透传、补 `enable_thinking=false`）、`/api/load` 前停 sidecar、mmproj 不进模型列表、退出杀进程树 |
| 前端 | 🖼 按钮/粘贴/拖拽、缩略图条、≤1024px JPEG、最多 3 张、气泡缩略图、「视觉」徽标、设置→视觉页签、首屏也可发图 |
| 探针 | `probe-vision-api`(25)、`probe-ui-vision`(19)；全量驱动 51 → 53 |

### 三、踩到的坑（每个都改了代码）

1. **Qwen3.5 的 thinking 会把回答吞光**：不带 `chat_template_kwargs.enable_thinking=false` 时，200 个 token 全在思维链里，`content` 为空。后端转发时强制补上。
2. **Vulkan 图像编码在这台核显上会 device lost**：`ggml_vulkan: device lost on Vulkan0` → `mtmd_batch_encode ErrorDeviceLost` → sidecar 退出 `0xC0000005`。我原以为是并发导致，查 app.log 才发现**单条请求也崩**（每次请求成功返回后进程就死）。改成 **CPU 后端 `-ngl 0`** 后彻底稳定；GPU 只留 `VISION_NGL=99` 开关供以后对比。
3. **并发必须串行**：即使 CPU 后端，两个视觉请求同时进 sidecar 也会互相踩；加了 FIFO 队列（同刻一个、排队上限 180s、超时 503），并且排队期间 `/api/load` 返回 409。
4. **崩溃要能自愈**：转发前查进程+/health，已退出自动重启；失败最多重启重试 1 次，仍失败 502 且带 `vision.log` 路径。自测里外部 taskkill 后下一条请求 200（17.8s）。
5. **前端 4MB 上限挡掉了手机照片**：11MB 的 4000×3000 照片旧实现直接拒。改成原图上限 20MB + 单次解码 + 自适应 JPEG 质量（超 700KB 逐级降到 0.52，再不行降到 768px），3 张 dataURL 约 2.1MB，不撑爆后端 4MB 请求体。
6. **全量回归被环境漂移坑了一次**：21:54 前后应用重启（无模型），导致 probe-debug / probe-func / probe-start-flow / probe-status 一片红——不是回归，是无模型。受影响的 8 条探针在恢复模型后逐条复跑全绿。

### 四、验证

- 发布包（CPU 后端）：start **9.8s**；串行 3 条 **13.1 / 2.6 / 2.6s**（后两条 KV 复用，内容均 `QWEN 42 hello`）；并发 2 条都 200；**sidecar pid 不变、device lost 0 次**；stop 后 8101 释放。
- 后端自测（8102 + CPU sidecar）：串行 3/3、并发 2/2、kill 后自愈、stop；**28/28 PASS**。
- 探针：probe-vision-api **25/25**、probe-ui-vision **19/19**；受影响复跑：probe-version 14/14、probe-debug 35/35、probe-func 9/9、probe-start-flow 8/8、probe-status 6/6、probe-code-panel 17/17+跳过 1。
- 界面 E2E：注入真图 → 发送 → 气泡缩略图 + 视觉徽标 + 正确回答。

### 五、打包

- v1.3.0：**359.4 MB / 3496 文件**（app\ 245.4 MB，其中 app\llama 101.1 MB）；交付 zip **158.5 MB / 3997 条目 / sha256 `103D6777…`**。
- 22:01 的第一版包落后于源码（加了队列/CPU/自愈），22:08 重打；verifier 认的是第一版（判 🔴），重打后由 Lead 复验哈希与视觉，verify.md 追加了 §10 说明。

### 六、留给下一轮

- sidecar 闲置自动退出（现在要手动停/加载文本模型时才停）；首张图 10–35s，考虑预热或缩图策略。
- GPU 视觉（`VISION_NGL=99`）在别的机器上可以试；这台核显暂时只能 CPU。
- 4MB 请求体上限（长历史 + 3 图可能 413）；HEIC；多 mmproj 组合；「视觉增强包」拆分分发（主包不带 101MB）。

### 七、教训

**「底层库有符号」不等于「上层 API 能用」**——先查绑定层，再决定架构。另外，核显上的 Vulkan 图像编码不可靠，默认 CPU 是理性选择：慢一点，但不会每次请求后进程暴毙。

### 八、收尾（2026-11-08 交接）

- **交付**：v1.3.0 发布包 **359.4MB / 3496 文件**；交付 zip **158.5MB / 3997 条目 / sha256 `103D6777…`**；git `2701b19`；应用交接时在跑（8099，v1.3.0，Qwen3.5-9B 已加载），视觉 sidecar 已停。
- **不入库的东西**：模型 `*.gguf`、`mmproj\`、`tools\llama.cpp`（101MB sidecar）、`dist\`。新机器重装视觉：`winget download --id ggml.llamacpp`（b12144）解压到 `tools\llama.cpp`；mmproj 从 ModelScope `unsloth/Qwen3.5-9B-GGUF` 下 `mmproj-F16.gguf`。
- **全量回归状态**：驱动已扩到 53 条，但本轮整跑因应用中途重启（无模型）作废——`probe-debug` / `probe-func` / `probe-start-flow` / `probe-status` / `probe-code-panel` 的红是环境连锁；受影响 8 条已逐条复跑全绿（vision-api 25/25、ui-vision 19/19、version 14/14、debug 35/35、func 9/9、start-flow 8/8、status 6/6、code-panel 17/17+跳过 1）。**下一轮第一件事：跑一次干净的 53 条全量。**
- **下一轮建议顺序**：① 干净全量 53；② 视觉闲置自动退出 + 「视觉增强包」拆分（主包回 122MB）；③ 老笔记本 1.5B / 7B 分片下载；④ 需要更强 OCR 再加 Qwen2.5-VL-7B（5.15GB）。
- **已知遗留**：sidecar 不自动闲置退出；CPU 首图 10–35s、生成 ~2.6 tok/s（GPU `VISION_NGL=99` 在这台核显会 device lost）；4MB 请求体上限；HEIC 不支持；只实测 Qwen3.5-9B 一组。

---

## 四十五、2026-11-08：干净 53 条全量（两轮）—— 驱动传参缺陷 + 时间戳定性

11-07 交接留下的唯一一笔账是「干净的 53 条全量还没跑」。这一轮补齐了，而且**跑了两轮**：r1 把驱动/探针里潜伏的两个假红全暴露出来，r2 用修正后的驱动拿到 53 条干净结果。**v1.3.0 无功能回归。**

### 一、怎么组织的（Lead + 三个队友）

| 角色 | 干什么 |
|---|---|
| Lead | 预检：备份 workspace（441 文件 / 8 个真实会话 → `session-backups\2026-11-08_17-52-52\workspace-full`）、记 `baseline.json`（9 个文件 SHA256 + 会话逐个哈希）、停 dist 启动器与服务、腾空 8099/9333；收口恢复 |
| probe-runner | 起服务 + headless Edge、跑驱动、单条复跑、DOM/存档取证（task-1/4/5） |
| env-verifier | 独立验收：不跑探针，只查完整性 / 哈希 / 自洽 / 假绿（task-2） |
| result-analyst | 两轮逐条表 + 红项归因 + 断言口径（task-3） |

环境：**源码模式** `node app.mjs`（工作区 `D:\LocalModels\workspace`）、headless Edge 9333、驱动预加载 qwen2.5-7b 16K。
⚠️ 新发现：PATH 上的 `node` 是 DSH 垫片（`…\harness\.desktop-bin\node.cmd`），服务进程在任务管理器里显示成 `DSH Desktop.exe … app.mjs` —— **杀进程只能按 PID / 命令行精确匹配，按进程名一刀切会误杀 DSH 本体**。

### 二、结果

| 轮 | 探针 | 断言 | 结果 | 墙钟 | 服务重启 | device lost |
|---|---|---|---|---|---|---|
| r1 | 53 | 745 | **51 绿 / 2 红 / 0 超时** | 781s | 0 | 0 |
| r2（权威） | 53 | **762** | **52 绿 / 1 红 / 0 超时** | 778s | 0 | 0 |

口径：**762 = 718（11-07 的 51 条）+ 44**（`probe-ui-vision` 19 + `probe-vision-api` 25）。r1 的 745 = 762 − 17（`probe-code-panel` 一条断言都没跑到）。

### 三、三条红项（都不是 v1.3.0 功能回归）

1. **`probe-code-panel`（r1，exit 2，0 断言）＝ 驱动传参缺陷**。探针在 `6544f3f`（11-07）把签名改成 `[base] [cdp]`，而 11-02 版驱动仍只传 `@($cdp)` → `BASE` 变成 9333、`PORT=9333`，去找 `127.0.0.1:9333` 的页面 → 必 `no page`。**不是瞬时**：单跑同样 exit 2。
   修法：**另存本轮驱动副本** `probe-full-2026-11-08\run-full.ps1`，只改第 135 行 `a=@($base,$cdp)`（+行尾注释）。BOM `EF BB BF` 完好、PS 5.1 Parser 0 错误、与 11-02 版 diff 只有这一行（195→195 行）；**11-02 历史文件未动**。r2 整跑 `17/17（跳过 1）`，闭合。
2. **`probe-ui-gpu`（r1，6/7）＝ Edge 扩展噪声**。第 7 条「没有未捕获的 JS 错误」抓到 2 次 `Could not establish connection. Receiving end does not exist.`；`app.html` 全文无 `chrome.runtime`（grep=0），是 headless profile 里预置扩展的隔离世界异常。单跑复跑 **7/7**、r2 整跑 **7/7**。
3. **`probe-timestamps`（r2，3/4）＝ 跨轮残留夹具 + 探针依赖 `#recentOpen`**。r1 的 `probe-ui-sessions`（#43，18:02）`wipe()` 后用「旧版 localStorage 迁移」fixture 造了会话，两条消息只有 `{role,content}`、**没有 `t`**；r2 的 `probe-timestamps`（#28）点 `#recentOpen` 打开的正是它 → `rows=2 / times=1`。三连跑 **3/3 确定性复现**，**不是 flaky**；现有序列下**每轮必红**（#28 在 #43 之前）。

### 四、顺带确认的两处产品侧不一致（低严重度，本轮没改）

- **P1 缺 `t` 时两条渲染路径不一致**：用户行走 `bubble()` 的 `ts ?? Date.now()`（`app.html:5546`）→ 显示**运行时刻的假时间**；助手行走 `makeMsgTime(entry.t)`（`3373-3374`）无兜底 → 不显示。上游是「localStorage → 服务端」迁移不补 `t`。
- **P2 live 第二意见行没有时间戳**：`oneSecondOpinion()`（`6824`）只装朗读按钮与指标（`6947-6950`），没有 `makeMsgTime`；刷新后 `renderStoredAssistant`（`3374`）又有 → 「live 无时间、刷新后有」。本轮探针没走到这条分支。

### 五、下一轮动作（按性价比）

1. **探针侧最稳**（~10min）：`probe-timestamps` 只对「存档里有 `t` 的行」计数——缺 `t` 是合法旧数据形态，不该判红。
2. **更根治**（~5min）：`probe-ui-sessions.mjs:72-75` 给两条迁移 fixture 补 `t`。
3. **产品侧**（一行级，可选）：缺 `t` 统一兜底（用户行别显示假时间）/ 迁移补 `t`；顺手补 live 二意见行的 `msgTime`。
4. **驱动上游化**：把 `probe-full-2026-11-08\run-full.ps1` 的第 135 行修正作为下一轮基准（11-02 留作历史）。
5. **界面探针**：过滤隔离世界 / 扩展异常（或换干净 profile），别让 `probe-ui-gpu` 这类断言吃浏览器噪声。

### 六、收口

- 恢复：`workspace` 从 `session-backups\2026-11-08_17-52-52\workspace-full` 镜像恢复（441 文件），**8 个真实会话 SHA256 逐个 MATCH**；发布包重启（v1.3.0，Qwen3.5-9B 已加载，8099）。
- **产品代码零改动**：`server\app.mjs` / `app.html` / `probe-*.mjs` / `dist\` 全部未动（9/9 哈希 MATCH，`git diff` 空）。
- 证据：`RESULT.md`（两轮 53 条逐条表）、`verify\verify.md`（独立验收：0 重启、0 假绿）、`analysis\flaky-baseline.md`（18 项判红手册）、`-r2\logs\rerun-4-findings.md`（timestamps 取证）。

### 七、教训

- **探针参数是契约**：探针改签名必须同步驱动，否则整跑会「静默少跑一条」——0 断言也算 FAIL，但看 summary 很容易当成环境问题。
- **探针不能依赖上一轮的残留**：本轮 #28 吃了 #43 的夹具，跨轮传染，而且越查越像产品 bug。
- `summary.txt` 是 **UTF-8 BOM 头 + UTF-16LE 追加段**的混合编码，统计必须双解码；证据产物一律 UTF-8（无 BOM）落盘。


---

## 四十六、2026-11-08 20:30：按要求删除两个 Qwen2.5 本地模型（释放 4.82GB）

用户要求「把所有 Qwen2.5 删了」。先盘点再动手：

| 文件 | 体积 | 原用途 |
|---|---|---|
| `qwen2.5-7b-instruct-1m-q4_k_m.gguf` | 4466MB（4.36GB） | 交接文档里的「默认/主力」，也是全量驱动的预加载目标 |
| `qwen2.5-0.5b-instruct-q4_k_m.gguf` | 469MB | 首启兜底小模型 |

- 无硬链接副本（`dist\QingYaoTP AILauncher\models` 是空的）、无下载在途、当前加载的是 `Qwen3.5-9B`（**不受影响**）。
- `llama-qwen2vl-cli.exe`（`tools\llama.cpp\` 与 `dist\...\app\llama\`）是 llama.cpp 的**程序文件**，不是模型，**未动**。
- 其它常见位置（Downloads / Desktop / Documents / `D:\Models` / `D:\AI`）没有别的 Qwen2.5 gguf。

用户确认「彻底删除两个」后执行：删前逐个核对**绝对路径 + 普通文件 + 无 LinkType/Target**，再 `Remove-Item -LiteralPath`（不用通配符）。结果：**释放 4.82GB**（D 盘剩 288.9GB），模型目录从 7 个变 5 个。

### 连带处理

| 落点 | 改动 |
|---|---|
| `server\docs\probe-full-2026-11-08\run-full.ps1` | 预加载 `$M` 从 `qwen2.5-7b…` 改为 **`Qwen3.5-9B-Q4_K_M.gguf`**（BOM 保持 `EF BB BF`、PS 5.1 Parser 0 错误）。⚠️ `probe-tools-agent` / `probe-web-tools` 依赖模型愿按 `<tool_call>` 协议输出，换模型后**下一轮需复验这两条** |
| `server\run-server.cmd` | 开发脚本的 `AUTO_LOAD` 同样改指 `Qwen3.5-9B-Q4_K_M.gguf`（原来指向已删文件） |
| `交接文档.md` | 模型清单 7 个 → 5 个，并注明两个 Qwen2.5 已删、下载档位仍保留 |
| `technique\04-模型与后端.md` | 「当前这台机器上有什么」表格改成现有 5 个（补 `gpt-oss-20b`、`Qwen3.5-9B`），加删除说明 |

**没动的**：`app.mjs` / `config-recommend.mjs` 的下载目录与推荐逻辑（界面里仍可下载 Qwen2.5-0.5B / 1.5B，要再下随时可下）；历史证据目录（`packaging-*` / `probe-full-*`）里的旧记录；本日志之前的所有条目。

### 验证

- `/api/state`：models = **5**（DeepSeek-R1 / gpt-oss-20b / Phi-4-mini / qwen3-5-4B / Qwen3.5-9B），loaded 仍是 `Qwen3.5-9B`。
- `probe-firstrun` **22/22**：推荐逻辑在本机模型变少后仍自洽——live `/api/sysinfo` 的 large 档已从 `qwen2.5-7b` 自动改成 `qwen3-5-4B`（推荐顺序里 qwen2.5 名字命中不到就往下走）。
- 教训照旧：**删模型前先确认没有硬链接副本**（本机刚好没有），否则删了链接源文件会连带失效。


---

## 四十七、2026-11-08 20:40：全量驱动预加载改用 4B（9B 太重）+ 4B 工具能力实测

用户看到驱动改用 9B 后问「9B 是不是太大了」，并担心 4B 也被删了。先澄清：**4B 完好**——`qwen3-5-4B-Q4_K_M.gguf` 2.52GB / SHA256 `DE8E96CD0D0C3584…`；本轮只删了两个 `qwen2.5-*`。

### 决定

- **驱动预加载用 4B**（2.52GB），不用 9B（5.29GB）：全量整跑要反复装卸模型，还要跑工具/联网探针，轻的更快也更稳。
- 9B 仍是 **app 日常主力**（测完已装回），`run-server.cmd` 的 `AUTO_LOAD` 也保持 9B。

### 4B 实测（Vulkan、16K）

| 探针 | 结果 | 关键点 |
|---|---|---|
| `probe-tools-agent` | **24/24** | 加载 6.2s；时间 / 计算 / 模型清单 / 读文件四类工具都真调，关工具就不调，流式 tool 事件先于正文 |
| `probe-web-tools` | **19/19** | 百度搜索 8 条、`fetch_url` 200/171 字符、SSRF 拦截本机地址、关联网后工具不注册 |

结论：删掉 qwen2.5-7B 后「模型愿不愿按 `<tool_call>` 协议输出」这层**不是问题**，下轮全量不用担心这两条变红。4B 处理工具链明显比 7B/9B 快（同一台机器 Vulkan）。

### 落点

- `server\docs\probe-full-2026-11-08\run-full.ps1`：`$M` = `qwen3-5-4B-Q4_K_M.gguf`（BOM 保持 `EF BB BF`、PS 5.1 Parser 0 错误）。
- `technique\04-模型与后端.md`：同步这条口径与实测数字。
- 未动：`run-server.cmd`（开发启动默认 9B）、`app.mjs` 下载目录（Qwen2.5 档位仍可下）。


---

## 四十八、2026-11-08 21:00：视觉功能修复（大图必 500 / 32K / 闲置退出 / Σ 图标）

用户要求「把图片功能修一修，上下文设到 32K（如果可行），图形按钮改成 LaTeX 那个大写 Σ」。

### 一、修掉的三个真问题

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| 1 | **大图必 500**（用户说的「发图报错」） | `-ngl 0` **只管文本层**，mmproj 的图像编码默认仍走 Vulkan。1440×900 截图 ≈1036 image token 时 `ggml_vulkan: device lost` → `mtmd_batch_encode` 失败 → `failed to process mtmd chunk` → HTTP 500。320×180 小图能糊过去，所以此前的小图探针一直绿、没暴露 | sidecar 参数加 **`-mmdev none`**（强制图像编码走 CPU）；`VISION_MMPROJ_DEVICE=vulkan0` 可改回 GPU 对比 |
| 2 | 上下文 8K 不够 | `VISION_CONTEXT` 写死 8192 | 默认 **32768**，可配 `visionContext`（2048–131072） |
| 3 | 闲置不退出（内存不还） | 设计上要手动停 | **闲置 300s 自动退出**（`visionIdleSec`，0 = 不停）；到点若还有请求在跑就顺延 |

### 二、性能实测（Qwen3.5-9B + 1440×900 截图，CPU 编码）

| 配置 | 预填充 | 结论 |
|---|---|---|
| 线程默认（程序自选 16） | 41s / 1036 token = **25.2 tok/s** | 保留默认 |
| 强行 `-t 20` | 55.7s = 18.7 tok/s | **慢 35%** → 不传 `-t`，交给 llama.cpp |
| 端到端（app 转发，32K，`-mmdev none`） | **200 / 56.5s，答案「中午好」正确** | 原来必 500 |

32K 内存代价：sidecar RSS 7.7–8.0GB、启动 5–9s（这台 31.4GB 机器可行；和 8K 相比启动/耗时几乎不变）。

### 三、界面

- 图片按钮 **🖼 → Σ**：`KaTeX_Main` / `Cambria Math` 直立衬线、青色 23px，就是 LaTeX 排版里的大写 Σ（输入区 + 开场白两处）。截图确认过不是豆腐块。
- 设置 → 视觉新增：**发图质量**（768 快 / 1024 标准 / 1280 精细，localStorage `localai.visionEdge`）、**视觉模式参数**（上下文 / 图像编码设备 / 闲置退出，来自 `/api/vision/state` 的新字段）。
- 等待有秒数了：启动「正在启动视觉模型… Ns」、识图「视觉识图中…（CPU 编码，通常 20–50s）Ns」——CPU 40–60s 的等待不再像卡死。

### 四、验证

- `probe-vision-api` **25/25**（start 9.4s、小图 8.4s、stop 释放 8101）
- `probe-ui-vision` **19/19**（#imgBtn 仍在、预览/删除/设置页/自复位）
- `probe-ui-new` **30/30**、`probe-start-screen` **12/12**、`probe-hero-modes` **11/11**（首次 9/11 是视觉测试卸了文本模型，装回 9B 后全绿）
- 闲置退出实测：临时 `visionIdleSec=8` → 启动 + 请求后等 14s，`running=false`、8101 无监听；测完还原 300。

### 五、落点

`server\app.mjs`（上下文 / 闲置 / mmproj 设备 / state 字段）、`server\app.html`（Σ、发图质量、参数显示、等待计时）、`server\build-portable.ps1`（config 模板 + 使用说明模板，BOM 保持、PS5.1 Parser 0 错误）、`dist\QingYaoTP AILauncher\config.ini`（`visionContext=32768` / `visionIdleSec=300` / `visionThreads=`）、`dist\...\使用说明.txt`、`technique\02-接口.md`、`交接文档.md`、`新会话启动词.md`。

**没做的**：没升版本号（仍 v1.3.0，下次发布再 bump）、没重打 zip（下次打包生效）；`app.mjs`/`app.html` 已同步 dist 并重启验过。


---

## 四十九、2026-11-08 21:30：四个 bug 收口（时间戳 / 看完图自动装回 / 驱动固定入口 / 探针夹具）

用户「把 bug 修一修」，从候选里选了 4 项。

### 一、时间戳三条路径统一

| 问题 | 修法 |
|---|---|
| 缺 `t` 时**用户行显示「运行时刻」假时间** | `bubble()` 去掉 `ts ?? Date.now()` 兜底：没有就是没有 |
| 缺 `t` 时助手行完全不显示 | localStorage 迁移时给老消息**补 `t`**（迁移时刻）；用户行/存档共用同一个 `userT` |
| live 生成的**第二意见行没有时间戳**（刷新后才有） | `oneSecondOpinion()` 补 `makeMsgTime(Date.now())`（刷新重建路径 `renderStoredAssistant` 本来就有） |

探针同修：`probe-ui-sessions` 新增「迁移时给老消息补了时间戳」断言（27 → **28**）；`probe-timestamps` 改成**自建带 `t` 的夹具会话**再点 `#recentOpen`，不再依赖前序探针留下的「迁移夹具」（否则每轮必红），失败时还会打印会话里每条消息有没有 `t` 做诊断。

### 二、看完图自动装回文本模型

- 视觉 start 前记下被卸载的 `{file, context}`；**最后一帧图结束后 15s**（`visionAutoRestoreSec`）自动装回；期间再来图就顺延（重新计时），用户手动加载模型则取消。
- 实测：跑完 `probe-vision-api`（它自己会 stop sidecar）后 **+24s** 出现 `loaded=Qwen3.5-9B`（15s 延迟 + 9s 加载）。
- `/api/vision/state` 新增 `autoRestoreSec` / `lastTextModel`；界面提示从「已卸载，请重新加载」改成「约 N 秒后自动装回来」。

### 三、驱动固定入口（上游化）

- 新增 `server\docs\run-full.ps1`（= 11-08 修正版：BOM `EF BB BF`、PS5.1 Parser 0 错误），**以后跑全量只认这个入口**；各轮目录里的 `run-full.ps1` 降级为历史证据，11-02 原文未动。
- 文档同步：`新会话启动词.md`（探针行 / 硬约束 / 起服务命令）、`technique\06-探针与验证.md`。

### 四、验证

| 探针 | 结果 |
|---|---|
| `probe-vision-api` | **25/25**（含 start 卸载、小图 8.5s、stop 后 +24s 自动装回 9B） |
| `probe-ui-sessions` | **28/28**（新增迁移补 t 断言通过） |
| `probe-timestamps` | **4/4**（times=2 rows=2，确定性） |
| `probe-sessions` | **33/33** |
| `probe-chat-plain` | **11/11** |

会话从 `session-backups\2026-11-08_17-52-52\workspace-full` 恢复：**8 个真实会话哈希 8/8 一致**。

### 五、口径与落点

- 断言口径 **762 → 763**（`probe-ui-sessions` +1）；`交接文档` / `新会话启动词` / `technique\06` 已同步。
- 落点：`app.mjs`（自动装回 / state 字段）、`app.html`（时间戳三处 / 提示）、`probe-timestamps.mjs`、`probe-ui-sessions.mjs`、`build-portable.ps1`（config 模板加 `visionAutoRestore` 两项）、`server\docs\run-full.ps1`（新增）、三份文档。
- 没做的：版本号仍 v1.3.0；没重打 zip。


---

## 五十、2026-11-08 21:45：代码输出直出工作区（开关可切回对话）

需求：用户希望「请求写代码时，AI 的输出完全转成代码工作区的形式；附一个开关，打开=工作区、关着=对话输出；对话输出的代码一律加运行按钮」。

### 一、实现

| 层 | 内容 |
|---|---|
| 开关 | 设置 → 生成「代码写入工作区」（**默认开**）；`localStorage` 的 `localai.codeOutWs`，同时镜像进 `localai.settings.codeOutWs` |
| 工作区模式（默认） | `doSend` 收尾 `captureCodeAndCollapse()` → `POST /api/code/capture` 落 `workspace\code\` → 气泡重渲染成 `.codeWsCard`（文件名 + 打开工作区 + 展开代码）；会话条目记 `codeMode:'workspace'` + `codeFiles:[{name,path}]` |
| 刷新/切会话 | `renderStoredAssistant` 按 `entry.codeMode` 继续折叠（`renderAssistant(out, text, {hideCode:true, codeFiles})`） |
| 对话模式（开关关） | 代码块照常展开；**每个代码块一律有「运行 / 复制 / 工作区」**——运行按钮不再只给 RUNNABLE_LANGS，缺工具链时按钮仍在、点了会说明缺什么 |
| Agent 收录（旧行为） | 只在对话模式下附加「已收录 N 段」，避免和工作区模式重复计一遍 |

关键取舍：**折叠只影响渲染**。会话存档与发给模型的上下文保留完整代码，点卡片上的「展开代码」原地还原（`el.dataset.md` 存原始 Markdown）。

### 二、实测（9B、关工具，真生成）

| 场景 | 结果 |
|---|---|
| 工作区模式 | 回答 \`\`\`python print(6*7) \`\`\` → 卡片 **1** 个、对话里 `.codeWrap` **0** 个、文件 `python-213541-1.py` 落盘、条目 `codeMode=workspace` |
| 刷新后 | 卡片仍在（cards=1 / wraps=0） |
| 关掉开关 | 代码块展开（wraps=1），运行/复制/工作区三键齐全（run=1 / copy=1 / wsBtn=1） |

### 三、探针

`probe-code-run-ui` **9/9**、`probe-code-panel` **17/17（跳过 1）**、`probe-code-workspace` **21/21（跳过 1）**。探针数未变，断言口径不变。

### 四、收尾

- 测试产生的 3 个会话 + 1 个代码文件已删；真实会话仍是 8 个。
- 落点：`app.html`（`renderMarkdown`/`renderAssistant` 的 `opts`、卡片 CSS/按钮、点击分发、`doSend` 分流、设置项与持久化）、`交接文档`、`新会话启动词`、`technique\02-接口.md`。
- 版本仍 v1.3.0；未重打 zip。


---

## 五十一、2026-11-08 22:30：v1.3.1 打包（回归 49/53 首跑 + 4 条复跑全绿 + 补 package.json 清单）

### 一、这一版含什么（v1.3.0 → v1.3.1）

- 视觉：大图 500 修复（`-mmdev none`）、上下文 32K、闲置 300s 自动退出、看完图 15s 自动装回文本模型、图片按钮 Σ、发图质量档位、等待计时
- 时间戳一致化（迁移补 `t`、二意见行有时间、去掉假时间兜底）
- 代码输出默认直出工作区（开关可回对话，对话代码块一律带运行按钮）
- 全量驱动固定入口 `server\docs\run-full.ps1`

### 二、发布前回归（53 条整跑 49 绿 / 4 红，0 重启 / 0 device lost）

| 红项 | 真因 | 修法 | 复跑 |
|---|---|---|---|
| `probe-timestamps` exit 2 | 我把签名改成 `[base] [cdp]`，驱动仍只传 cdp → BASE 被当成 9333 | 探针兼容单 cdp 参数 + 驱动补 `$base` | **4/4** |
| `probe-title-ui` 12/13 | 「状态栏宽度 > 120」正好量到 120（4B 文案更短） | 阈值改 ≥ 100 | **13/13** |
| `probe-second-opinion` 起不来 | 探针写死 `qwen2.5-7b`（已删） | 按本机现有模型自适应（qwen3-5-4B + Phi-4-mini） | **11/11**（25.3s，主模型恢复后仍能答） |
| `probe-ui-gpu` 7/8 | Edge 预置扩展隔离世界抛 `Could not establish connection...`，不是页面错误 | 探针过滤该噪声 | **8/8** |

### 三、打包

- 版本 1.3.0 → **1.3.1**：`app.mjs` 的 `APP_VERSION`、`package.json`、`localai.mjs`（顺手把 CLI 里滞后的 1.1.0 对齐）、`make-zip.ps1` 的 zip 名 / 根目录名。
- **发现并修掉一个打包清单漏项**：`build-portable.ps1` 从来没复制 `package.json` → 包内 `app\package.json` 是 0 字节，在发布包上跑 `probe-version` 会「版本号对不上」。补进清单后重打，包内 9 个源码 SHA256 全 MATCH。
- 产物：**359.4MB / 3497 文件**（+1 = package.json）；交付 zip `dist\QingYaoTP-AILauncher-v1.3.1.zip` = **166,200,554 B / 158.5MB / 3998 条目 / SHA256 `FE3B69F4515C1713C32DDB095A1DDD676733CD40607B788652EE29AE5367E663`**。
- zip 校验：全部条目带 `QingYaoTP AILauncher-v1.3.1/` 前缀、无反斜杠 / `..`、无 `.pid`/`.log`/`.tmp`、无 gguf/mmproj；包内 `package.json` = 1.3.1；`config.ini` 已消毒（`modelDir=`/`autoLoad=`/`vkDevices=` 空，vision 三项保留）。
- 包冒烟：`/api/version` 1.3.1、`/health` `/debug` `/api/gpus` `/api/plugins` 全 200、无令牌 `POST /api/debug/open` **403**；包内跑 `probe-version` **14/14**（包内 package.json 对账通过）。
- 打包后本机运行目录的 `config.ini` 被重置成便携默认（`modelDir=` 空）→ 已改回 `modelDir=D:\LocalModels` 并重启：5 模型 / 1 组视觉配对 / 8 会话恢复。交付 zip 里仍是消毒版，两者不冲突。

### 四、收尾

- 真实会话从备份恢复：8/8 哈希一致；应用在跑（v1.3.1、Qwen3.5-9B 已加载）。
- 本轮**没改产品功能**（只版本号 + 打包清单 + 4 条探针），所以没有额外功能回归面。


---

## 五十二、2026-11-08 深夜：本场会话总收尾（17:48 → 23:25）

> 这一节是给「下一个会话」的总入口：把本场从头到尾做了什么、现在是什么状态、下一步接哪里，一次写清。细节在第四十五 ~ 五十一节。

### 一、这一场做了 7 个提交

| 提交 | 做了什么 | 见哪节 |
|---|---|---|
| `dc3d762` | 干净 53 条全量：r1 51 绿/2 红（驱动传参缺陷 + Edge 扩展噪声）→ 修正驱动后 r2 **52 绿/1 红、762 断言**；把 `probe-code-panel` 的驱动传参 bug 修掉；`probe-timestamps` 定性为跨轮夹具（非 flaky） | 四十五 |
| `7d0be91` | 按要求删掉两个 Qwen2.5 本地模型（4.82GB）；模型清单 7→5；驱动/开发脚本预加载改指 | 四十六 |
| `d5d2aef` | 用户反馈 9B 太重 → 全量驱动预加载改 **qwen3-5-4B**（2.52GB）；4B 工具/联网探针实测 24/24、19/19 | 四十七 |
| `f7c0927` | **视觉大修复**：大图必 500 的真因是 `-ngl 0` 只管文本层、mmproj 仍走 Vulkan → 加 **`-mmdev none`**；上下文默认 **32K**；闲置 **300s 自动退出**；图片按钮 🖼 → **Σ**（LaTeX 直立衬线）；发图质量档位；等待带秒数 | 四十八 |
| `9c63dc0` | 四个 bug 收口：时间戳一致化（迁移补 `t`、二意见行补时间、去掉假时间兜底）、看完图 **15s 自动装回文本模型**、全量驱动固定入口 `server\docs\run-full.ps1`、探针夹具自建 | 四十九 |
| `78b843c` | **代码默认直出工作区**（对话里只留「已写入」卡片，可展开/打开；设置→生成 有开关，关掉回对话输出）；对话代码块**一律**带运行按钮 | 五十 |
| `a997a49` | **v1.3.1 打包**：版本三处对齐、补 `package.json` 进打包清单（原来漏了 → 包内 0 字节，probe-version 会对不上）、4 条探针修复后复跑全绿、发布包 + 交付 zip | 五十一 |

### 二、当前状态（2026-11-08 23:25 交接）

```
版本      v1.3.1（APP_VERSION / package.json / localai.mjs 三处对齐）
仓库      HEAD a997a49，工作区干净
服务      在跑：8099，v1.3.1，Qwen3.5-9B 已加载；5 个模型、8 个真实会话、1 组视觉配对
交付      dist\QingYaoTP-AILauncher-v1.3.1.zip
          166,200,554 B / 158.5 MB / 3998 条目
          SHA256 FE3B69F4515C1713C32DDB095A1DDD676733CD40607B788652EE29AE5367E663
发布包    359.4 MB / 3497 文件（+1 = app\package.json）
探针      53 条 / 断言口径 763；全量驱动固定入口 server\docs\run-full.ps1
最新全量  2026-11-08 晚：整跑 49 绿 / 4 红 → 4 条修好后复跑全绿（4/4、13/13、8/8、11/11）
          → server\docs\probe-full-2026-11-08-v131\（r1/r2 的旧证据在 probe-full-2026-11-08\ 与 -r2\）
```

### 三、下一会话接手清单（按性价比）

1. **视觉增强包拆分**（~1d）：主包把 `app\llama\`（101MB）拆成可选增强包，主包回到 ~122MB；顺带做 sidecar 预热/首图提示优化。
2. **图片落盘**（~半天）：现在只存 240px 缩略图，刷新/切会话后原图看不到、导出不含图；改成会话目录存原图 + 导出带引用。
3. **老笔记本 1.5B / 7B 分片下载**（~半天）：下载器只吃单文件，ModelScope 的 7B 是 `-00001-of-00002` 两片。
4. **视觉请求体 4MB 上限**（~1h）：长历史 + 3 图可能 413。
5. **可选：定时任务**（用户这次明确「先不设」）：若要，建议每天 09:00 跑一次全量并修红。

### 四、接手命令（抄了就能跑）

```powershell
# 起服务（重启用：先结束启动器，再启动）
Get-Process 'QingYaoTP AILauncher' | Stop-Process -Force; Start-Sleep 2
Start-Process 'D:\LocalModels\dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe'

# 全量回归（53 条，会自己预加载 qwen3-5-4B、服务挂了自动拉起）
$env:FULL_PROBE_OUT='D:\LocalModels\server\docs\probe-full-<日期>'
powershell -NoProfile -ExecutionPolicy Bypass -File D:\LocalModels\server\docs\run-full.ps1

# 打包（先停应用）+ 交付 zip
powershell -NoProfile -ExecutionPolicy Bypass -File D:\LocalModels\server\build-portable.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File D:\LocalModels\server\make-zip.ps1
# 打完记得把本机运行目录 config.ini 的 modelDir= 改回 D:\LocalModels（打包会重置成便携默认）
```

### 五、这一场的教训（都写进硬约束了）

- **`-ngl 0` 不等于「全 CPU」**：它只管文本层，mmproj 图像编码还要 `-mmdev none`，否则正常截图必 500。
- **打包清单漏一项，包不报错但缺文件**：`package.json` 漏了会让发布包上的版本对账永远对不上；每次打包后按 `technique\05` 的自检表核一遍。
- **探针会跟着产品/环境过期**：删模型后 `probe-second-opinion` 写死的模型名、改探针签名后驱动传参、状态栏文案变短后的阈值——红之前先分「产品缺陷 / 探针过期 / 环境问题」。

---

## 五十三、2026-11-10 深夜：Debugging Tool v2（17 → 23 项 + 诊断历史 + 导出诊断包 + 打开目录）

> 需求侧一句话：调试工具原来只是「此刻的一张体检快照」——用户报「20 分钟前为什么变慢」「发图 500」「把现场交给维护者」时，它都答不上来。

### 一、为什么升级（四个真问题）

| 问题 | 动手前的事实 |
|---|---|
| 视觉没有诊断项 | v1.3.0 / v1.3.1 的主打能力（8101 视觉 sidecar）一条检查都没有，发图 500 只能翻日志 |
| 「会话备份」检查项**从来不存在** | `app.mjs:349` 调了不存在的 `backupConfig()` → `ReferenceError` 被空 `catch` 吞掉，从 11-04 起这项就没出现过（少一项不报错，没人觉得不对） |
| 没有历史 | 页面只有「此刻」，答不了「这个问题从什么时候开始、是不是刚变坏」 |
| 交不出现场 | 用户要交现场只能截图 + 口头描述 |

另外 `/api/diag` 实际是 **17 项**（加载模型 19 项），文档写 18 项——本轮一并把口径对齐到真实值。

### 二、做了什么

| 层 | 内容 | 落点 |
|---|---|---|
| 后端 · 6 个新检查项 | `config`（config.ini 是否存在 / modelDir / port / gpu / vkDevices / 视觉配对）、`vision`（8101 运行态 / 配对 / 上下文 / 闲置 / 上次错误）、`backup`（**修掉 `backupConfig` 未定义的老 bug**）、`ragfresh`（索引 vs 最新文档 mtime）、`logs`（>50MB warn / >200MB error）、`webview2`（运行时缺失 warn）；`dist` 检查从 3 份文件扩到 **6 份** | `server\app.mjs` |
| 后端 · 诊断历史 | `<程序目录上一级>\logs\diag-history.jsonl`；写入节流＝启动后首次 / 任一 level 变化 / 距上次 ≥10 分钟；最多 500 行；进程内维护 `id → {level, since, count}`，启动时读历史尾部延续徽标 | `server\app.mjs` |
| 后端 · 导出诊断包 | `POST /api/diag/export`（令牌）→ store zip；**零依赖**模块 `server\diag-zip.mjs`（新建，`zipStore` + `crc32`，不装第三方库） | `server\app.mjs`、`server\diag-zip.mjs`、`build-portable.ps1` |
| 后端 · 打开目录 | `POST /api/diag/open-path`（令牌，白名单 `dir/logs/modelDir/sessions/workspace`，非法 400，`explorer.exe`） | `server\app.mjs` |
| 页面 | 3 个过滤 chip（带计数）、6 组分组、warn/error「已持续 N 分钟」徽标、2 分钟内变化高亮、每项复制键、`#exportBtn`、诊断历史卡（sparkline + 最近 6 条变更）、三个开目录键；5s/2s/30s 三档轮询只在可见标签页跑 | `server\debug.html` |
| CLI | `--export [目录]` / `--open <名字>` / `--history [小时]` / `--watch [秒] [--cycles N]`；原有文本 / `--json` / `--ui` / `--logs` 与退出码不变 | `server\localai-debug.mjs`、`server\localai-debug.cmd` |
| 打包清单 | `diag-zip.mjs` 补进**两处**：依赖检查清单 + 复制清单（漏了整包起不来） | `server\build-portable.ps1`（第 47 / 114 行） |
| 探针 | 接口 + 界面两条探针扩到新契约 | `server\probe-debug.mjs`、`server\probe-ui-debug.mjs` |

### 三、验证（数字都来自本轮实测）

| 探针 | 结果 |
|---|---|
| `probe-debug` | **54/54**（原 35 + 19：23 项检查、6 个新 id 都在、`backup` 项真的出现、`since/changedAt/streak` 形状、history 形状、export 403 / zip 魔数 / 下载头名、open-path 403 / 400、CLI 三条新命令） |
| `probe-ui-debug` | **33/33**（本机 `loaded` 为空但 localStorage 里 `selected` 有值 → 走品牌图标分支（`/vendor/models/deepseek.png`）；「没加载也没选中」时的回退分支是 31 条，本轮两轮都没走到） |
| `probe-firstrun` | **22/22**（回归） |
| `probe-version` | **14/14**（回归） |

第二批是**发布包实机回归**（`dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe`，8099，未加载模型；与 dev 同一批探针）：

| 探针 | dev（`node app.mjs`） | 发布包（exe） |
|---|---|---|
| `probe-debug` | **54/54** | **54/54** |
| `probe-ui-debug` | **33/33** | **33/33** |
| `probe-firstrun` | **22/22** | —（回归只在 dev 跑） |
| `probe-version` | **14/14** | — |

证据：`server\docs\feature-debugtool-v2-2026-11-10\` 下 `probe-*.out.txt`（dev 四份）与 `release-probe-debug.out.txt` / `release-probe-ui-debug.out.txt`（发布包两份，23:23 跑）；截图 `debug-tool-v2-release.png`（1440×2200）、`debug-tool-v2-dev-1440.png`、`debug-tool-v2-narrow-900.png`（900px 单列不溢出）。

- 断言口径 **763 → 792**（763 − 58 + 87：这两条探针按口径记 35+23，现在是 54+33）。
- 发布包实机：`/debug` HTTP 200、`debug.html` **39603 字节**（探针报响应 36681 字节）且新 UI 在（`#filterErr`/`#exportBtn`/`#histCard` 都能点到）；`/api/diag` **23 项**（error 0，探针当刻 warn 2 / ok 21）、`dist` 检查「六份文件哈希一致」、`/api/diag/history` 200（历史写在发布包自己的 `logs\diag-history.jsonl`）、导出 **20680 字节**、open-path 非法 `which` **400**。
- dist 冒烟（`PORT=8100` 起发布包）：`/debug` 39.6 KB 含新 UI、`/api/diag` **23 项**、`dist` 检查「六份文件哈希一致」、`/api/diag/history` 200、导出 **20 KB**、open-path 非法 `which` **400**。
- 六份源码/发布包文件哈希 **6/6 MATCH**（`app.mjs`/`app.html`/`doc-extract.mjs`/`debug.html`/`localai-debug.mjs`/`diag-zip.mjs`）。

### 四、踩到的坑

1. **空 `catch` 能把一个检查项吞掉 5 天**：`app.mjs:349` 的 `backupConfig()` 根本不存在，`ReferenceError` 掉进 `catch {}`，页面上的表现就是「根本没有这一项」。修法是补上函数，并让探针断言「`backup` 检查项必须存在」——把「少一项」从静默变成红。
2. **探针断言绑定了环境**：`probe-debug` 的 KV 两条断言原来假设「已加载模型」，dev 目录没加载模型时必红；改成双分支（未加载就跳过实际值对账，仍打印 `actual=null`）。
3. **缓存 60 秒会让首条体检少一项**：`ragfresh` 本来复用 `ragWalk` 的 60s 缓存，服务刚重启、索引还没扫时 `files=0` → 这一项不产出；改成**空结果只缓存 15s**（有结果仍 60s）。
4. **探针口径跟着真实断言走**：`probe-ui-debug` 原来文档写 23 条、实际 `ok()` 有 25 处；不管历史文档怎么记，结论只认真实输出（33/33），口径公式按 58 → 87 记账。

### 五、落点与残留

- 提交：`4c698c6`（**13 文件 / +2128**）。
- 版本号**仍是 1.3.1**：`APP_VERSION`、`package.json`、`localai.mjs` 三处都**没动**；**未重打 dist zip**（交付包还是 v1.3.1 的旧内容）。
- `DebugTool.exe`（C# WebView2 宿主）**本轮没改**，页面升级自动生效；只有需要「窗口内再加功能」时才动它。
- dist 已同步（集成任务完成）：六份文件哈希 6/6 一致。
- 文档：`technique\08-调试工具.md`（23 项表 + 诊断历史 / 导出 / 打开目录三节 + 接口 + 扩展口径）、`交接文档.md`、`新会话启动词.md`、本节、新增 `server\docs\feature-debugtool-v2-2026-11-10\RESULT.md`。
- 留给下一轮：**打包 v1.4.0 + 重打交付 zip**（让交付包带上 v2）；诊断包是否要压缩（现在 store，38 KB/20 KB 已经够小）；`DebugTool.exe` 若要加「一键导出」按钮再说。
- 一个容易误读的口径：发布包 `/api/version` 的 `builtAt` 现在显示 `2026-11-10T15:18:06Z`。这是「dist 文件不被 git 跟踪 → 回退取文件时间」，**不等于重打了包**——版本仍 1.3.1、交付 zip 仍是 11-08 那份。同步 dist 就会刷新这个时间，别拿它当发布证据。
- 本轮结束时 8099 跑的是**发布包**（不是 dev），保持运行、未加载模型。

---

## 五十四、2026-11-11 凌晨：模型下载进度条（顶栏 · 可折叠）

> 需求原话：软件下载模型时加下载进度条，挂在顶栏，做成可折叠（收起）进度条的形式，并显示后台下载速度、总量、余量、预计时间。

### 一、动手前的现状

- 后端 `GET /api/download/state` 已经有 `active/done/pct/speedMBs/etaSec/receivedMB/totalMB`，但界面**只有首启弹窗里一行文字**：「42% · 200/470MB · 3.2MB/s」。
- 关掉首启弹窗、或从「模型」页/设置里开始下载之后，用户看不到任何进度，更不知道「还剩多少、要多久」。
- 下载是服务端后台任务（Node 进程里的 `dl` 状态），页面刷新、切会话都不影响；状态一直保留到下一次 `start`。

### 二、做了什么

| 层 | 内容 | 落点 |
|---|---|---|
| 后端 | `downloadState()` 补 `receivedBytes/totalBytes/remainingBytes/remainingMB/speedBytes/startedAt/finishedAt/updatedAt/lastDataAt/stallSec/elapsedTotalSec`（原有字段全保留）；速度改用**最近 4 秒**样本窗口（限速/卡顿时旧样本会让速度虚高、ETA 偏乐观）；采样记 `lastDataAt`（给「连接中…」用）；`cancelDownload()` 没有进行中下载时返回 `cancelled:false`，不再「假取消」 | `server\app.mjs` |
| 页面 | 顶栏 `#dlWrap/#dlChip`（↓ + 下载 N% + 迷你条 + 速度，空闲不占位）；详情浮窗 `#dlPanel`（文件名/大进度条/已下/**总量**/**剩余**/速度/**预计剩余**/已用 + 取消 + 收起）；`localStorage.localai.dlPanel` 记住展开偏好；1 秒/4 秒两档轮询、`document.hidden` 暂停；完成/失败/取消保留 20 秒后自动隐藏；`stallSec>2.5` 显示「连接中…」；总量未知走 indeterminate；状态优先级 `active→done→error`、「已取消」单独显示；旧结果（`finishedAt` 早于 20 秒）开页不显示；首启弹窗完成时顶栏不重复 toast | `server\app.html` |
| 探针 | 新增 `probe-download-ui.mjs`（CDP + stub `/api/download/state`，**35 条**：空闲 2 / stub 1 / 下载中 9 / 收起展开 3 / 卡住 2 / 取消 2 / 窄窗 4 / 失败 4 / 完成 5 / 收尾 2 / 无异常 1）；不调 start、不真下载 | `server\probe-download-ui.mjs` |
| 驱动 | 全量清单 53 → **54 条**（`probe-ui-debug` 之后），BOM + PS5.1 Parser 0 错误 | `server\docs\run-full.ps1` |

### 三、验证（数字都来自实测）

| 探针 | dev | 发布包 |
|---|---|---|
| `probe-download-ui` | **35/35** | **35/35** |
| `probe-ui-debug`（回归，窄窗/顶栏） | 33/33 | 33/33 |
| `probe-start-screen` / `probe-ui-new`（回归） | 12/12 / 30/30 | 12/12 / — |

- 断言口径 **792 → 827**（`probe-download-ui` +35）。
- dist 已同步：`app.mjs` / `app.html` 哈希与源码 MATCH（另有 4 份未改文件 6/6 一致的精神照旧）；发布包 `/api/download/state` 新字段齐全、首页含 `#dlWrap/#dlPanel`。
- 后端真实下载实测（本地限速源 4MB）：active 时 pct 14→38→61→84、speed≈1.0MB/s、remainingMB 递减、etaSec 倒计时；完成 pct 100 + `elapsedTotalSec`；空闲 cancel 返回 `cancelled:false`。
- 证据：`server\docs\feature-download-progress-2026-11-10\`（CONTRACT、release-probe-*.out.txt、亮/暗两张截图）。

### 四、踩坑与取舍

1. **窄窗断言测错了对象**：`header::before` 是 HUD 扫光伪元素（宽 26%、`sweep` 7 秒、`translateX` 扫到 480%），会把 `body.scrollWidth` 按相位撑大（实测 850→878→960→1042→1126）；而 `body` 是 `overflow:hidden`，用户根本看不到横向滚动条。所以「`body.scrollWidth <= innerWidth + 2`」必然假红。改成「真实 DOM 元素不越界（`rect.width>0 && rect.right<=innerWidth+2`）+ `scrollTo(9999,0)` 后 `scrollX===0`」，必要时临时 `prefers-reduced-motion: reduce` 关动画；`probe-ui-debug` 的同类断言仍有这个时序脆弱性（本轮未改，已记进 `technique\06` 的「探针过期」表）。
2. **速度口径**：4 秒滑动窗口，而不是「从头到现在」的平均值；否则源站限速或卡住时 ETA 会越来越乐观。
3. **「假取消」**：旧 `cancelDownload()` 不检查有没有在下的任务，刚下完再点取消会把状态写成 `done=true` 同时又 `error=已取消`；现在空闲时返回 `cancelled:false`，页面按 `done` 优先显示。
4. **收起的语义**：只改本地展开偏好，下载在服务端照跑；刷新后由 `/api/download/state` 接上（无持久化下载任务，重启服务才丢）。
5. **首启弹窗保留原下载 UI**（引导的一部分），只加两行联动：开始下载时立刻催顶栏、完成时顶栏不重复 toast。

### 五、落点与残留

- 提交 **`1ca6fb0`**（8 文件 / +976）。
- 版本号**仍是 1.3.1**（三处没动）、**未重打 dist zip**；dist 运行目录已同步（现在 8099 跑的发布包就是新页面）。
- 不做（仍是下一步）：下载队列/多任务、断点续传、暂停。
- 口径：全量 **54 条**、断言 **827**。

---

## 五十五、2026-11-12 凌晨：删除模型（模型菜单里直接删）

> 需求原话：加个删除模型的功能。

### 一、做了什么

| 层 | 内容 | 落点 |
|---|---|---|
| 后端 | 新增 `POST /api/models/delete`（需 `x-local-token`）：`{file, dryRun?}`；只接受模型目录内、不带路径的 `.gguf`；分片模型删任意一片**整组删除**；已加载 / 视觉 sidecar 在用 / 正在下载 → **409 拒绝**；`dryRun` 只校验并返回 `{files, shardCount, totalBytes}`，**不删文件**；默认走 **Windows 回收站**（`Microsoft.VisualBasic` 的 `SendToRecycleBin`，路径经环境变量传 JSON，避免 PowerShell 引号注入），回收站不可用才回退永久删除，响应 `recycled` 如实标记 | `server\app.mjs` |
| 页面 | 模型菜单每行加「删」（`.modelDel`，`span role=button`，click/Enter 都 `stopPropagation`，**不触发选中/加载**）；确认弹窗 `#delModelModal`（复用 `.modal`）：文件名、`N 个文件 · 共 X`、分片整组提示、回收站警告；dryRun 通过才打开弹窗，确认才真删；确认中按钮置灰「删除中…」；400/404/409 直接显示后端原文；删完 toast + 清空选中 + `refresh()` | `server\app.html` |
| 探针 | 新增 `probe-model-delete.mjs`（20 条；API 12 + UI 8）；只操作 `probe-del-*` 假文件；已加载拒绝分支用「dryRun 先证 409 + 复读 loaded 未变才补真删」，不拿真模型冒险 | `server\probe-model-delete.mjs` |
| 驱动 | 全量清单 54 → **55 条**（`probe-model-add` 之后），BOM + PS5.1 Parser 0 错误 | `server\docs\run-full.ps1` |

### 二、安全边界（都比「能删」重要）

| 边界 | 行为 |
|---|---|
| 路径 | 拒绝带 `/`、`\`、`..` 的文件名；`path.relative` 双保险，越界即 400 |
| 分片 | `xxx-00001-of-00002.gguf` 删任意一片 → 整组一起删（否则留下「缺片」残骸：模型库还列着，加载必失败） |
| 正在用 | 已加载文本模型 / 视觉 sidecar 在用 / 正在下载 → 409，提示先卸载、停视觉、取消下载 |
| 可恢复 | 默认进回收站；回收站不可用才永久删除，toast 写清「已移入回收站 / 已永久删除」 |
| 二次确认 | 先 dryRun 把「会删哪些文件、共多大」摆出来，确认后才真删；确认中禁用取消/关闭防状态错乱 |

### 三、验证

| 探针 | dev | 发布包 |
|---|---|---|
| `probe-model-delete`（新） | **20/20** | **20/20** |
| `probe-model-add`（回归：模型行结构） | 4/4 | 4/4 |
| `probe-menu-stacking`（回归：菜单可点） | 2/2 | — |
| `probe-start-screen` / `probe-ui-new` | 12/12 / 30/30 | 12/12 / 30/30 |

- 断言口径 **827 → 847**（+20）；全量驱动 **55 条**。
- 真实文件实测：4KB 假文件 dryRun 不删、真删后 `recycled:true`、`/api/state.models` 立即不再列出；分片两片一起消失；**加载 4B 后删它返回 409 且文件完好**（随后已卸载）。
- dist 已同步（`app.mjs`/`app.html` 哈希 MATCH，六份 6/6）；发布包首页含 `#delModelModal`，删除探针在发布包上同样 20/20。

### 四、踩坑

1. **探针写死端口会骗人**：`probe-model-add.mjs` 不读 argv 的 CDP，永远连 9333；我在 9335 上跑回归全是 `fetch failed (ECONNREFUSED 127.0.0.1:9333)`，差点误判成「发布包坏了」。已记进 `technique\06`（探针过期/环境表）。
2. **回收站的 PowerShell 调用别拼字符串**：文件名可能有引号/空格；最终用环境变量传 JSON 数组（`ConvertFrom-Json`），避免拼接注入。
3. **dryRun 必须真校验**：只信前端列表会显示旧大小/旧分片数；现在 dryRun 由后端现扫磁盘。

### 五、落点与残留

- 提交 **`b5c0e16`**（8 文件 / +718）。
- 版本号**仍是 1.3.1**、**未重打 dist zip**；dist 运行目录已同步（8099 上的发布包就是新页面）。
- 证据：`server\docs\feature-model-delete-2026-11-11\`（CONTRACT、release-probe-*.out.txt、亮/暗截图）。
- 口径：全量 **55 条**、断言 **847**。
- 下一步仍是**打包 v1.4.0 + 重打交付 zip**——源码已领先交付包三个功能（Debugging Tool v2、下载进度条、删除模型）。
---

## 五十六、2026-11-13 深夜：交接整理（无代码改动）

> 这一笔只是一次「交接收口」：核对真实状态、把停掉的服务拉起来、刷新文档；**产品代码一行没改**。

### 一、交接时实测

- **git**：HEAD `149cc5a`（文档提交），工作区干净；三个产品提交在 `4c698c6`（Debugging Tool v2）/ `1ca6fb0`（下载进度条）/ `b5c0e16`（删除模型）。
- **服务**：机器重启后 8099 曾停（无 node、无启动器进程）；已重新启动 `dist` 发布包——v1.3.1、5 个模型 / 8 个真实会话 / **未加载模型**、`gpu=vulkan`。
- **dist**：运行目录 **3500 文件 / 359.5MB**（v1.3.1 打包时 3497 / 359.4MB；之后只同步了三个功能的源码，**未重打包**）；交付 zip 仍是 11-08 的 `QingYaoTP-AILauncher-v1.3.1.zip`（158.5MB / 3998 条）。
- **探针**：75 个 `probe-*.mjs`；全量驱动 **55 条**（`run-full.ps1` BOM `EF BB BF`、PS5.1 Parser 0 错误）；断言口径 **847**（763 − 58 + 87 = 792 → +35 = 827 → +20 = 847）。
- **builtAt 口径**：`/api/version` 现在显示 `2026-11-11T15:53:49Z`，那是同步 dist 的文件时间，**不是重打包证据**。
- **发布包冒烟**（11-13 交接时）：首页 HTTP 200 / 363045 字节且含 `#delModelModal` + `#dlWrap`；`/debug` HTTP 200 / 39603 字节且含 `#filterErr` + `#exportBtn`；`/api/diag` 23 项（error 0 / warn 3 / ok 20）且「发布包与源码」= 六份文件哈希一致；`/api/download/state` 新字段齐全；`/api/state` 5 模型 / loaded 空 / activeChats 0。

### 二、这次更新了哪些文档

| 文档 | 改了什么 |
|---|---|
| `交接文档.md` | 最后更新 → 2026-11-13 交接整理轮；当前状态（HEAD `149cc5a`、新增「服务」行、发布包口径 3500/359.5MB 并注明未重打包）、验证块新增 11-13 交接检查；「从零部署」的 zip 名改到 v1.3.1；代码地图行数改为真实值（app.mjs ~7700 / app.html ~7400） |
| `新会话启动词.md` | 更新于/现状快照（11-13，服务=发布包、5 模型/8 会话/未加载）；探针 75 个 / 55 条 / 847；起服务示例补 `probe-download-ui`、`probe-model-delete`；`run-full` 注释改为 55 条；关键文件索引补两个新探针与两个 feature 目录、日志指到第五十六节；开场块改成「打包 v1.4.0 + 干净全量 55 条」 |
| `DeveloperRealtimeLog.md` | 本节 + 文件头「最新一笔」 |
| `technique/` | 上一轮已更新接口与探针口径（`/api/models/delete`、写死端口坑）；本轮无代码改动，不重复改 |

### 三、下一轮（第一件事不变）

1. **打包 v1.4.0 + 重打交付 zip**：三功能（Debugging Tool v2 / 下载进度条 / 删除模型）一次带进交付包；升 `APP_VERSION`/`package.json`/`localai.mjs` 三处 → `build-portable.ps1` → `make-zip.ps1` → 按 `technique\05` 自检（`diag-zip.mjs` 进包、包内 `/api/diag` 23 项、`/debug` 新 UI、模型菜单有「删」、顶栏下载进度条）；再跑一次**干净全量 55 条**。
2. 之后按 `交接文档.md` 的「下一步」：视觉增强包拆分、图片落盘、7B 分片下载等。

### 四、交接提醒

- **机器重启后服务会停**：双击 `dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe` 恢复（重启用要先结束启动器，单实例）；服务起来后 `/api/version` 应报 1.3.1。
- **界面探针需要 headless Edge 9333**；`probe-model-add.mjs` 写死 9333（不读参数），别在别的端口上跑它。
- 跑全量前备份 `workspace\sessions`，跑完从 `server\docs\session-backups\<时间戳>\` 恢复（`probe-ui-sessions` 会清空）。

