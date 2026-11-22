# P0 根因与修复（2026-11-22 夜）

## 一、根因（已确认，确定性）

`server/app.html` 的 `cwReviewCode()` 在 **try 之前** 读了一个未声明的变量 `lineCount`：

```js
// 修复前（行号 ≈6175，工作树 = 今日未提交改动）
if (lineCount > 60 && code.length <= 8000) {
  payload.max_tokens = 800;
  payload.json_max_tokens = 500;
}
```

- 整份 app.html 没有 `lineCount` 声明（只有 CodeMirror 的 `cm.lineCount()` 方法）；经典脚本里读取未声明标识符 → **ReferenceError**。
- 抛出点在 `cwReviewBusy = true`（≈6160）、`cwReviewStartTimer`（≈6171）、`cwThinkBegin('审查思路（思考中…）')` 之后，而在 `try { ... } finally { cwReviewBusy = false }` **之前** → finally 永不执行。
- 结果与用户 P0 现象逐项吻合：
  1. 页面停在「模型正在结合意图读代码…」+「审查思路（思考中…）」；
  2. `cwReviewBusy` 永远 true → 质询 / 他人复审 / 一键纠正 / 重新审查全部禁用；
  3. **后端 /api/code/review/stream 一次请求都没收到**（服务日志没有对应审查行）→ 与「>360s 没有 findings」一致；
  4. 只有云端复审可用——`cwCloudSend` 是另一个函数，不经过这段代码；
  5. 「时好时坏」是假象：UI 路径必崩；当天通过的 48/48、30 行 111s、80 行 210s 都是 API/探针脚本（不走 cwReviewCode），所以能过。
- 引入时间：当天 17:30 之后的「审查超时放宽 + max_tokens/json 预算」编辑；同一轮把 6154 行的 `code.split("\n").length` 换成 `lineCount` 时漏了声明（分段审查在 18:18-18:39 的 UI 实测里还能跑，说明该 bug 出现在那之后）。

**修复**：`cwReviewCode()` 顶部（`const code = cwValue()` 空值校验之后）加
`const lineCount = code.split("\n").length;`，6157 / 6178 两处统一引用。

## 二、防御层（即使以后原生层再卡死，界面也能恢复）

| 层 | 位置 | 行为 |
|---|---|---|
| F1 前端 SSE 空闲看门狗 | `app.html cwStreamSSE` | 120s 没有任何数据/事件 → abort + 抛「审查流 120 秒没有任何响应…」；400ms 保险丝若 busy 未释放则 `cwEndJob()` 强制释放 |
| F1b 前端单次审查总时长闸 | `app.html cwRunReviewStream` → `cwStreamSSE(..., {maxMs})` | `CW_REVIEW_MAX_MS=300000`：事件一直在流但总时长失控也在 300s 收口（只作用于单文件审查，不影响质询/复审/云端） |
| F2 后端生成停滞看门狗 | `app.mjs handleCodeReviewStream` | 第一阶段 120s 无 delta / JSON 阶段 120s 无 chunk → abort(504) + `error` 事件 + 释放 `codeJob` 锁（`CODE_JOB_IDLE_TIMEOUT_MS`，env 可调，下限 1s 供探针） |
| 兜底 | —— | 原生层彻底卡死（事件循环不转）时 JS 定时器发不出：前端看门狗仍能恢复界面；后端只能重启进程（见「后续」） |

## 三、证据

- 探针实跑（headless Edge 158，修复前页面）：`cwReviewCode()` 立刻抛 `ReferenceError: lineCount is not defined`，busy 卡 true，`cwStreamSSE` 未执行（probe-review-watchdog A/C 段 9 条失败全部同因）。
- 用户现场 UI 证据 `feature-code-window-2026-11-22/ui-9b-file.log`：9B 80 行分段审查第二阶段停在「正在整理问题清单…」到 575s —— 这是**另一种**真卡死（后端事件循环不转），与根因 1 不同，由 F1 兜底（见第四节）。
- 基线（修复前 dist 实例、真实 4B、API 直连，不走 UI）：
  | 文件 | 行数 | 结果 | 耗时 |
  |---|---|---|---|
  | python-210407-1.py | 22 | 0 问题 | 40.1s |
  | python-210407-1.py | 22 | 1 问题（deltas=1200 顶满） | 130.6s |
  | python-115523-1.py | 62 | 6 问题 | 137.6s |
  3/3 完成、0 卡死 → 说明 API 链路正常，问题在 UI 入口（即根因 1）。

## 四、已知边界 / 后续候选

1. **真原生层卡死**（`/api/state` 也超时、CPU 持续涨）时前端能恢复界面，但后端进程已死，任何本地功能都要重启启动器；
   现有日志 `ui-9b-file.log` 就是这种。后续可在 `Launcher.cs` 加「/health 连续 N 秒无响应 → 杀 node 并自动重启」的进程级看门狗（本轮不做：要重编 exe、用户本轮要求不打包）。
2. 9B/20B 仍不建议审长代码；审查长代码用 4B（既有约束不变）。
3. F2 目前只覆盖单文件审查；多文件 `/api/code/review/multi` 的逐文件阶段仍只有 240s 总超时，可下一轮补同款 idle 看门狗。

## 五、真实复现记录（2026-11-22 21:26，修复上线后）

- 手工等价点击 62 行 `python-115523-1.py`（真 4B、dist 实例）：第一阶段约 56s，进入「正在整理问题清单…」后 120s 无任何事件；
  总 176.5s 时 F1 空闲闸触发 → 状态行「审查失败：审查流 120 秒没有任何响应…」，`cwReviewBusy=false`、按钮恢复。
- 同一时刻服务端已卡死：node CPU 236.5 → 239.5 秒/3s（持续涨），`/api/state`、`/health` 均 10s 超时；
  服务日志**没有** F2 的「停滞 120s 无输出」行 → 事件循环被原生层阻塞，JS 定时器发不出去。
- 与今日 `feature-code-window-2026-11-22/ui-9b-file.log`（9B 80 行第二阶段 575s 不返回）同型：
  P0 的底层触发是 Vulkan 原生层偶发卡死，**不是当日 UI/超时改动引入的**；回滚 17:30 后的改动不会修好它。
  本轮交付把「卡死 → 界面永久锁死」降级为「120s 内明确报错 + 可重试」；进程级自动恢复列为后续（Launcher /health 看门狗）。
