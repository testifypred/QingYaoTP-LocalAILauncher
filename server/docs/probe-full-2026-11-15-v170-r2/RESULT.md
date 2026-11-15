# v1.7.0 全量回归（62 条）

- 时间：2026-11-15 16:19 → 16:41（r2；r1 因服务被 Phi-4-mini 卡死作废，见下）
- 环境：`node app.mjs`（dev v1.7.0，MODEL_DIR=仓库根）+ headless Edge 9333（视口 1408×723）+ 会话从 `server\docs\session-backups\20261115-123436\` 恢复（8 个真实会话）
- 驱动：`server\docs\run-full.ps1`（**62 条**，断言口径 **1137**；本轮新增 probe-code-review-stream 45（跳过 3：Phi 切换）/ probe-code-panel-v2 40 / probe-tui-tools 23，且 code-workspace、code-panel 各跳过 1 条已加载模型分支 → 1031 + 108 − 2 = 1137）

## 结果：**62 条全绿，0 红**（exit 0，FULL SUITE DONE）

## r1 作废原因（重要，别再踩）

- r1（`probe-full-2026-11-15-v170-r1-polluted`）跑到 `probe-code-review-stream` 时 8099 **整体卡死**：日志显示 `代码审查：切换到模型 Phi-4-mini` → `就绪 8.7s` → 之后生成不返回、/api/state 全超时、CPU 持续上涨。
- 定性：**Phi-4-mini 在 Vulkan 上做审查会偶发原生层卡死**（加载日志有 `load_arch_hparams: Phi SWA is currently disabled`）；隔离单跑同一请求 22.3s 能过 → 偶发，不是本轮代码逻辑 bug。
- 处理：① review/fix 生成加 AbortController 超时（默认 300s，`CODE_JOB_TIMEOUT_MS` 可调）；② 全量驱动注入 `PROBE_SKIP_SWITCH=1` 跳过 Phi 切换（隔离跑仍覆盖 48/48）；③ 文档写明「别用 Phi-4-mini 做审查模型」。
- 另：r1 时驱动误判「服务已退出」后尝试重启，撞上原进程还在 → `EADDRINUSE`；驱动自身的 Ensure-Server 只按 /api/state 超时判断，遇到「服务活着但卡住」会误判，这条也记进 technique/07。

## 本轮新增探针（全量内成绩）

| 探针 | 结果 |
|---|---|
| `probe-code-review-stream` | **45 / 45**（跳过 3 = Phi 切换；隔离不带开关 48/48） |
| `probe-code-panel-v2` | **40 / 40** |
| `probe-tui-tools` | **23 / 23** |

## 其它证据

- 后端冒烟：`feature-code-review-terminal-2026-11-15\lead-smoke-code.out.txt`（25/25）
- 并发互斥：`concurrency-check.out.txt`（7/7）
- 代码面板真跑：`codeui-RESULT.md`（33/33）、`codeui-cdp-check-lead.out.txt`
- TUI：`tui-verify-0*.txt`（selftest 29 项、伪终端 12/12、--hint-test、--plain）
- 逐条日志：`logs\*.out.txt`；截图：`shots\`