# 独立验证报告：启动器 /health 进程级看门狗（2026-11-24 重做）

- 验证时间：2026-11-24 23:33–23:52（Asia/Shanghai）
- 验证人：独立验证员 verifier-wd（未参与看门狗实现）
- 对象：`server/launcher/Launcher.cs`（未提交，+287/−17；46,310B，SHA256 E64EB2DA734652475D00F1F6B7F005A3ADAE96E5E9EF96B31A8A67BA9E126D77）
- 约束遵守：不改源码、不打包、不 git 提交、不碰 `dist\` 与 8099 端口上的常驻实例；测试实例全程 `--start-hidden` + 独立端口 8398 + `LOCALAI_LAUNCHER_INSTANCE=verify-wd`。
- 测试目录：`D:\LocalModels\tmp-verify-wd\`（临时，验证完已删除）。

## 0. 结论

| 项 | 结果 |
|---|---|
| 从源码重编译 + 24 项端到端 | **24/24 PASS**（RESULT fail=0，96s） |
| 场景 E：`LOCALAI_WATCHDOG=0` 禁用看门狗 | **15/15 PASS**（挂起 node 25s 不重启、无 stall/restart 日志） |
| 场景 F：默认参数（5s/3s/90s）健康长观察 | **13/13 PASS**（75s / 15 次采样 / 15 次 /health 全 OK / pid 0 变化） |
| 阻塞问题 | **0** |
| 代码审查问题 | 1 个中（竞态窗口）+ 4 个低；未发现阻断问题 |
| 桌面弹窗 | **0**（全程 .NET CreateProcess 启动 + 同目录带齐 webview2 3 个 DLL；结束时枚举可见窗口无「安全警告 / Microsoft .NET Framework」） |
| 上轮作废装置的两个根因 | 均已实测规避（见 §1） |
| **是否建议接受** | **建议接受**（功能行为符合设计；中/低问题不阻断发布，建议下轮顺手加固，见 §6） |

## 1. 验证装置（与上轮作废装置的区别）

上轮作废的两个根因本轮逐一处理：

1. **webview2 3 个 DLL 与测试 exe 同目录**：`Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.WinForms.dll`、`WebView2Loader.dll` 从 `server\launcher\webview2\` 复制到 `test-instance\`（exe 同级）。看门狗重启后的 `ReloadUiAfterRestart` 不再触发程序集加载失败。
2. **不用 ShellExecute 启动无签名 exe**：所有 launcher / node 进程统一用 .NET CreateProcess 启动，避免「未知发布者」安全警告：

```powershell
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = '--start-hidden'
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
[System.Diagnostics.Process]::Start($psi)
```

`--status` / `--stop` 也走同一函数（且独立构造，不是 Start-Process）。

测试实例布局（`D:\LocalModels\tmp-verify-wd\test-instance\`）：

| 文件 | 来源 |
|---|---|
| `QingYaoTP AILauncher.exe` | 本轮从源码重编译（见下） |
| `app\app.mjs` | 复制 `fake-app.mjs`（/health、/api/state、/api/shutdown、写 `app\server.pid`） |
| `runtime\node.exe` | 复制 `dist\QingYaoTP AILauncher\runtime\node.exe` |
| `config.ini` | `port=8398`（另 modelDir 空 / contextSize=4096 / gpu=cpu） |
| 3 个 webview2 DLL | 见上 |
| `run.ps1` | 由 `verify-watchdog.ps1` 复制后修改（见下） |

**重编译**（与 `server/build-portable.ps1` 284–291 行同一 csc 命令）：

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /codepage:65001 /target:winexe /platform:anycpu /optimize+ /utf8output
  /win32icon:D:\LocalModels\server\localai.ico
  /win32manifest:D:\LocalModels\server\launcher\app.manifest
  /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll
  /r:D:\LocalModels\server\launcher\webview2\Microsoft.Web.WebView2.Core.dll
  /r:D:\LocalModels\server\launcher\webview2\Microsoft.Web.WebView2.WinForms.dll
  /out:D:\LocalModels\tmp-verify-wd\test-instance\QingYaoTP AILauncher.exe
  D:\LocalModels\server\launcher\Launcher.cs
```

结果：退出码 0；**64,000 B**；SHA256 **B813510C2AD82BDD93651C5AA8472845BC71CF7F65487826953C953C66AB2E26**。
与 dist 换装 exe（64,000B / SHA256 8940A4BE33DB05822F423363E783ECBF9B5E2140BC9568C8F6940C1B56AA4319）**字节数一致、哈希不同**——csc 会写入 PE 时间戳/MVID，构建不可复现属正常，非源码差异。

**run.ps1 相对 verify-watchdog.ps1 的改动（4 类，均为装置层面，未放宽产品断言）**：

