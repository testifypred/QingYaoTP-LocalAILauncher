# 本地审查卡住 P0 —— 修复契约（2026-11-22 夜）

> Lead 与三名队员共读。**只改自己任务写明的文件**；不要 commit、不要同步 dist、不要重启 8099、不要跑全量、不要改日志/文档。

## 背景（P0）

4B 审 22 行 python 偶发 >360s 无 findings：页面停在「模型正在结合意图读代码… / 审查思路（思考中…）」，`cwReviewBusy` 一直 true → 质询 / 他人复审 / 一键纠正 / 重新审查全禁用，只有云端复审可用。

根因方向（已知）：Vulkan 原生层偶发卡死，服务端可能长时间没有 delta；前端 fetch/SSE 读取没有超时，于是 busy 永不释放。
今日 20:47 首次复现尝试：22 行文件 40s 正常完成（0 问题）→ **时好时坏**，所以修复按「防御 + 确定性探针」交付。

## 三层防御

| 层 | 文件 | 作用 |
|---|---|---|
| F1 前端 SSE 空闲看门狗 | `server/app.html` | 120s 没有任何 SSE 事件 → abort，界面必须恢复（busy=false、按钮可点、明确报错） |
| F2 后端生成空闲看门狗 | `server/app.mjs` | 审查第一阶段 120s 没有 delta → abort + `error` 事件（504），释放 `codeJob` 锁 |
| F3 探针 | `server/probe-review-watchdog.mjs` | 确定性验证 F1（页面 stub 挂死流）与 F2（独立实例 + 1s 空闲阈值） |

## F1（server/app.html）精确要求

1. 新增**可变**顶层变量（探针要覆盖它，不能用 const）：
   ```js
   let CW_SSE_IDLE_TIMEOUT_MS = 120000;
   ```
2. 在 `cwStreamSSE(url, payload, handler, signal)` 内部实现（**不要改签名、不要改 6 处调用点**）：
   - 内部自建 `AbortController`，与传入的 `signal` 组合：外部 abort（用户点「停止」）时内部也 abort，调用方仍看到 `AbortError`（保持「已停止」分支不变）。
   - 空闲计时器：收到响应头后启动；**每读到一块数据 / 每个解析出的 SSE 事件都重置**。
   - 空闲超时：置 `idleFired=true` 后 abort，并抛出一个 name 不是 `AbortError` 的 Error，消息必须**包含**：
     ```
     审查流 120 秒没有任何响应（本地模型可能卡死）：可改用云端复审；若其它本地功能也无响应，请重启启动器
     ```
     （秒数按 `CW_SSE_IDLE_TIMEOUT_MS/1000` 取整拼接；探针只断言包含「没有任何响应」）
   - 无论成功/失败/用户停止，定时器必须在 finally 里清掉。
3. 保险丝：空闲 abort 后 400ms，若 `cwReviewBusy` 仍为 true，调用现有 `cwEndJob()` 强制释放（它已含停表 + busy=false + 刷新按钮），并把状态行写成 `审查失败：审查流 120 秒没有任何响应…`（err）。
4. 六条 SSE 流程（review / multi / fix / challenge / cross / cloud）都靠现有 finally 清 busy，不要改它们；F1 只动 `cwStreamSSE` + 顶部变量 + 保险丝函数。
5. 不引入任何第三方库、不调模型；保持既有文案/行为。

## F2（server/app.mjs）精确要求

1. 新增常量（放在 `CODE_JOB_TIMEOUT_MS` 附近）：
   ```js
   /** 生成「停滞」看门狗：超过这么久没有任何 delta 就掐掉（原生层卡死的兜底）；探针会把阈值降到 1s */
   const CODE_JOB_IDLE_TIMEOUT_MS = Math.max(1000, Math.min(300000, Number(process.env.CODE_JOB_IDLE_TIMEOUT_MS) || 120000));
   ```
2. 只改 `handleCodeReviewStream`（单文件审查）：
   - 第一阶段（思路流式）：`ac = new AbortController()` 后启动 idle timer（初始即计时），`onResponseChunk` 里每个 chunk 重置；总超时 watchdog 保留。idle 触发时 `ac.abort(codeJobError(504, 消息))`，消息必须**包含**：
     ```
     审查生成 120 秒没有任何输出（本地模型可能卡死）：请重启启动器后重试，或改用云端复审
     ```
     （秒数按 `CODE_JOB_IDLE_TIMEOUT_MS/1000` 取整）
   - 第二阶段（整理 JSON）：现有 240s 总超时保留；再加一个同样的 idle timer（用 `onResponseChunk` 只重置不转发），阈值同 `CODE_JOB_IDLE_TIMEOUT_MS`，触发消息 `审查结论整理 120 秒没有任何输出（本地模型可能卡死）`。
   - 两个 timer 都要在对应 finally 里 clearTimeout；不要改变事件顺序/契约、不要动 multi/fix/challenge/cross。
   - abort 的 reason 会原样从 node-llama-cpp 抛出（已确认 dist 里 `throw abortController.signal.reason`），所以现有 `e?.status || 500` 路径会给 504 + `error` 事件；`finally` 里 `res.end()` 释放 SSE。
