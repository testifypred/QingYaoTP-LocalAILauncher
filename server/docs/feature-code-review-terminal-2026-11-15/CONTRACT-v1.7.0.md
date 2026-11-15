# v1.7.0 —— 终端全面升级 + 代码审查/修正工作流（契约）

> 2026-11-15 第二十二轮。**本轮不重打发布包**（用户要求：别每个改动都往交付包里塞）。只在 dev 里改 + 跑探针；dist/zip 到下一轮交付时再统一重建。

## 0. 硬约束（沿用）
- 零依赖；不写死盘符；`.ps1` 要 BOM + PS5.1 Parser 复验；日志只追加；探针就是 CI；改完别整份贴大输出。
- 版本 **v1.7.0** 三处（app.mjs APP_VERSION / package.json / localai.mjs VERSION）——本轮不改包，但版本要对齐，`probe-version` 会查。
- 别动 v1.6.0 的视觉增强包相关契约（`/api/vision/*`、app\llama 拆分）。

## 1. 后端（Lead 实现，app.mjs）

### 1.1 流式代码审查 `POST /api/code/review/stream` （SSE）
- header `x-local-token` **必需**（无 → 403 JSON）
- body：`{ code(必填, ≤20000 字), lang?, file?, intent?, model?（gguf 文件名；空/省略=本对话已加载模型）, max_tokens?(128–2000, 默认 1200) }`
- 请求校验失败仍走 JSON + 状态码：400 缺 code；**413 code 超过 20000 字（与老的 /api/code/review 一致，2026-11-15 实测以实现为准，原稿写 400 是笔误）**；403 无令牌；404 指定模型不存在；409 没加载模型 / 模型忙（activeChats>0 或正在加载）
- 成功：`200 text/event-stream`，每条 `data: <json>\n\n`，json 带 `type`：
  - `{type:"meta", model:"Qwen3.5-9B", modelFile:"…gguf", contextSize:8192, switchedModel:false, startedAt:1700000000000}`（`switchedModel:true` 表示为了本次审查切换了模型）
  - `{type:"delta", text:"…"}` —— **审查思路**逐段（UI 渲染成「深度思考」折叠块，流式）
  - `{type:"findings", summary:"一句话结论", issues:[{line:12,endLine:13,severity:"error|warn|info",title:"空指针",detail:"…",fix:"…"}], lineCount:120}`
  - `{type:"done", seconds:12.3, model:"Qwen3.5-9B"}`
  - `{type:"error", message:"…"}`（随后结束）
- `issues[].line` 是 1 起始行号：服务端已 clamp 到 1..lineCount；`endLine>=line`；没有问题时 `issues: []`。
- 输出协议（服务端 prompt 里约束模型）：先输出「审查思路」（逐条 - 行，带行号与理由），最后输出一个 ```json 块 = findings。**json 块不进入 delta 流**（UI 不会看到裸 JSON）。

### 1.2 流式修正 `POST /api/code/fix` （SSE）
- header `x-local-token` 必需；body：`{ code(必填), lang?, file?, intent?, model?, issues?:[{line,endLine,severity,title,detail,fix}], scope?:"all"|"single" }`
- 校验：400 缺 code；413 code 超过 20000 字（同 review/stream）；403 无令牌；404 指定模型不存在。
- 事件：`{type:"meta"…}` → `{type:"delta", text}`（改代码过程的说明，UI 放思考块）→ `{type:"result", code:"<修正后完整代码>", changes:[{start:3,end:5}], added:2, removed:1, lineCount:120}` → `{type:"done"…}`；失败 `{type:"error", message}`
- `changes` 是**新代码**里被改动（改过/新增）的行号区间（1 起始、闭区间），UI 用它高亮「改动行」；模型输出必须是完整代码（服务端从 ```lang 围栏里抽，抽不到就取全文）。