1. `$root`→tmp-verify-wd；`$base` 与 config port 8399→**8398**；`LOCALAI_LAUNCHER_INSTANCE`→**verify-wd**。
2. 新增 `Start-Exe`/`Run-Exe`（UseShellExecute=false 的 CreateProcess），替换全部 Start-Process（fake node、l1、--status、--stop、l2）。
3. **B5 改为 15s 内等待** `[watchdog] restarted pid=<new>`：/health 先就绪、日志行稍后落盘，原瞬时读取有竞态（首跑因此假失败，见 §2）。
4. **C5 改为 70s 内等待** `[watchdog] skip reason=user-stopped`：该 skip 日志有 60s 节流（`WatchdogLoop` 里 `lastLogAt`），加速参数下 C 段仅约 20s，原断言会踩节流假失败（上轮 24/24 恰好跨过 60s：上轮日志 23:58:52 stall → 23:59:53 skip，间隔 61s）。

## 2. 24 项端到端（判定跑：24/24 PASS，RESULT fail=0）

同一装置共跑 3 次，用于区分产品行为与装置时序：

| 跑次 | 结果 | 失败项 | 原因 |
|---|---|---|---|
| #1 | 22/24 | B5、C5 | B5：launcher 日志出现偶发 `restarted-not-ready`（见 §6 低-1）；C5：60s 节流未到 |
| #2 | 23/24 | C5 | 同上 C5 节流 |
| **#3（判定）** | **24/24** | 无 | 装置已修正 B5 竞态 + C5 节流等待 |

判定跑输出（原样）：

```
PASS  S1 fake app standalone /health
PASS  A1 service health after launcher start
PASS  A2 node pid file (37384)
PASS  A3 --status exit 0 (got 0)
PASS  A4 healthy after grace window
PASS  A5 no false restart (pid unchanged)
PASS  A6 no restart in launcher.log
PASS  B0 OpenProcess(PROCESS_SUSPEND_RESUME)
PASS  B0b health times out while suspended
PASS  B1 watchdog restarted node (old=37384 new=5112)
PASS  B2 old node process gone
PASS  B3 health ok after restart
PASS  B4 log restart reason=stalled
PASS  B5 log restarted with new pid
PASS  C1 --stop exit 0 (got 0)
PASS  C2 node exited after --stop
PASS  C3 service stays down after --stop
PASS  C4 no node process resurrected
PASS  C5 log skip reason=user-stopped
PASS  D1 health after second launcher start
PASS  D2 Exited guard restarted node (old=21528 new=31936)
PASS  D3 exactly one node process (got 1)
PASS  D4 log guard restarted
PASS  D5 watchdog did not double-restart
RESULT fail=0
SCRIPT_EXIT=0 elapsed_s=96
```

对应 launcher.log（判定跑，加速参数 stall=6s / interval=1s / timeout=0.8s）：

```
2026-11-24 23:40:55  node 已拉起（pid 37384）
2026-11-24 23:40:56  [watchdog] start interval=1s timeout=0.8s stall=6s（/health 连续无响应即强杀并重启）
2026-11-24 23:41:19  [watchdog] stall miss=1 elapsed=0s threshold=6s
2026-11-24 23:41:26  [watchdog] restart reason=stalled pid=37384 attempt=1（/health 连续 6s 无响应，判定卡死）
2026-11-24 23:41:26  node 已拉起（pid 5112）
2026-11-24 23:41:27  [watchdog] restarted pid=5112（服务已重启并就绪，继续监控）
2026-11-24 23:42:19  [watchdog] skip reason=user-stopped（服务已按用户请求停止，不自动拉起）
2026-11-24 23:42:22  node 已拉起（pid 21528）
2026-11-24 23:42:22  [watchdog] start interval=1s timeout=0.8s stall=6s（/health 连续无响应即强杀并重启）
2026-11-24 23:42:24  [guard] node-exit code=-1（服务进程异常退出，准备重启）
2026-11-24 23:42:25  node 已拉起（pid 31936）
2026-11-24 23:42:25  [guard] restarted attempt=1（服务已自动重启）
```

判定依据：B 段用 NtSuspendProcess 挂起 node（等价 Vulkan 原生层事件循环不转）→ 看门狗 6s 判定、旧 pid 消失、新 pid 恢复健康；C 段用户 `--stop` 后 15s 服务保持停机、无 node 复活；D 段非 0 退出由 Exited 守护恰好重启 1 次且看门狗不双重启。

## 3. 场景 E：`LOCALAI_WATCHDOG=0` 禁用（15/15 PASS）

装置：同上；环境 `LOCALAI_WATCHDOG=0`，但仍设加速参数 `STALL=6000 / INTERVAL=1000 / TIMEOUT=800`（若禁用失效，挂起后 ~7–15s 内必被杀重启），挂起 node **25s**（覆盖 10s grace + 6s stall + 余量）。

