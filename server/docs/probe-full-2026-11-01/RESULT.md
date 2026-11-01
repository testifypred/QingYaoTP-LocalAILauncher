# 47 条全量探针回归结果（2026-11-01 轮）

> 结论：**47 条全绿 / 0 真红**。整跑 46 条直接通过；`probe-code-run` 首跑 1 红（C++ 编译执行 11.8s 越过服务端 10s 硬超时），用驱动同参数单独复跑 13/13 通过（两次复跑分别 9445ms / 8562ms），判为**时序边界抖动，非本轮回归**。
> 断言合计 **629 项**：首跑 628 通过 / 1 失败；复跑后 629/629。整跑耗时 **864.5s（14m24.5s）**，崩溃 **0 次**、重启 **0 次**。
> 本文件为本轮正式汇总；`summary.txt` 是驱动原始输出（表头 utf8 + 逐条 UTF-16 混合编码，逐条断言数一律以 `logs\<probe>.out.txt` 末尾结果行为准）。

## 1. 环境

| 项 | 值 | 证据 |
|---|---|---|
| 日期时间 | 2026-11-01 10:44:42 → 10:59:06（+08:00），耗时 864.5s | `summary.txt` 表头（10:44:42）+ 末行 done（10:59:06） |
| 服务方式 | **裸 node**（`node app.mjs`，无启动器兜底），工作目录 `D:\LocalModels\server` | `logs\bare-server.out.txt` |
| 服务进程 | `startedAt=2026-11-01T02:42:51.563Z`（=10:42:51 +08:00，整跑前启动），**全程同一进程未重启** | `GET /api/state` |
| 服务地址 | http://127.0.0.1:8099 | `GET /api/state` OK |
| 版本/构建 | v1.0.0，build commit `d3d79c2`（2026-11-01T10:37:44+08:00），`dirty=false` | `GET /api/state` |
| 模型 | 驱动开跑前预加载 `qwen2.5-7b-instruct-1m-q4_k_m.gguf`（请求 contextSize=16384，实际就绪 context 16384 / layers 29 / 15.1s）；收尾时状态为同一模型 context 8192（后续探针自行换模型/上下文） | `bare-server.out.txt` 02:44:45–02:44:58；`/api/state` |
| 后端 | **Vulkan（GPU）**，全程未回落 CPU | `/api/state` `gpu=vulkan`；`vulkan-crash.log` 本轮无新增 |
| 界面 | headless Edge `Edg/156.0.4314.58`，CDP http://127.0.0.1:9333，页面 http://127.0.0.1:8099/ | `GET http://127.0.0.1:9333/json/version` |
| 驱动 | `server\docs\probe-full-2026-11-01\run-full.ps1`（47 条，含 BOM，**未修改**，mtime 09:50:16） | 文件 mtime / 校验未变 |
| 会话备份 | `server\docs\session-backups\2026-11-01_10-42-34\workspace-full` | Lead 备环境时留存 |

## 2. 崩溃 / 重启时间线

| 时间（+08:00） | 事件 | 证据 |
|---|---|---|
| 10:42:51 | 裸 node 服务启动（Lead 备环境），v1.0.0 / d3d79c2 | `logs\bare-server.out.txt` 02:42:53 |
| 10:44:42 | 驱动开跑，预加载 qwen2.5-7b-instruct-1m-q4_k_m.gguf（15.1s 就绪） | `summary.txt` / `bare-server.out.txt` 02:44:45 |
| 10:44:42–10:59:06 | 47 条串行跑完，**无 `[driver] 服务已退出`、无 `server-restart-*`** | `summary.txt`、目录内无 `server-restart-*.txt` |
| 10:59:06 | 驱动收尾 `FULL SUITE DONE` | `summary.txt` 末行 |

**崩溃 0 次、重启 0 次**：
- 服务进程 `startedAt` 整跑前后一致（未重启）；
- 驱动看护函数 `Ensure-Server` 从未触发（`summary.txt` 无相关行，目录无 `server-restart-*.out.txt/err.txt`）；
- `server\vulkan-crash.log` 只有 3 条**旧**记录：`2026-10-31 22:15:12 / 22:52:31 / 22:53:07`，本轮（10:44–10:59）**未新增**；
- 说明：该文件本轮 `CreationTime=10:46:01` 是 `probe-debug` 的自复位行为（带令牌 `clear-crash` 删文件 → 再原样写回），不是崩溃写入；内容与原文件逐字节一致（42 字节）。
- 已知 Vulkan device lost 场景（`probe-tools-agent` 生成中途断连）本轮未复现：该条 108.3s 绿（24/24）。