### 1.3 工具执行接口
- `GET /api/tools`（已有）：额外返回每个工具的 `args:[{name,type,required,description}]` 与 `required:[...]`（给终端补全/帮助用；原有 `name/description/params` 保留别删）。
- `POST /api/tool`（新增，**令牌必需**）：body `{ name:"web_search", args:{query:"…"} }` → `200 { ok:true, tool:"web_search", ms:123, result:{…} }`；未知工具 404；args 不是对象 400；工具内部错误仍 200，但 `result.error` 有值。


## 1.4 并发/互斥（2026-11-15 实测补的硬约束）
- **代码审查/修正进行中，`POST /api/load` 一律 409**：「代码审查/修正正在进行，等它结束再切换模型」。
  原因：审查用的是同一份权重的独立小 context，这时把模型卸掉换另一个 → 原生层卡死（CPU 持续涨、HTTP 全部超时）。
  15:41 与 15:52 两次 8099「整体无响应」都是「审查中 + 另一客户端切模型」叠出来的，隔离回归 `concurrency-check.mjs` 7/7 后确认修复。
- 代码任务（review/stream、fix）由 `codeJob` 串行锁排队：同一时刻只跑一个，第二个会等（不会互相踩 context）。
- 前端「审查模型」下拉**不要**先调 `/api/load`：直接把选中的 `model` 塞进 review/stream 请求体，由后端在任务锁内切换。
- 界面聊天输入框的真实 id 是 **`#q`**（不是 `#input`）；「发回对话」写 `#q` + 开场白的 `#heroInput`。

## 1.5 已知产品风险：Phi-4-mini 审查会偶发卡死（2026-11-15 全量首跑实测）
- 现象：把 `Phi-4-mini-instruct-Q4_K_M.gguf` 当审查模型时，`loadModel` 就绪后**生成阶段偶发不返回**，事件循环被原生层占住（CPU 持续涨、/api/state 全超时）。隔离单跑同一请求 22.3s 能过 → 偶发。
- 线索：加载时日志有 `[node-llama-cpp] load_arch_hparams: Phi SWA is currently disabled`（llama.cpp 已知问题）。
- 已做的缓解：
  · review/fix 的生成加 **AbortController 超时**（默认 300s，`CODE_JOB_TIMEOUT_MS` 可调）——对「很慢」有效；对「原生层彻底卡死」发不出定时器，只能重启进程；
  · 全量驱动里 `PROBE_SKIP_SWITCH=1` 跳过 Phi 切换（隔离跑仍覆盖 48/48）；
  · 文档/界面都要提醒：**别用 Phi-4-mini 做审查模型**（它本身质量也弱）。

## 2. 代码面板 UI（app.html，teammate=codeui）

### 2.1 新建文件可选语言（要求 i）
- 工具栏 `#cwNewName` 旁加 `<select id="cwNewLang">`（默认「按文件名」）
- 选项至少：javascript(js)、typescript(ts)、python(py)、c( c)、cpp(cpp)、java(java)、go(go)、rust(rs)、html、css、json、markdown(md)、shell(sh)、sql、text(txt)
- 选了语言且用户输入的名字**没有扩展名** → 自动补对应扩展名；有扩展名则尊重用户；新建后 CodeMirror 用对应 mode；选择记 localStorage `localai.cwNewLang`
- `#cwNewName` 的 placeholder 跟着语言变（如 `main.py（回车新建）`）

### 2.2 审查可指定模型（要求 ii）
- 审查面板头部加 `<select id="cwReviewModel">`：第一项 `本对话模型（<当前模型>）`（value=""），其余项来自 `GET /api/state.models` 的 `file`
- 默认 value=""（= 本对话模型）；请求时把选中值塞 `model` 字段；切换模型时 UI 要提示「正在切换模型…」（后端 meta.switchedModel=true）

