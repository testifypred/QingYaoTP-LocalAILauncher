# 交接补充 · 2026-11-22 夜（P0：本地审查卡住）

> 给下一个会话的短版交接。主文档仍是 `新会话启动词.md` / `交接文档.md` / `DeveloperRealtimeLog.md`（第八十节）。

## 一、当前版本 / 状态

- 版本：**v1.10.0**（未发版；今日所有改动**未提交 Git、未重打包**）。
- 8099 跑的是 dist 发布包实例（源码已同步 dist）；最近一次重启后加载 **4B**。
- 今日已完成：TUI 2.0.0、主页面输出优化、20B `useMmap:false` 修复、代码工作区 UI（可拖拽/最大化/分隔条/结果标签/他人复审兜底）、审查面板滚动修复。
- 全量口径：**90 个探针 / 69 条 / 1468 断言**（run-full.ps1 已注册；最近通过：probe-code-review-stream 48/48、probe-code-window-ui 10/10、probe-review-scroll 10/10）。

## 二、P0：本地模型审查卡住（未解决）

**现象**：4B 审 22 行 python 文件，`/api/code/review/stream` 超过 360s 没有 findings；页面停在「模型正在结合意图读代码…」和「审查思路（思考中…）」，`cwReviewBusy` 一直 true，导致质询 / 他人复审 / 一键纠正 / 重新审查全部禁用。只有**云端复审**还能用（不依赖本地模型）。

**已确认**：服务在跑、4B 已加载、普通 `/v1/chat/completions` 正常；当天早些时候 4B 审 30 行 111s、80 行两段 210s、probe-code-review-stream 48/48 都通过；9B 审小段 18.3s 正常。→ 时好时坏，疑似 Vulkan 原生层卡死 + 最新审查改动（600s/240s 超时、collect 模式、max_tokens/json 预算）叠加。

**下一步（按顺序）**：
1. 前端 watchdog：`cwRunReviewStream` 里 120s 无任何 SSE 事件就 abort，并强制 `cwReviewBusy=false`；
2. 后端首字 watchdog：90–120s 无 delta 就 abort 并回 `error`；
3. 若仍复现：回滚 17:30 之后的审查相关改动，先恢复可用再逐项加；
4. 回归：`probe-code-review-stream`（短代码 48 条）→ 手点 22 行 / 80 行 → 全量 69 条。

**临时绕过**：云端复审；重启服务后先审小文件；**不要用 9B 审长代码**（81 行实测必卡）。

## 三、证据 / 文件

- 证据目录：`server\docs\feature-code-window-2026-11-22\`（含 `test-review-22line.mjs`、`ui-chunked.log`、`ui-9b-file.log`、`contract.md`）
- 今日其它证据：`feature-stream-perf-2026-11-22\`（输出优化 / 20B mmap）、`feature-tui-v2-2026-11-22\`（TUI）、`feature-review-scroll-2026-11-22\`（滚动）。
- 审查相关代码：`app.mjs` 的 `handleCodeReviewStream`（600s/240s/json_max_tokens）、`app.html` 的 `cwReviewCode` / `cwRunReviewStream` / `cwRecordLocalResult` / `#cwUse4B`。

## 四、硬约束提醒

- 探针、日志只追加；改完先跑目标探针，再考虑全量；dist 要同步；交付用 zip；重启先杀启动器；GitHub push 走 SSH over 443；CI 的 PowerShell 步骤只许 ASCII；本轮用户要求不推 Git。

## 五、后续更新（2026-11-22 深夜：P0 已修，本文件第二节作废）

- **根因**：`app.html` 的 `cwReviewCode()` 在 try 之前读未声明的 `lineCount` → `ReferenceError`；
  抛出点在 `cwReviewBusy=true` / `cwThinkBegin('审查思路（思考中…）')` / `cwReviewStartTimer` 之后、`finally` 之前 →
  busy 永久 true、按钮全灰，**后端一次请求都没收到**（服务日志没有审查行；云端复审是另一函数所以可用）。
  当天 48/48、111s、210s 等「通过」都是 API/探针脚本，不走 `cwReviewCode`，所以「时好时坏」是假象。
- **修**：`cwReviewCode` 顶部 `const lineCount = code.split("\n").length;`；另加三道前端闸（SSE 空闲 120s / 单次审查总时长 300s / unhandledrejection 兜底 `cwReleaseOrphanBusy`）+ 后端生成停滞闸（`CODE_JOB_IDLE_TIMEOUT_MS=120000`，error 504 + 释放 codeJob 锁）。
- **回归数字**：`probe-review-watchdog` **56/0**、`probe-code-review-stream` **48/0**、`probe-code-window-ui` **10/0**、`probe-review-scroll` **10/0**；手点 22 行 **87.3s / 2 问题**、62 行 **129.9s / 4 问题**。全量口径 **70 条 / 1524**。
- **底层仍有**：Vulkan 原生层偶发彻底卡死（2026-11-22 21:26 用 62 行 4B 实测复现：178s 时前端空闲闸恢复界面，但 node 事件循环已死 → 重启后重试通过）。下一步可给 `Launcher.cs` 加 `/health` 进程级看门狗（本轮未做，用户要求先不打包）。
- 证据：`server\docs\feature-review-watchdog-2026-11-22\README.md` / `root-cause.md`；日志第八十一节。
- **未 commit、未打包**（用户本轮要求）；dist 已同步（app.html `18FE4517…`、app.mjs `9806CC7C…`），8099 已重启并加载 4B。

## 六、v1.11.0 发布（2026-11-22 深夜）

- 版本：**v1.11.0**（app.mjs / package.json / localai.mjs 一致；TUI 2.0.0 解耦）。
- 全量：70 条 / 1524 断言，整跑 64 绿 + 6 红 → **隔离复跑 6/6 全绿（有效 70/70）**；证据 `server\docs\probe-full-2026-11-22-v111-r2\`。
- 打包：`258.8MB / 3448 文件` → `dist\QingYaoTP-AILauncher-v1.11.0.zip` **127,961,662B / 122.0MB / 3,948 条目 / SHA256 `18B83B2920DF2617CC6D72EE39F900095648D33568C14C10F42BEF63ECCA7932`**。
- 发布包冒烟：version 14/14、debug 54/54、readme 21/21、window-ui 10/10、panel-v2 44/44、stream 45/45（跳 3：Phi 切换）、watchdog 56/56 → failed=0。
- 8099 已切回发布包实例 v1.11.0（dist\app；4B ctx=16384；视觉增强包 source=pack / 53 文件）。
- GitHub Release v1.11.0：正文 `.github/RELEASE-v1.11.0.md`，附件主包 + 视觉增强包；tag `v1.11.0`。
