# v1.11.2 全量回归结果（源码实例，70 条）

- 生成时间：2026-11-28 00:17:57（全量 23:57:36 → 00:17:57，共 20m21s）
- 执行人：runtime-env-auditor（task-6）；只读运行，未改源码/探针、未 git 写、未打包
- 证据目录：`server\docs\probe-full-2026-11-27-v1112\`（summary.txt / logs / shots / isolate / measure-*）

## 一、结论摘要

| 项 | 值 |
|---|---|
| 探针数 | **70/70 全部执行** |
| PASS / FAIL | **68 PASS / 2 FAIL** |
| 断言合计 | **1,523**（summary 明文 1,514 + probe-func 9；见第四节） |
| FAIL 项 | probe-title-ui 12/13（状态栏阈值）· probe-ui-tools 10/12（C 段刷新恢复） |
| 环境红 | **本轮无**（web-tools / ui-web / vision 系列本轮全 PASS） |
| Lead 本轮改的 4 条探针 | **全绿**：ui-debug 33/33、model-delete 20/20、start-screen 12/12、start-flow 8/8 |
| 版本探针 | probe-version **14/14**，报 **1.11.2**（git ae9cb3d，dirty=true） |

## 二、实例与模型真值

- 实例：源码 `node server\app.mjs`（工作目录 `D:\LocalModels\server`），启动器进程 pid 24172 → 实际 node 进程 **pid 26124**（PATH 的 node 垫片，v24.21.0）。
- `/api/version`：`{"version":"1.11.2","commit":"ae9cb3d","commitAt":"2026-11-25T23:41:40+08:00","buildSource":"git","dirty":true,"node":"v24.21.0","dir":"D:\\LocalModels\\server","port":8099}`
- 预加载：`POST /api/load {"file":"qwen3-5-4B-Q4_K_M.gguf","contextSize":16384}` → ok，6.9s，ctx=16384，layers=33，gpu=vulkan。
- 全量过程中 `probe-context-switch` 把 ctx 改成 8192（结束时实测 ctx=8192）；收尾前已重新 load 回 **16384** 并确认 ctx16384 ready，然后停实例。
- 收尾状态：**8099 空闲**（无监听）、9333 空闲、我起的源码 node 已停止（pid 26124 已 kill；pid 24172 亦已停止），无残留。

## 三、70 条明细（summary.txt 原样）

| 探针 | 结果 | 用时 | 断言 |
|---|---|---|---|
| probe-sessions | PASS | 0.4s | 33 |
| probe-workspace-api | PASS | 0.3s | 9 |
| probe-code-run | PASS | 17.9s | 13 |
| probe-code-workspace | PASS | 0.7s | 21 |
| probe-code-review-stream | PASS | 45.6s | 45 |
| probe-review-watchdog | PASS | 42.1s | 56 |
| probe-code-panel-v2 | PASS | 41.6s | 44 |
| probe-tui-tools | PASS | 2.1s | 52 |
| probe-code-review-verify | PASS | 118s | 87 |
| probe-code-review-export | PASS | 7.4s | 66 |
| probe-code-review-multi | PASS | 113.5s | 86 |
| probe-cloud-upstream-stream | PASS | 1.5s | 24 |
| probe-gpu | PASS | 0.8s | 14 |
| probe-ui-gpu | PASS | 7.7s | 7 |
| probe-ui-metric | PASS | 6.5s | 0（信息型） |
| probe-backup | PASS | 16.2s | 38 |
| probe-rag | PASS | 0.5s | 16 |
| probe-plugins | PASS | 0.4s | 11 |
| probe-version | PASS | 0.3s | 14 |
| probe-firstrun | PASS | 0.4s | 22 |
| probe-debug | PASS | 3.9s | 54 |
| probe-func | PASS | 25.5s | 0（log 计 9） |
| probe-ui-new | PASS | 7.7s | 30 |
| probe-readme | PASS | 10s | 21 |
| probe-start-screen | PASS | 4.2s | 12 |
| probe-start-flow | PASS | 7.3s | 8 |
| probe-model-add | PASS | 8.1s | 4 |
| probe-model-delete | PASS | 10.7s | 20 |
| probe-menu-stacking | PASS | 3.7s | 2 |
| probe-status | PASS | 3.6s | 6 |
| probe-code-panel | PASS | 6.3s | 17 |
| probe-settings-tools | PASS | 5.2s | 9 |
| probe-workspace-ui | PASS | 7.9s | 7 |
| probe-hero-modes | PASS | 8.6s | 10 |
| probe-input-extras | PASS | 7.9s | 8 |
| probe-formula-panel | PASS | 7.5s | 7 |
| probe-stream-render | PASS | 2.2s | 15 |
| probe-review-scroll | PASS | 0.5s | 10 |
| probe-code-window-ui | PASS | 0.4s | 10 |
| probe-formula-find | PASS | 7s | 8 |
| probe-timestamps | PASS | 5.5s | 4 |
| probe-small-features | PASS | 9s | 6 |
| probe-title-ui | **FAIL(exit 1)** | 6.8s | 12/13 |
| probe-session-jump | PASS | 7.9s | 4 |
| probe-session-race | PASS | 5.5s | 3 |
| probe-ctx-panel | PASS | 12.9s | 25 |
| probe-code-run-ui | PASS | 4.2s | 9 |
| probe-ui-tools | **FAIL(exit 1)** | 23s | 10/12 |
| probe-ui-web | PASS | 36s | 39 |
| probe-ui-rag | PASS | 5s | 6 |
| probe-ui-version | PASS | 4.9s | 9 |
| probe-ui-debug | PASS | 16.3s | 33 |
| probe-download-ui | PASS | 12.8s | 35 |
| probe-ui-backup | PASS | 10.6s | 20 |
| probe-sidebar-search | PASS | 11.2s | 11 |
| probe-auto-title | PASS | 22.1s | 5 |
| probe-ui-sessions | PASS | 13.8s | 28 |
| probe-chat-plain | PASS | 5.2s | 11 |
| probe-tool-stream | PASS | 26.6s | 9 |
| probe-tools-agent | PASS | 91.1s | 24 |
| probe-web-tools | PASS | 78.5s | 19 |
| probe-kv-long | PASS | 39.9s | 0（信息型） |
| probe-context-switch | PASS | 23.5s | 3 |
| probe-ui-preload | PASS | 27.4s | 35 |
| probe-preload | PASS | 25.2s | 26 |
| probe-second-opinion | PASS | 29.1s | 11 |
| probe-ui-vision-pack | PASS | 23.2s | 42 |
| probe-ui-vision | PASS | 5.8s | 19 |
| probe-vision-pack | PASS | 42.6s | 110 |
| probe-vision-api | PASS | 24.5s | 27 |

## 四、断言合计口径

- summary.txt 里带 `RESULT n/m` 或 `== 结果: n 通过 / m 失败 ==` 的 67 条，逐条相加 = **1,514**。
- `probe-func` 的 summary 行不带 RESULT，但 log 末行明写「**通过 9 项，失败 0 项**」→ +9。
- `probe-kv-long` / `probe-ui-metric` 为信息型（源码里 `ok(/check(` 调用数 = 0，只打印表格/指标）→ +0。
- 合计 **1,523**。与 v1.11.1 的 1,524 − probe-hero-modes（11→10，-1）= 1,523 完全吻合（对上一轮 probe-full-2026-11-24-v111 同口径复算 = 1,515+9=1,524，逐条 diff 只有 hero-modes -1）。

## 五、两条 FAIL 的隔离复跑与定性

### 5.1 probe-title-ui：断言阈值过期（设计性变窄，非「被压成 0」）

- 整跑：`FAIL 状态栏拿到宽度 w=98`（此时 ctx=16384，状态文本 `16K · 可思考`）。
- 隔离复跑（run-probe-with-edge.ps1，独立起 Edge，`PROBE_SKIP_SWITCH=1`）**3 次全红、数字稳定**：w=93 / 93 / 93（ctx=8192，文本 `8K · 可思考`），均为 12/13。
- 几何实测（measure-header.mjs，Edge 1440x900，innerWidth=1408，Edge 158.0.4370.45）：
  - ctx=8192：`#status` w=93、clientW=91、scrollW=91，`#statusText` textW=57、textScrollW=57，overflow=hidden → **scrollW==clientW，无省略号截断**，文本「8K · 可思考」完整渲染。
  - ctx=16384：w=98、clientW=96、scrollW=96，textW=62、「16K · 可思考」→ 同样无截断。
  - 顶栏按钮实测宽度：sideToggle 30 / modelBtn 143 / 文件·代码·终端·调试·公式 各 50 / 上下文 63 / 设置 32（SVG）/ 主题 46，合计把 `#status` 压到 93–98px。
- 对照 v1.11.1 上一轮同一探针：w=120（13/13 通过）。→ 本项为 v1.11.2 顶栏重排后 `#status` 变窄、**内容仍完整显示**；断言 `w>=100` 已过期。阈值改不改由 Lead 定（Lead 修探针，本审计不动）。

### 5.2 probe-ui-tools C 段：刷新恢复失败 → 探针 reload 与 400ms 落盘防抖的竞态（非会话状态级联）

- 整跑：C 段 `刷新后工具卡片被恢复 — 0 张` / `刷新后正文被恢复`（10 通过 / 2 失败）。
- 隔离复跑 **2 次全红**（与整跑一致，非环境偶发）。
- 按 Lead 要求记录的三件事真值（reproduce 脚本 measure-recent2.mjs，生成完成后**立即** reload，复现探针时序）：
  - reload 后 `#recentWrap.hidden` = **false**（右下角「最近对话」卡正常出现，标题=刚问的问题）；
  - `#recentOpen` 存在 = **true**；
  - 点 `#recentOpen` 后：`localStorage['localai.lastSession']` = `mwz6yexy-7452b6bb`，页面 `sessionId` 同值；`GET /api/sessions` 条数 = **4**（`/api/state` 无 sessions 字段，只有 `activeChats=0`）；
  - 恢复出的会话 `GET /api/sessions/mwz6yexy-7452b6bb` **messages 只有 1 条 user**，assistant 回复（tool 卡片/正文）根本没落盘。
- 根因证据：`app.html` 的落盘是 400ms 防抖 + PUT（`saveTranscript()` @4675-4680；助手消息在流结束 finally 里 push 后调 `saveTranscript()` @10135-10146）。探针流程是「生成完成 → 截图 → **立刻** Page.reload」，reload 早于 400ms 防抖+PUT 完成，计时器被导航取消 → 只留下早先已落盘的 user 消息（该会话文件 updatedAt = createdAt+424ms，佐证 assistant 那条从未写入）。
- 对照实验：同一路径下，生成结束后**等 2.5s** 再读服务端，plain 轮与 tool 轮都正常落盘（tool 轮 assistant len=34、tools=1，会话共 4 条消息）→ 落盘逻辑本身正常，失败点是「完成→reload」的 <~1s 窗口。
- 结论：不是「会话状态级联/环境」；是探针时序竞态（产品侧存在「回答完成后约 0.4–1s 内刷新会丢最后一条 assistant」的窗口）。探针加 wait / 产品侧显式 flush 都能解决，归属由 Lead 判（本审计不改）。

## 六、环境红与本轮改动探针

- 本轮 **无环境红**：probe-web-tools 19/19 PASS（本轮未触发百度反爬）、probe-ui-web 39/39 PASS（未出现会话级联）、vision 四连（ui-vision-pack 42 / ui-vision 19 / vision-pack 110 / vision-api 27）全 PASS、vision 端口 8299 本轮未被占用/无冲突。
- Lead 本轮改的 4 条探针（task-4）全绿：probe-ui-debug 33/33、probe-model-delete 20/20、probe-start-screen 12/12、probe-start-flow 8/8 → 断言语义已按 1.11.2 生效。
- probe-version 14/14 报 1.11.2（git ae9cb3d、dirty=true、node v24.21.0 / 8099），与 package.json / app.mjs / localai.mjs / localai-tui.mjs 的 1.11.2 一致。

## 七、证据文件

- `summary.txt`（全程摘要，UTF-8 BOM + 追加行 UTF-16LE 混合，按 Unicode 解码可读）
- `logs\probe-*.out.txt / .err.txt`（70 条逐条原始输出；两条 FAIL 的原始输出在 probe-title-ui.out.txt / probe-ui-tools.out.txt）
- `shots\`（26 张截图，含 header-new.png、ui-16-tools-agent.png）
- `isolate\`：`iso-title-ui.out.txt` + `iso-title-ui-run2.txt` + `iso-title-ui-run3.txt`（title-ui 3 次隔离复跑）、`iso-ui-tools.out.txt`（ui-tools 隔离复跑）、measure-header-8k/16k.txt
- `measure-header.mjs / measure-recent.mjs / measure-recent2.mjs / measure-save.mjs` + `measure-header-8k.json / measure-header-16k.json / measure-recent.json / measure-recent2.txt`（本次审计临时证据脚本，均在证据目录内，不改产品代码）
- `server.out.log / server.err.log`：均 0 字节（stdio 重定向未捕获到服务输出，不影响探针结果）

## 八、现场状态与清理

- 我起的源码实例已停止：pid 26124（node，由 pid 24172 垫片拉起）已 kill；**8099 无监听（空闲）**，9333 空闲，无残留 node/msedge headless 进程。
- 会话备份：跑前已备份 `D:\LocalModels\workspace\sessions` → `%TEMP%\sessions-before-v1112\`（4 个 json，跑后未改动备份）。probe-ui-sessions 等会 wipe 会话，当前 workspace\sessions 只剩 4 个探针会话（mwz6grow / mwz6sfdn / mwz6vvak / mwz6yexy）；如需恢复用户会话，请从上述备份复制回（本任务写范围只允许 docs 目录，故未动 workspace）。
- 已按要求：未 git 写、未打包、未改源码/探针；只写了本证据目录。

## 九、修正后隔离复跑（task-10）

Lead 只改探针（未动产品代码）：
- `server\probe-title-ui.mjs:46`：`header.w >= 100` → `>= 80`（注释：v1.11.2 顶栏重排后 #status 实测 93–98px、scrollW==clientW 无截断，断言本意是「别压成 0」）。
- `server\probe-ui-tools.mjs` C 段（@115-127）：reload 前轮询 `GET /api/sessions/<id>` 直到出现 assistant 消息（最多 40×250ms = 10s），超时才打印 `! 等落盘超时`；注释写明 400ms 防抖 + `saveTranscript()` 竞态。产品侧窗口保留（已记 technique/07，v1.11.2 不改产品）。

复跑环境：源码实例 `node server\app.mjs`（v1.11.2 / git ae9cb3d / dirty=true / node v24.21.0；实际 node pid 23536，垫片 pid 25996）；4B ctx=16384（本轮未跑 probe-context-switch，全程保持 16384）；Edge 158.0.4370.45 headless 由 `run-probe-with-edge.ps1` 独立启动（自身起 Edge + CDP PUT /json/new），`PROBE_SKIP_SWITCH=1`。

结果（4/4 绿）：

| 复跑 | 结果 | w / C 段细节 | 证据 |
|---|---|---|---|
| title-ui run1 | **13/13 PASS** | w=98（ctx16384，文本「16K · 可思考」） | isolate\iso2-title-ui-run1.txt |
| title-ui run2 | **13/13 PASS** | w=98 | isolate\iso2-title-ui-run2.txt |
| ui-tools run1 | **12/12 PASS** | C 段「刷新后工具卡片被恢复 — 1 张」「刷新后正文被恢复」；**无**「! 等落盘超时」行 | isolate\iso2-ui-tools-run1.txt |
| ui-tools run2 | **12/12 PASS** | 同上（1 张 / 正文恢复）；**无**超时行 | isolate\iso2-ui-tools-run2.txt |

有效 70/70 口径：
- 全量整跑原始记录保持不动：**68 PASS / 2 FAIL**（本次未重跑 ~20min 整跑，避免与并行打包抢资源）。
- 上述 2 条 FAIL 经 Lead 在探针侧修正后各隔离复跑 2/2 全绿，且 ui-tools C 段恢复与「等落盘」行为均符合预期 → 定性为「探针阈值/时序问题（已在探针侧修正），产品无回归」；与原始 68 PASS 合并计为 **有效 70/70**。
- 断言合计仍为 **1,523**：两条探针断言条数未变（title-ui 13、ui-tools 12），只是由 12/13、10/12 变为 13/13、12/12。
- 已知残余（有意保留）：产品侧「回答完成后约 0.4–1s 内刷新会丢最后一条 assistant」窗口按 Lead 决定不在 v1.11.2 改产品，探针改为「轮询落盘后再刷新」。

证据补充：`isolate\iso2-title-ui-run1/2.txt`、`isolate\iso2-ui-tools-run1/2.txt`、`isolate\server-task10.out.log / server-task10.err.log`（0 字节，同前）、`isolate\shots\` 更新截图。

现场：复跑后源码实例已停止，**8099 空闲**；未触碰 dist（打包由 release-runbook-analyst 并行进行）。
