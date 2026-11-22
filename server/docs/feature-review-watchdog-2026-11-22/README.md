# 本地审查卡住 P0 —— 修复与验证（2026-11-22 夜）

> 结论:**P0 用户可见的「busy 卡死、按钮全灰」已确定性修复**（根因是前端未声明变量 + 两道看门狗兜底）；
> 但「Vulkan 原生层偶发彻底卡死」是更深一层问题，本轮真实复现了一次：前端能恢复界面，进程仍需重启（见第四节）。

## 一、根因（确定性）

`server/app.html` 的 `cwReviewCode()` 在 try 之前读未声明的 `lineCount` → `ReferenceError`；
抛出点在 `cwReviewBusy = true` / 计时器 / 「审查思路（思考中…）」之后、`finally` 之前 → busy 永不释放，
且**后端一次请求都没收到**。与 P0 现象逐条吻合（只有云端复审可用，因为它是另一个函数）。
详见 [root-cause.md](root-cause.md)。

**修复**：cwReviewCode 顶部 `const lineCount = code.split("\n").length;`（6148 行），6157/6178 两处统一引用。

## 二、防御层

| 层 | 位置 | 行为 | 探针 |
|---|---|---|---|
| F1 前端 SSE 空闲闸 | app.html `cwStreamSSE` | 120s 无任何数据/事件 → abort + 明确报错 + 400ms 保险丝强清 busy | probe-review-watchdog A |
| F1b 前端总时长闸 | app.html `cwRunReviewStream`（仅单文件审查） | `CW_REVIEW_MAX_MS=300000`：事件一直在流也不无限等 | probe-review-watchdog C |
| F1c 兜底保险丝 | app.html `cwReleaseOrphanBusy` | `unhandledrejection`/`error` 且 `cwSseActive===0` → 强制 `cwEndJob()`（防「busy=true 在 try 之前」的结构残根再犯） | probe-review-watchdog D |
| F2 后端生成停滞闸 | app.mjs `handleCodeReviewStream` | 思路阶段/JSON 阶段 120s 无 chunk → 504 error 事件 + 释放 codeJob 锁（`CODE_JOB_IDLE_TIMEOUT_MS`，env 可调） | probe-review-watchdog B |

边界：原生层把事件循环彻底卡死时，后端 JS 定时器发不出去（日志无「停滞」行），F2 不生效；
此时 F1 仍能让界面在 120s 内恢复并提示「请重启启动器」。进程级自动恢复（Launcher /health 看门狗）列为后续。

## 三、验证数字（2026-11-22 21:1x–21:3x，dist 实例 v1.10.0 + 真 4B）

| 项 | 结果 | 证据 |
|---|---|---|
| probe-review-watchdog（A/C/D/B） | **56 / 0** | `probe-review-watchdog.log` |
| probe-code-review-stream（含 Phi 切换） | **48 / 0** | `probe-code-review-stream.log` |
| probe-code-window-ui | **10 / 0** | `ui-batch.log` |
| probe-review-scroll | **10 / 0** | `ui-batch.log` |
| 手点等价 · 22 行 python（真实 4B UI） | **87.3s / 2 问题 / busy 释放 / 无看门狗** | `manual-reviews.log` |
| 手点等价 · 62 行 python（真实 4B UI，第 1 次） | 原生层在 JSON 阶段卡死；**176.5s 时 F1 空闲闸触发**，busy=false、按钮恢复、状态行明确 | `manual-reviews.log` |
| 手点等价 · 62 行 python（重启后重试） | **129.9s / 4 问题 / busy 释放 / 无看门狗** | `manual-62line-retry.log` |

- 断言口径：90 → **91** 个探针；全量 69 → **70** 条；断言 1468 → **1524**（+56）。
- 服务端：源码 ↔ dist `app.html` SHA256 `18FE45179BBCDE98D9B4F0B1D9B0CB997A36840612F97AF8450A8D684AADDDFE`、`app.mjs` `9806CC7CBA23A6F85B56F14EC4AE1E3EE435C70F46221161BF100D20C2649408` 一致。