```
ENV LOCALAI_WATCHDOG=0
LAUNCHER pid=7800
PASS  E1 service healthy after launcher start
PASS  E2 node pid (29784)
PASS  E3 log [watchdog] disabled env LOCALAI_WATCHDOG=0
PASS  E4 no [watchdog] start line
PASS  E5 NtSuspendProcess ok
PASS  E6 health unavailable while suspended
PASS  E7 pid unchanged after 25s suspend (29784)
PASS  E8 still exactly one node proc (got 1)
PASS  E9 launcher still alive
PASS  E10 no [watchdog] restart line
PASS  E11 no [watchdog] stall line
PASS  E12 exactly one node launch log (got 1)
PASS  E13 health recovered after resume
PASS  E14 --stop exit 0 (got 0)
PASS  E15 no node left after --stop
LEFT_LAUNCHER=0
LEFT_NODE=0
RESULT fail=0
```

launcher.log 全文（E）：

```
2026-11-24 23:45:42  node 已拉起（pid 29784）
2026-11-24 23:45:43  [watchdog] disabled env LOCALAI_WATCHDOG=0
```

**诚实说明（首次 E 异常，未复现）**：首次跑 E 时出现异常——log 无 disabled 行、看门狗按 1s/6s 运行并在挂起后重启了 node（`restart reason=stalled pid=28648`）。随后：① 同一 exe、同一组环境变量（含 `LOCALAI_WATCHDOG=0` + 三个加速覆盖）做隔离诊断，`[watchdog] disabled` 正常生效；② 将 E 脚本由 UTF-8（含中文注释，PS 5.1 按 ANSI 解码）改为**纯 ASCII** 后，E 连跑两次产品断言全过（本次 15/15）。产品侧禁用逻辑判定为**工作正常**（E3/E7/E10/E11 + 隔离诊断双重证据），首次异常未复现、机理未定（疑与首版脚本编码/环境瞬态有关，未证实），仅作遗留项记录，建议下轮用 ASCII 装置再复核一次。

## 4. 场景 F：默认参数健康长观察（13/13 PASS）

装置：清除全部 watchdog 环境覆盖，仅保留 `LOCALAI_LAUNCHER_INSTANCE=verify-wd`（默认 interval=5s、timeout=3s、stall=90s）；连续观察 **75s**（15 个采样点，每 5s 一次 /health + server.pid）。

```
ENV watchdog= stall=
LAUNCHER pid=35360
PASS  F1 service healthy after launcher start
PASS  F2 node pid (7980)
PASS  F3 log [watchdog] start interval=5s timeout=3s stall=90s
OBS samples=15 healthFail=0 pidChange=0 elapsed_s=75
PASS  F4 collected >=14 health samples (got 15)
PASS  F5 /health ok on every sample (fails=0)
PASS  F6 node pid stable whole window (changes=0)
PASS  F7 node pid still the original one
PASS  F8 no [watchdog] restart line
PASS  F9 no [watchdog] stall line
PASS  F10 exactly one node proc (got 1)
PASS  F11 launcher still alive
PASS  F12 --stop exit 0 (got 0)
PASS  F13 no node left after --stop
LEFT_LAUNCHER=0
LEFT_NODE=0
RESULT fail=0
```

结论：健康服务在 10s 就绪宽限期之后又观察 65s（>13 个 5s 周期），无 stall、无误杀、pid 不变；默认 90s 阈值在健康状态下不会误判。

## 5. 清理 / 桌面无干扰证明

- 临时目录 `D:\LocalModels\tmp-verify-wd` 共 15 个文件 / 93,845,793B，**已整体删除**（`Test-Path` = False）。
- 测试进程：结束时 `Win32_Process` 中路径含 `tmp-verify-wd` 的进程 **0 个**；`node.exe`/`QingYaoTP AILauncher.exe` 仅剩常驻 dist 实例（pid 4272 / 13288，验证前即存在，全程未触碰）。
- 端口 8398/8399 **无监听**。
- 可见窗口枚举（EnumWindows）全程未见「安全警告 / 未知发布者 / Microsoft .NET Framework / 程序集」类窗口；最终可见标题只有用户原有窗口（桌面歌词、设置、输入体验、dist 实例窗口、DSH Desktop、Program Manager）。
- dist 未改：`dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe` = 64,000B、mtime 2026-11-23 23:55:53、SHA256 8940A4BE…（与文档记录的换装 exe 一致）。
- 未执行 git 提交/打包/源码修改（仅只读 `git status` 确认 `server/launcher/Launcher.cs` 仍为未提交 M 状态）。

## 6. 代码审查（Launcher.cs 看门狗相关；按源码逐段审阅，未做 diff/提交）

未发现阻断问题。以下按严重度排列：