3. 日志在 idle 触发时记一行（便于现场判断）：`log("代码审查(流式) " + (file || "未命名") + " 停滞 " + ... + "s 无输出，已中止")`。
4. 不新增模块、不改打包清单。

## F3（server/probe-review-watchdog.mjs + run-full.ps1）精确要求

新探针 `node probe-review-watchdog.mjs [cdp] [base]`，A 段纯 CDP、B 段自起实例；全绿 exit 0。

**A. 前端看门狗（不调模型）**
- 打开 `#codeModal`（参照 probe-review-scroll 的 pageSetup 做法），用 CodeMirror `setValue` 填一段代码；确认 `cwReviewBusy` 可读写。
- `CW_SSE_IDLE_TIMEOUT_MS = 2500`（探针覆盖）。
- 用页面内 stub 替换 `window.fetch`：对 `/api/code/review/stream` 返回一个只 push 一条 `meta` 事件后**永不 close、不再 push** 的 `ReadableStream` Response；其它 URL 走原 fetch。
- 调 `cwReviewCode()` 并等待其 Promise（CDP awaitPromise）。
- 断言（建议 6 条）：① 全程 < 12s；② `cwReviewBusy === false`；③ `#cwReview` 不再 disabled 且文案是「模型审查」；④ `#cwReviewState` 文本包含「没有任何响应」；⑤ 无 JS 异常（Runtime.exceptionThrown 只在 A 段收集）；⑥ 收尾恢复 fetch / 超时变量 / 关闭面板。
- **不要**触发真实模型请求；探针自己负责 finally 恢复 `window.fetch`。

**B. 后端空闲看门狗（确定性，~60s）**
- 在 `D:\LocalModels\server\docs\feature-review-watchdog-2026-11-22\` 下建临时模型目录（同盘才能硬链接），`fs.link` 把 `D:\LocalModels\qwen3-5-4B-Q4_K_M.gguf` 链进去（只链 4B；不复制 2.5GB）。
- 选一个空闲端口（8198 起探测，最多试 8205），`spawn(process.execPath, ["app.mjs"], {cwd: D:\LocalModels\server, env: {...process.env, PORT, MODEL_DIR: tempModelDir, CODE_JOB_IDLE_TIMEOUT_MS: "1000"}})`，stdout/stderr 落临时文件。
- 等 `/api/state` 200；POST `/api/load` 载入 4B（等 loaded）。
- POST `/api/code/review/stream`（22 行 python 代码，从 `workspace\code\python-210407-1.py` 读或内联），读 SSE：
  ① HTTP 200 且第一事件是 meta；② 断言收到 `error` 事件且消息包含「没有任何输出」；③ 全程 < 60s（阈值 1s，正常 ~2-5s）；④ 没有 findings/done；⑤ 之后 POST `/api/load` 同模型返回 **200**（证明 codeJob 锁已释放，不是 409）。
- finally 一定 kill 子进程 + 删临时目录（含硬链接，不能误删真实 gguf）。
- 加 1 条收尾断言：临时目录已清理、子进程已退出。

**注册**：`server/docs/run-full.ps1` 的 `$probes` 里加一行（放在 probe-code-review-stream 之后）：
`@{n='probe-review-watchdog'; a=@($cdp,$base); t=240},`
只加这一行，别动别的。

## 验证与交接

- F1：`node --check` 不适用（内联）；由 F3 A 段 + Lead 的界面探针验证。
- F2：`node --check server\app.mjs`；由 F3 B 段验证。
- F3：先等 Lead 通知「dist 已同步、8099 已重启、前端/后端已落地」再跑；跑通后把日志写进证据目录。
- 报告给 Lead：改了哪些行/函数、探针输出（通过数）、已知风险、是否碰了范围外文件。

## 边界（硬）

- 只改自己任务列的文件；不 commit / 不 git add / 不打包 / 不同步 dist / 不重启 8099 / 不改 `DeveloperRealtimeLog.md` `新会话启动词.md` `technique\*`。
- 探针、日志只追加；临时文件全部清理。
- 遇到与本契约冲突的实现细节：以「界面必须恢复、后端必须释放锁」为准，并在报告里说明偏差。
