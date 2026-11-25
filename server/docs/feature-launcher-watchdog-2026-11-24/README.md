# 启动器 /health 进程级看门狗（2026-11-24）

> 承接 2026-11-22 的 P0 修复（本地代码审查卡死）与 2026-11-23 的许可证落地（Apache-2.0）。
> 本轮用户交接要求：**不推 Git、不打包、不发布**；改完跑目标探针。本目录是这项改动的全部证据。

## 一、为什么做

P0 修完后，界面层已经有「120s 空闲闸 + 300s 总时长闸 + 结构兜底」，能把「卡死 → 界面永久锁死」降级成「明确报错 + 可重试」。但底层问题仍在：

- Vulkan 原生层**偶发彻底卡死**：node 事件循环不转（/health、/api/state 全超时、CPU 持续涨），后端 JS 定时器发不出去，前端只能提示「请重启启动器」；
- 2026-11-22 21:26 用 62 行 4B 实测复现：第 1 次卡死、重启后第 2 次 129.9s 通过；9B 审长代码同型。

启动器是 node 的父进程，天然适合做**进程级外部看门狗**：前端救不了进程，启动器可以。

## 二、设计（server/launcher/Launcher.cs，+287 / −17 行）

| 机制 | 行为 |
|---|---|
| 健康探测 | 后台线程 WatchdogLoop，每 5s 请求 /health（3s 超时，Ping(int) 重载） |
| 判死 | 连续 90s 无响应（从第一次失败起计时）→ 判定卡死 |
| 自愈 | WatchdogRestart：杀本启动器拉起的 node（Server.Kill + 5s 等待，失败兜底 server.pid）→ LaunchNode → WaitForServiceQuiet（≤120s）→ 托盘气泡 + 内嵌 WebView2 重载首页（仅界面开着时）→ 继续监控 |
| 互斥 | Restarting 标志 + RestartGate 锁，与既有 Server.Exited 崩溃守护互斥；Exited 回调改用 **sender 引用比较** 过滤「已被看门狗替换掉的旧进程」的迟到事件 |
| 不误拉起 | 用户主动停服务（--stop / 托盘「停止服务」/ 界面退出）→ 退出码 0 → ServiceStopped=true → 看门狗跳过（日志 skip reason=user-stopped）；Stopping 期间同样跳过 |
| 宽限期 | HealthGraceUntil：启动/重启后 60s、就绪后 10s、重启过程 120s，防启动期误杀 |
| 重启风暴保护 | 30 分钟内最多自动重启 **5 次**；超出暂停 10 分钟 + 托盘警告（避免反复卡死时无限重启拖垮机器） |
| 可关闭 / 可测 | LOCALAI_WATCHDOG=0 关闭；LOCALAI_WATCHDOG_INTERVAL_MS / _TIMEOUT_MS / _STALL_MS 覆盖参数（探针缩短到秒级）；LOCALAI_LAUNCHER_INSTANCE 给单实例 mutex / 命名管道加后缀（测试实例不抢常驻实例） |
| 非本启动器拉起的 node | 只日志 + 托盘提示，**不杀**（避免误杀调试/手动实例） |
| 日志标签 | [watchdog] start/stall/restart reason=stalled pid=/restarted pid=/skip reason=user-stopped/pause/error；[guard] node-exit/restarted attempt=（机器可 grep） |

## 三、代码 / 编译

- 改：server/launcher/Launcher.cs（+287 / −17；SHA256 E64EB2DA734652475D00F1F6B7F005A3ADAE96E5E9EF96B31A8A67BA9E126D77，46,310B）——**未提交 Git**（按用户要求）。
- 编译必须用与 server/build-portable.ps1 第 284–291 行**同一 csc 命令**（图标 server/localai.ico、清单 server/launcher/app.manifest、WebView2 两个引用）。本目录的 launcher-v1.11.0-backup.exe 是换装前的旧 exe（v1.11.0 构建，57,856B，SHA256 FD45E174…），用于回滚。
- 新增 exe：**64,000B / SHA256 8940A4BE33DB05822F423363E783ECBF9B5E2140BC9568C8F6940C1B56AA4319**（win32icon/win32manifest 一致）。

## 四、验证

### 4.1 端到端测试（本目录 verify-watchdog.ps1，24 / 0）

装置：临时目录 + fake-app.mjs（只实现 /health、/api/state、/api/shutdown，启动时写 app\server.pid）+ 复制 runtime\node.exe + 测试 config（stall=6s / interval=1s / timeout=0.8s，LOCALAI_LAUNCHER_INSTANCE=probe-watchdog，端口 8399）。**用 NtSuspendProcess 挂起 node 模拟原生层卡死**（等价于事件循环不转）。

| 段 | 断言 | 结果 |
|---|---|---|
| S | 假服务独立可用 | PASS |
| A1–A6 | 启动健康 / node pid / --status 0 / 过 grace 后健康 / **20s 无假重启（pid 不变）** / 日志无 restart | 全 PASS |
| B0–B5 | 挂起 node → health 超时 / 看门狗 6s 判定 / 旧进程消失 / 新 pid 恢复健康 / 日志 restart reason=stalled + restarted pid=<新 pid> | 全 PASS（old=4740 → new=15836） |
| C1–C5 | --stop 退出码 0 / node 退出 / 服务保持停机 / **15s 观察不被看门狗拉起** / 日志 skip reason=user-stopped | 全 PASS |
| D1–D5 | 重新启动 / 强杀 node（非 0 退出码）→ Exited 守护重启 1 次 / **只剩 1 个 node** / 日志 [guard] restarted attempt= / 看门狗不双重启 | 全 PASS |