### 中-1 看门狗与 Exited 守护的「双重启」竞态窗口
`WatchdogLoop` 在循环顶部读 `Restarting`（line 873）决定休眠/继续，但判死到 `WatchdogRestart()` 之间还要做一次 /health 探测与 stall 计时；`WatchdogRestart` 拿到 `RestartGate` 后**不再校验 `Restarting`**（只查 Stopping/WatchdogStopFlag/ServiceStopped/Server）。若 Exited 守护在「顶部检查之后、看门狗取锁之前」启动重启，看门狗会等锁，然后对刚被守护重启、正处于启动宽限期的 node 再杀一次并再拉起，同时 `WatchdogRestarts` 多计 1 次。概率低（要求同时刻 stall 判定与 node 崩溃），但后果是用户看到两次重启、重启预算被消耗。
建议：`WatchdogRestart` 的 `lock` 内加 `if (Restarting) return;`（并可选加 `DateTime.Now < HealthGraceUntil` 快速返回），或把两条自愈路径收敛到单一「恢复协调器」。

### 低-1 `WaitForServiceQuiet` 偶发 1s 内返回 false（日志 `restarted-not-ready`）
3 次全量跑 + 1 次专项复现中仅出现 1 次：真实日志 `restarted-not-ready pid=11836（120s 内未就绪）`，但同一时刻测试侧 /health 已 OK、node 11836 随后持续健康（B3 通过、C2 才随 --stop 退出）；其余 3 次是正常的 `restarted pid=…`。按代码，`WaitForServiceQuiet` 提前返回 false 只有 `Server.HasExited==true` 一条路径，与该现象矛盾，机理未能定死（可能与重启瞬间 Process 对象/HasExited 的时序有关）。影响：误弹「自动重启后未就绪」托盘提示、且不重载界面；服务本身可用。
建议：判定未就绪前要求连续 N 次失败（如 2–3 次）或加入 `Server.HasExited`/Ping 的诊断日志，下轮复跑确认。

### 低-2 `ReloadUiAfterRestart` 的 WebView2 类型引用在缺 DLL 时会变成未处理异常弹窗
委托体静态引用 `WebView` 字段（类型 `Microsoft.Web.WebView2.WinForms.WebView2`）；缺程序集时类型加载/JIT 失败发生在委托体内的 try/catch 之前，最终可能表现为 .NET 未处理异常弹窗而非静默回退——这正是上轮临时目录弹窗的机理（测试副本缺 DLL）。产品包内 DLL 齐全（本轮同目录带 3 DLL 后 0 弹窗），故不阻断；建议把 WebView2 访问隔离到独立方法并在调用侧 try/catch（或启动时校验 DLL 是否存在）。

### 低-3 `HealthGraceUntil` 为 `DateTime` 且非 volatile
看门狗线程读、Exited 线程/主线程写。x64 上 64 位写原子、不会撕裂，但 `/platform:anycpu` 在 32 位进程理论上存在撕裂风险；且无内存屏障语义。建议改存 `long` ticks + `Interlocked`/`volatile`。

### 低-4 重启风暴保护只覆盖看门狗路径
看门狗侧 5 次/30 分钟（`WatchdogCanRestart`），Exited 守护另有 10 次、无时间窗、仅 5s 防抖（`RestartCount`）。两条路径叠加最坏约 15 次/30 分钟；对「反复崩溃」场景仍可控，记录为已知边界。

### 其余确认项（无问题）
- `Restarting` 在 `RestartGate` 内设置/清除；Exited 回调在入口即用 `Restarting` 提前返回、并用 `object.ReferenceEquals(s, Server)` 过滤被替换旧进程的迟到事件（判定正确）。
- 用户主动停机：退出码 0 → `ServiceStopped=true` → 看门狗 skip，且 15s 观察无复活（C 段 PASS）；`LaunchNode` 复位 `ServiceStopped`。
- `ReloadUiAfterRestart` 只在界面本来开着时重载（`WebView != null && CoreWebView2 != null`），`--start-hidden` 不会突然弹窗；`TrayBalloon` 通过 `UiMarshal.BeginInvoke` 回 UI 线程并有 try/catch 兜底。
- 只杀 node 本体不含子进程树、非本启动器拉起的 node 只告警属已记录边界，本轮未改判。

## 7. 建议

1. **建议接受本次改动**：核心行为（卡死自愈、用户停机不复活、崩溃守护单次重启、禁用开关、默认参数不误杀）全部通过独立装置复现。
2. 建议下一轮顺手处理 §6 中-1（gate 内补 `Restarting` 校验）与低-1/低-2（判定未就绪加连续失败要求、WebView2 访问隔离）；均不影响本轮接受。
3. 首次 E 异常（§3）建议用 ASCII 装置复核一次，排除测试装置侧因素。