### 2.3 审查过程 = 类深度思考链 + 流式（要求 iii）
- 点 `#cwReview` → `fetch('/api/code/review/stream', {headers:{'x-local-token':localToken}})` 读 SSE（`response.body.getReader()` + TextDecoder，按 `\n\n` 切）
- 审查中：`#cwReviewBody` 里放 `<details id="cwThink" open><summary>审查思路（思考中…）</summary><pre id="cwThinkText"></pre></details>`，delta 文本实时 append + 自动滚到底；折叠后保留
- `findings` 到达后：收起/保留思考块，渲染摘要 + 问题列表 `#cwIssues`；每条 `.cwIssue[data-line="12"][data-severity="error|warn|info"]`，内部 `.cwIssueHead`（`行 12 · 严重度 · 标题`）、`.cwIssueDetail`、`.cwIssueFix`、按钮 `.cwIssueApply`（一键更改这条）
- `done` → 状态行 `#cwReviewState` 显示「审查完成 · N 个问题 · 12.3s」；失败显示错误

### 2.4 审查结束后代码区高亮错误行（要求 iv）
- CodeMirror 行 class：`.cwLineErr`（error）/ `.cwLineWarn`（warn）/ `.cwLineInfo`（info），由 `issues[].line..endLine` 决定；每次新审查先清旧 class
- 点问题卡片 → 跳转并选中对应行（`cm.setCursor`/`scrollIntoView`）
- 样式用 CSS 变量（见 2.7）

### 2.5 一键更改 / 一键纠正 / 重新审查（要求 v）
- 按钮行：`#cwFixAll`（一键纠正 = 全部问题）、`#cwReReview`（重新审查）、`#cwSendChat`（发回对话）
- 一键纠正 → `POST /api/code/fix`（scope:"all"，issues=当前全部）；单条「一键更改」→ scope:"single"，issues=[该条]
- 修改过程流式显示在同一条思考块里（`#cwThinkText` 追加 delta），`result` 到达后：把 `code` 写进编辑器（保持当前文件 & 标记 dirty，不自动落盘）、按 `changes` 给新代码加行 class `.cwLineChanged`（另一颜色）
- 修改后：状态行「已修改 N 处（新增 a / 删除 b）· 可保存或发回对话」；再编辑代码时旧高亮可以保留到下次审查/修改
- 重新审查：清空 issues/高亮，重新走审查流

### 2.6 改完可发回对话（要求 vi）
- `#cwSendChat`：把**当前编辑器里的代码**包成围栏代码块 + 一行说明（含文件名/语言/「这是修正后的版本」）+ 若刚修改过则附带「改动行」摘要，写进聊天输入框 `#input` 并聚焦（不自动发送，用户可加话再发）；同时 `showToast` 提示已填入

### 2.7 高亮颜色可自定义（要求 vii）
- 设置里新增「代码」页：tab 按钮 `<button class="stab" data-tab="code">代码</button>` + `<div class="settingsBody" id="paneCode" data-pane="code" hidden>`
- 4 个 `<input type="color">`：`#cwColorErr` / `#cwColorWarn` / `#cwColorInfo` / `#cwColorChanged` + `#cwColorReset`（恢复默认）
- 写 localStorage `localai.cwColors` = `{err,warn,info,changed}`，启动时/改色时写 CSS 变量 `--cw-err-bg` 等（默认 err `#7f1d1d66`、warn `#78350f66`、info `#164e6366`、changed `#14532d66`）；CodeMirror 行 class 的 background 用这些变量
- 注意：设置 tabs 的切换逻辑是 `data-tab` 驱动的（现有 gen/gpu/vision/tts/tools/appear/about），加 code 页要同步所有初始化/持久化位置

### 2.8 兼容（别改坏）
- 现有 id 保留：`#cwNewName #cwNew #cwSave #cwRun #cwDelete #cwEditor #cwTabs #cwList #cwEmpty #cwOutput #cwReview #cwReviewPanel #cwReviewToggle #cwReviewBody #cwReviewMeta #cwIntent #cwDir #cwStatus`
- `probe-code-panel`（18 条）/ `probe-code-workspace`（21 条）必须继续绿：读它们再动手；`#cwReviewBody` 仍要有可读内容（摘要/问题），旧的非流式 `/api/code/review` 保留不动
- 审查结果渲染仍用 `renderMarkdown`（`#cwReviewBody` 里放摘要 markdown；问题卡片另放在 `#cwIssues`）

## 3. 终端 TUI（localai-tui.mjs，teammate=tui）