## 3. 逐条表（47 条）

断言数取自每条 `logs\<probe>.out.txt` 末尾结果行（`== 结果: N 通过 / M 失败 ==` / `RESULT N/M` / `通过 N 项`）；秒数为驱动实测。

| # | 探针 | 断言 | 结论 | 耗时 |
|---|---|---|---|---|
| 1 | probe-sessions | 33 | 整跑通过 | 1s |
| 2 | probe-workspace-api | 9 | 整跑通过 | 0.8s |
| 3 | probe-code-run | 13（首跑 12 通过 / 1 失败；复跑 13/13） | **复跑通过**（首跑红，非崩溃波及） | 29.1s（复跑 21s / 20s） |
| 4 | probe-ui-metric | 0（观察型：只打印界面指标行，无断言） | 整跑通过（指标正常：首轮 7.34 tok/s、预填充 0.98s；次轮复用 72%） | 11.2s |
| 5 | probe-backup | 38 | 整跑通过 | 17.9s |
| 6 | probe-rag | 16 | 整跑通过 | 0.8s |
| 7 | probe-plugins | 11 | 整跑通过 | 0.7s |
| 8 | probe-version | 14 | 整跑通过 | 1.3s |
| 9 | probe-debug | 25 | 整跑通过（含崩溃记录清除+自复位） | 1.9s |
| 10 | probe-func | 9 | 整跑通过 | 33.3s |
| 11 | probe-ui-new | 30 | 整跑通过 | 9.6s |
| 12 | probe-start-screen | 12 | 整跑通过 | 4.7s |
| 13 | probe-start-flow | 8 | 整跑通过 | 16.6s |
| 14 | probe-model-add | 4 | 整跑通过 | 8.6s |
| 15 | probe-menu-stacking | 2 | 整跑通过 | 4.2s |
| 16 | probe-status | 6 | 整跑通过 | 4.2s |
| 17 | probe-code-panel | 9 | 整跑通过 | 9.9s |
| 18 | probe-settings-tools | 9 | 整跑通过 | 5.7s |
| 19 | probe-workspace-ui | 7 | 整跑通过 | 8.2s |
| 20 | probe-hero-modes | 11 | 整跑通过 | 6.1s |
| 21 | probe-input-extras | 8 | 整跑通过 | 9.1s |
| 22 | probe-formula-panel | 7 | 整跑通过 | 7.7s |
| 23 | probe-formula-find | 8 | 整跑通过 | 7.5s |
| 24 | probe-timestamps | 4 | 整跑通过 | 5.5s |
| 25 | probe-small-features | 6 | 整跑通过 | 10.5s |
| 26 | probe-title-ui | 13 | 整跑通过 | 7.2s |
| 27 | probe-session-jump | 4 | 整跑通过 | 7.8s |
| 28 | probe-session-race | 3 | 整跑通过 | 5.7s |
| 29 | probe-ctx-panel | 24 | 整跑通过 | 12.9s |
| 30 | probe-code-run-ui | 9 | 整跑通过 | 4.5s |
| 31 | probe-ui-tools | 12 | 整跑通过 | 21.3s |
| 32 | probe-ui-web | 39 | 整跑通过 | 46s |
| 33 | probe-ui-rag | 6 | 整跑通过 | 5.1s |
| 34 | probe-ui-version | 9 | 整跑通过 | 5.1s |
| 35 | probe-ui-debug | 19 | 整跑通过 | 15.1s |
| 36 | probe-ui-backup | 20 | 整跑通过 | 9.4s |
| 37 | probe-sidebar-search | 11 | 整跑通过 | 11.3s |
| 38 | probe-auto-title | 5 | 整跑通过 | 26.7s |
| 39 | probe-ui-sessions | 27 | 整跑通过 | 13.9s |
| 40 | probe-chat-plain | 11 | 整跑通过 | 7.8s |
| 41 | probe-tools-agent | 24 | 整跑通过（未触发 Vulkan device lost） | 108.3s |
| 42 | probe-web-tools | 19 | 整跑通过 | 118.5s |
| 43 | probe-kv-long | 0（观察型：只打印 KV 复用表，无断言） | 整跑通过（复用率 0%→99%，首字 19011ms→1130ms） | 39s |
| 44 | probe-context-switch | 3 | 整跑通过 | 31.2s |
| 45 | probe-ui-preload | 35 | 整跑通过 | 32.9s |
| 46 | probe-preload | 26 | 整跑通过 | 44.4s |
| 47 | probe-second-opinion | 11 | 整跑通过 | 57.1s |