运行记录：launcher-watchdog-e2e.log（launcher.log）、fake-app.log（node stdout）。

### 4.2 独立验证（已完成，2026-11-24 23:33–23:52）

独立验证员（verifier-wd，未参与实现）用修正后装置重做：**桌面 0 弹窗**、**24/24 PASS**、场景 E（`LOCALAI_WATCHDOG=0`，挂起 node 25s 不重启）**15/15**、场景 F（默认 5s/3s/90s 健康观察 75s）**13/13**；未发现阻断问题（1 中 + 4 低，建议下轮加固）。重编译 exe 64,000B / SHA256 `B813510C…`（与 dist 换装 exe 字节一致、哈希不同属 csc 时间戳/MVID 不可复现）。

装置要点（与上轮作废装置的区别）：测试 exe 同目录带齐 `server/launcher/webview2` 3 个 DLL；用 .NET `ProcessStartInfo{UseShellExecute=false}` 启动（不用 ShellExecute，避免「未知发布者」）；`--start-hidden` + 端口 8398 + `LOCALAI_LAUNCHER_INSTANCE=verify-wd`；临时目录跑完删除。

详见 [independent-verification.md](independent-verification.md)。审查问题摘要：中-1「看门狗与 Exited 守护双重启窄竞态（取锁后未复检 Restarting / 宽限期）」；低-1「WaitForServiceQuiet 偶发 1s 内误报未就绪」；低-2「ReloadUiAfterRestart 缺 DLL 时 .NET 弹窗风险」；低-3「HealthGraceUntil 非 volatile」；低-4「风暴保护只覆盖 watchdog 路径」——都不阻断，列入下轮加固。

### 4.3 发布包实例回归（dist，换装后）

- 8099：/api/version = 1.11.0 / dir = dist\QingYaoTP AILauncher\app；/api/state loaded = qwen3-5-4B-Q4_K_M.gguf、context=16384、gpu=vulkan；视觉增强包 source=pack / 53 文件。
- probe-version **14/14**、probe-debug **54/54**。
- dist\logs\launcher.log：2026-11-24 00:01:13  [watchdog] start interval=5s timeout=3s stall=90s，启动后无 restart 行。

## 五、换装 / 回滚（本机 dist）

换装步骤（已执行，2026-11-24 00:00）：

1. dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe --stop（优雅停 node，退出码 0）
2. 杀常驻 launcher（否则 exe 被锁，**必须**）：Get-Process QingYaoTP AILauncher | Stop-Process -Force
3. 复制新 exe 覆盖；双击 / Start-Process 启动（会自动拉起 node + 加载 autoLoad 模型 + 开窗）
4. 校验 /health、/api/version、/api/state、/api/vision/pack，并看 logs\launcher.log 的 [watchdog] start

回滚：把本目录 launcher-v1.11.0-backup.exe 复制回 dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe，同样先 --stop + 杀常驻 launcher 再启动。

## 六、已知边界 / 后续

1. **没注册进全量驱动** server/docs/run-full.ps1：全量探针是 .mjs + 表格驱动，本项是 PS1 端到端（需要挂起进程/独立 launcher 实例），暂作独立回归项；全量口径仍 **91 探针 / 70 条 / 1524 断言**。后续可包一层 probe-launcher-watchdog.mjs 再登记。
2. **只杀 node 本体**（Process.Kill，不含子进程树）。极少数情况下卡死时视觉 sidecar 仍在跑，重启后 8101 可能被占；先记录，不阻塞，必要时改 taskkill /T。
3. **非本启动器拉起的 node 不杀**（只提示）。开发态 node server\app.mjs + 启动器同时存在时，看门狗只能告警。
4. **90s 阈值**：生成/加载期间 /health 正常可响应，独立验证做了健康长观察无误杀；建议真实使用观察 1–2 天，再决定是否收紧到 60s（交接建议区间 60–90s）。
5. **dist 只是换 exe**：app 文件未变，未重新打包；LICENSE/NOTICE/THIRD_PARTY_NOTICES 仍只在本机 dist 与仓库，**已发布的 v1.11.0 zip 仍不含许可文件**——需用户批准后打 v1.11.1。
6. **测试副本必须同目录带 webview2 DLL**（教训，2026-11-24）：只复制 exe 到临时目录再启动，看门狗重启后会走到 `ReloadUiAfterRestart` → 触碰 WebView2 类型 → .NET「未能加载程序集 Microsoft.Web.WebView2.WinForms」弹窗；同时无签名测试 exe 从临时目录启动会弹 Windows「未知发布者」。这类弹窗会盖在用户桌面上，看起来像产品故障——以后端到端测试要么带齐 DLL，要么别在用户桌面反复起 GUI 测试实例。

## 七、证据文件

| 文件 | 说明 |
|---|---|
| verify-watchdog.ps1 | 端到端测试脚本（ASCII；PS 5.1；改 root/端口后可复用） |
| fake-app.mjs | 假服务（/health /api/state /api/shutdown + server.pid） |
| test-instance-config.ini | 测试实例 config.ini（port=8399） |
| launcher-watchdog-e2e.log | 24/24 那次的 launcher.log |
| fake-app.log | 假服务 stdout（launcher 落盘） |
| launcher-v1.11.0-backup.exe | 换装前旧 exe（回滚用） |
| independent-verification.md | 独立验证报告（重编译 + 24 项复跑 + E/F 场景 + 代码审查 + 清理证明；2026-11-24 重做） |