### 3.1 命令提示（要求：命令提示）
- 输入以 `/` 开头时：
  - **行内灰字补全**：光标后显示首个匹配命令的剩余部分（仅 TTY/非 --plain；NO_COLOR 时用暗色也 OK）
  - **提示条**：输入框下方一行列出匹配命令 + 一行说明（最多 6 行，含用法），高亮当前候选
  - `Tab` 补全到当前候选，连按 Tab 切换候选；`→` 接受行内补全；Esc 收起
- 命令集（至少）：`/help`、`/clear`、`/new`、`/model`、`/state`、`/tools`、`/tool`、`/run`、`/web`、`/think`、`/exit`；`/tool` 的提示要列出可用工具

### 3.2 终端里调用软件工具（要求：调用软件工具）
- `/tools`：`GET /api/tools` 打印工具名 + 参数 + 说明（可翻页/截断）
- `/tool <name> [key=value …] [--json '<json>']`：POST `/api/tool`（带 `x-local-token`，令牌来自 `GET /api/state.localToken`）→ 打印 `result`（JSON 美化、截断长文本；`result.error` 用红字）
- 支持 `key=value` 值类型推断：数字 / true/false / null / 其余字符串；`--json` 直接给完整 args（优先）
- `/help` 同步更新；非 TTY（管道）模式也要能跑 `/tools` `/tool`（探针会用它）

### 3.3 自检
- 新参数 `--hint-test "<输入>"`：不进入交互，打印「命令补全结果」每行 `cmd\t说明`（给探针断言）
- 现有 `--selftest` / `--snapshot` 保持可用；`node --check` 过；真实 TUI 手工/管道各跑一次

## 4. 探针（teammate=probes）
- 新建 `server/probe-code-review-stream.mjs`（API+SSE，真模型）：
  - 无令牌 403；缺 code 400；非法 model 404
  - 真实审查一小段有 bug 的 JS：断言 SSE 事件顺序（meta→delta*→findings→done）、delta 非空、issues 字段齐全且行号在范围内、`#cwReviewBody` 无关（UI 探针里验）
  - `/api/code/fix`：断言 result.code 非空、changes 至少 1 段、行号连续/有序
  - 指定另一个模型（如 `Phi-4-mini-instruct-Q4_K_M.gguf`，若存在）→ `meta.switchedModel===true` 且 `meta.model` 匹配（这条会切模型，放最后）
- 新建 `server/probe-code-panel-v2.mjs`（CDP UI，真模型）：语言选择新建文件（`main.py` 之类）、审查流式思考块出现、问题卡片 + 行高亮 class、一键纠正后 `.cwLineChanged` 出现、发回对话把代码填进 `#input`、颜色设置持久化（改 `#cwColorErr` → localStorage + CSS 变量）
- 新建 `server/probe-tui-tools.mjs`：`node localai-tui.mjs --hint-test "/to"` 断言补全/说明；管道跑 `--plain` 发 `/tools` 与 `/tool get_current_time` 断言输出含工具名/时间
- `server/docs/run-full.ps1` 追加 3 条（59 → 62），BOM + PS5.1 Parser 复验
- 现有 `probe-code-panel` / `probe-code-workspace` / `probe-tool-stream` / `probe-tools-agent` 回归必须绿

## 5. 文档（收尾时统一）
README（终端 + 代码审查新能力）、交接文档、technique/02（新接口）、technique/06（62 条/口径）、technique/07（新坑）、DeveloperRealtimeLog 第六十二节（只追加）、新会话启动词（现状 + 下一步）。

## 6. 验收
1. 后端 3 个新接口 + 老接口兼容（probe-code-workspace 21/21、probe-code-panel 18/18 绿）。
2. 新探针全绿；全量 62 条跑一遍（允许环境类复跑，要如实记）。
3. 手工/管道各跑一次 TUI；代码面板点一遍完整流程（审查 → 高亮 → 一键纠正 → 发回对话）。
4. **不打发布包**（用户明确要求）；dist 不重建，日志里写明原因。