## 四、真实复现记录（2026-11-22 21:26）

1. UI 手点 62 行 `python-115523-1.py`（4B）：第一阶段约 56s，进入「正在整理问题清单…」后 **120s 无任何事件**；
   总 176.5s 时 F1 空闲闸触发 → 状态行「审查失败：审查流 120 秒没有任何响应…」，`cwReviewBusy=false`、`#cwReview` 恢复「模型审查」。
2. 同时服务端已卡死：node CPU 236.5 → 239.5 秒/3s（持续跑），`/api/state`、`/health` 均 10s 超时；
   服务日志**没有** F2 的「停滞 120s 无输出」行 → 事件循环被原生层阻塞，JS 定时器发不出去。
3. 与今日 `feature-code-window-2026-11-22/ui-9b-file.log`（9B 80 行第二阶段 575s 不返回）同型：
   **P0 的底层触发是 Vulkan 原生层偶发卡死**，不是当日 UI/超时改动引入的。
   因此「回滚 17:30 后的审查改动」不会修好它；本轮的交付是把「卡死 → 界面永久锁死」降级为「120s 内明确报错 + 可重试」。
4. 重启发布包实例后再次手点 62 行（见 manual-62line-retry.log）；本机 9B/20B 审长代码仍不建议（既有约束）。

## 五、交付清单

- 改：`server/app.html`（根因 + F1/F1b/F1c）、`server/app.mjs`（F2）、`server/docs/run-full.ps1`（注册 1 行 + 恢复 UTF-8 BOM）。
- 新：`server/probe-review-watchdog.mjs`（56 条，A/C/D 纯 CDP + B 独立实例硬链接 4B）。
- 证据/工具：本目录 `root-cause.md`、`contract.md`、`sync-and-restart.ps1`、`run-probe-with-edge.ps1`、`run-ui-batch.ps1`、`run-manual-one.ps1`、`ui-review-once.mjs` 与各 `.log`。
- dist 已同步、8099 已重启（4B）。**未 commit、未打包**（按用户要求）。

## 六、踩坑记录（写进交接文档）

1. **UI 审查入口的异常会让 busy 永久卡死**：六个流程都是「先 busy=true、再初始化、最后才 try」；
   本轮 lineCount 就掉在这段。已加 `cwReleaseOrphanBusy` 兜底，但**新代码请尽量把 busy=true 移进 try**。
2. **后端 JS 定时器救不了原生层卡死**：事件循环不转时 setTimeout 不执行；判断方法 = 看 node CPU 是否持续涨 + `/api/state` 是否超时。
3. **Edge 158 headless 不接受命令行 URL**（`Multiple targets are not supported in headless mode`）：
   必须 about:blank 启动 + CDP `PUT /json/new?<url>`；`run-probe-with-edge.ps1` 已封装。
4. **PS 5.1 按 ANSI 解析 .ps1**：含中文的脚本必须 UTF-8 BOM；`run-full.ps1` 的 BOM 曾被编辑丢掉 → 30 个语法错。
5. **8199 端口可能被 DSH Desktop.exe 占用**：探针选端口要校验 `/api/state` 的响应内容，不能只看「有响应」。
6. **别把工具 read 的截断结果当全文写回**：本目录写入日志时，read 默认只回前 2000 行 / 64KB，被当成全文 `write` 回日志 → 截掉 3437 行。已用 DSH session transcript（`harness\sessions\--D-LocalModels--\<id>\session.v4.jsonl.zstd`，逐帧 zstd 解压）里 write 工具的 `meta.diffs[0].oldText` 完整恢复，`git diff --numstat` = **253 insertions / 0 deletions**（原文零丢失）。以后长文件追加：核对 `totalLines`，或用 `edit`（old_string=末尾几行）/ shell 追加重定向。