> 2 条「观察型」探针（`probe-ui-metric`、`probe-kv-long`）源码里没有 `check()/FAIL/exit code` 判定，只打印指标供人工看，驱动按退出码判 PASS；故断言数记 0，不参与断言统计。

## 4. 汇总

| 指标 | 值 |
|---|---|
| 探针总数 | 47 |
| 绿 | **47**（整跑直接通过 46 = 断言型 44 + 观察型 2；首跑红、复跑通过 1） |
| 红 | **0 真红**（首跑 1 红，复跑证实为时序抖动） |
| 断言总数 | **629**（45 条断言型合计；观察型 2 条 0 断言） |
| 首跑断言 | 628 通过 / 1 失败（== 629） |
| 复跑后断言 | 629 / 629 通过 |
| TIMEOUT 条数 | 0（驱动逐条超时上限 60–420s，均未触发） |
| 整跑耗时 | **864.5s**（10:44:42 → 10:59:06，约 14m25s）；探针自身耗时合计 847.3s，进程启动+看护开销约 17.2s |
| 最慢三条 | probe-web-tools 118.5s、probe-tools-agent 108.3s、probe-second-opinion 57.1s |
| 崩溃次数 | **0**（Vulkan device lost 未复现；无自动切 CPU） |
| 服务重启次数 | **0** |
| 复跑次数 | 1 条 × 2 次（probe-code-run，均 13/13 通过） |

## 5. 红项归因（唯一红项：probe-code-run）

**现象**：整跑第 3 条 `probe-code-run` 退出码 1，`RESULT 12/13`，唯一失败断言 `FAIL C++ 编译并执行  ms=11773`；其余 12 项（语言列表、Python/JS 执行、Java 缺 JDK 提示、令牌/未知语言/空代码拒绝、超时杀进程、输出截断）全绿。

**证据**：
- 首跑红：`logs\probe-code-run.out.txt`（`FAIL C++ 编译并执行  ms=11773`，末行 `RESULT 12/13`）、`logs\probe-code-run.err.txt`（空）。
- 复跑 1（同参数 `node probe-code-run.mjs http://127.0.0.1:8099`，11:00）：`logs\rerun-probe-code-run.out.txt` → `ok C++ 编译并执行 [ms=9445]`、`RESULT 13/13`。
- 复跑 2（11:01，佐证用）：`logs\rerun2-probe-code-run.out.txt` → `ok C++ 编译并执行 [ms=8562]`、`RESULT 13/13`。

**机制（读源码，未改任何代码）**：服务端 `server\app.mjs:5369` 定义单次子进程硬超时 `RUN_TIMEOUT_MS = 10000`；C/C++ 的 MSVC 分支（`app.mjs:5544` 附近）把 `vcvars 初始化 + cl 编译 + main.exe 运行`塞进**同一次** `runSpawn("cmd.exe", ["/d","/c", bat])`，到 10s 即 `taskkill /T /F`，返回 `timedOut=true`、`ok=false`，断言（要求 stdout 含 `cpp42`）失败。本机 MSVC 冷编译三次实测 **11773ms（红）/ 9445ms / 8562ms**，正卡在 10s 阈值上下。

**归因**：**环境时序抖动（首跑冷启动）为主 + 产品超时阈值偏紧为放大因素**；不是探针过期（断言条件正确：C++ 程序应打印 `cpp42`），也不是本轮改动引入的回归（首跑即红、无崩溃、同参数连跑两次均绿，且失败点恰在编译耗时极值）。
**建议（需 Lead 批准，本轮未改产品代码）**：给 C/C++/Rust 这类「先编译后运行」的语言单独放宽超时（如编译 30s、运行 10s 分开计时），以消除冷机/杀软扫描导致的随机红。

## 附：证据文件清单（相对本目录）

| 文件 | 用途 |
|---|---|
| `summary.txt` | 驱动原始逐条行（混合编码，仅供参考） |
| `logs\<probe>.out.txt` / `.err.txt` | 47 条各自输出，断言数取末尾结果行 |
| `logs\rerun-probe-code-run.out.txt` | 红项复跑 1：13/13（C++ 9445ms） |
| `logs\rerun2-probe-code-run.out.txt` | 红项复跑 2：13/13（C++ 8562ms） |
| `logs\bare-server.out.txt` | 裸 node 服务 stdout（启动、预加载/换模型时间线，无崩溃/重启痕迹） |
| `server\vulkan-crash.log` | 仅 3 条 2026-10-31 旧崩溃记录，本轮无新增 |
| `shots\` | 界面探针截图（驱动产出，已 gitignore） |
