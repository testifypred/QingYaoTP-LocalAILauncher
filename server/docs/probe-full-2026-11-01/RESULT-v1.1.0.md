# 48 条全量探针回归 —— QingYaoTP AILauncher v1.1.0 发布包（2026-11-01）

> 一句话：**首跑 40 绿 / 8 红；8 个红项逐条复跑全部转绿（48/48，664/664 断言）**。红项归因为「probe-firstrun 旧版 apply 把模型换成 DeepSeek-R1 + probe-plugins 硬编码 dev 插件目录」，**不是 v1.1.0 功能回归**；但暴露了发布包推荐逻辑的 2 个产品问题（P1/P2），源码修复后**已重建发布包并复验通过**（推荐改为 qwen2.5-7B、apply 支持 dryRun、probe 包感知）。
> 本轮跑过两个包：**包A** = 17:04 构建、17:06–17:32 做 48 条全量；**包B** = 17:33 修复后重建、17:40–17:42 做重点复验。

## 0. 最终状态速览

| 项 | 结果 |
|---|---|
| 48 条整跑（包A） | **40 绿 / 8 红**，1543.3s，崩溃/重启 0 |
| 8 红逐条复跑（包A，7B） | **8/8 全部转绿** → **48/48 绿，664/664 断言** |
| 重建后复验（包B） | probe-firstrun **18/18**（dryRun 不写配置不换模型）、probe-plugins **11/11**、probe-debug **35/35**、probe-chat-plain **11/11**、probe-func **9/9**、probe-ui-tools **12/12**（合计 96 断言全绿） |
| 真红 | **0**（无 v1.1.0 功能回归） |
| 产品侧修复 | P1 推荐择优（不再选 DeepSeek-R1）、P2 apply 支持 dryRun、P3 probe-plugins 包感知 → 已进包B并复验通过 |
| config.ini | `autoLoad=` 空，SHA256 `A046F3A6…`，跑前/跑后/dryRun 前后完全一致（未写盘） |
| 工作区会话 | sessions 1 个（`mvn7m7kl-0d9fe764.json`）、session-snapshots 309 个，与跑前备份一致；探针新建的临时会话已清理 |
| 服务最终状态 | **包B 在 8099 运行**（pid 11496，`/api/version` dir=`dist\QingYaoTP AILauncher\app`，builtAt 17:33:39），已加载 qwen2.5-7b ctx=16384，backend=**vulkan**；9333 headless Edge 已关闭 |
| 交付 | 本文件 + `logs\`（48 条首跑、8 条复跑、6 条重建后复验） |

## 1. 环境与发布包身份

| 项 | 包A（整跑用） | 包B（重建后复验用） |
|---|---|---|
| 运行形态 | 发布包 `D:\LocalModels\dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe` | 同左（重建） |
| `/api/version` | **v1.1.0**，`dir=D:\LocalModels\dist\QingYaoTP AILauncher\app`，`pid=39224`，`builtAt=2026-11-01T09:04:18.892Z`（17:04:18），`buildSource=mtime`，node v24.19.0 | **v1.1.0**，`dir` 同上，`pid=11496`，`builtAt=2026-11-01T09:33:39.518Z`（17:33:39） |
| 进程 | `startedAt=09:05:37.299Z`（17:05:37），整跑期间未重启 | `startedAt=09:39:52.710Z`（17:39:52），复验期间未重启 |
| 模型 | 驱动预加载 qwen2.5-7b（16K）；17:07:45 被 probe-firstrun 换成 **DeepSeek-R1-0528-Qwen3-8B**；17:25:09 起探针自行换回 7B | 空载启动；复验时 `POST /api/load` qwen2.5-7b ctx=16384 |
| 后端 | Vulkan（无 CPU 回落）；`app\vulkan-crash.log` 不存在 | 同左 |
| 诊断 | `/api/diag` 18 ok / 0 warn / 0 error | `/api/diag` 18 项（加载模型后 17 ok / 1 warn / 0 error） |
| 界面 | headless Edge `Edg/156.0.4314.58`，CDP 9333，页面 8099 | 同左（收尾已关） |
| 驱动 | `server\docs\probe-full-2026-11-01\run-full.ps1`，**48 条**（新增 probe-firstrun，mtime 16:56:19，未修改） | 复跑用驱动同参数单条执行 |
| 备份 | 会话 `server\docs\session-backups\2026-11-01_17-05-53\`（sessions 1 / snapshots 309）；config `D:\LocalModels\tmp-config-orig.ini` | — |

## 2. 时间线（含关键模型切换）

| 时间（+08:00） | 事件 | 证据 |
|---|---|---|
| 17:05:37 | 包A 启动（pid 39224，未加载模型） | `/api/version` |
| 17:06:36 | 驱动开跑；17:06:49 预加载 qwen2.5-7b（16K，12.9s） | `dist\QingYaoTP AILauncher\logs\app.log`、`summary.txt` |
| 17:07:45 / 17:08:04 | **probe-firstrun（旧版）调 `/api/firstrun/apply` 两次加载 DeepSeek-R1-8B（16K）**，并写 config.ini `autoLoad=DeepSeek-R1…`、`kvQuant=q8_0` | `app.log` 09:07:45 / 09:08:04（UTC） |
| 17:08:14–17:25:09 | 其后约 17 分钟（probe-func → … → probe-chat-plain）全部跑在 **DeepSeek-R1（思考模型）** 上 ← **8 个红项的直接背景** | `app.log` 模型加载行 |
| 17:25:09–17:32:12 | tools-agent / web-tools / kv-long / ui-preload / preload / second-opinion 自行加载 7B / Phi-4 / qwen3-4B，相关条目转绿 | `app.log` |
| 17:32:19 | 驱动收尾 `FULL SUITE DONE`（1543.3s） | `summary.txt` |
| 17:33:39 | 修复源码 + **重建包B**（`/api/version.builtAt` = 09:33:39Z） | `/api/version` |
| 17:39:52 | 包B 启动（pid 11496，空载） | `/api/version` |
| 17:40:14–17:42:02 | 重建后复验 6 条：firstrun/plugins/debug/chat-plain/func/ui-tools 全绿 | `logs\rerun2-*.out.txt` |

**崩溃/重启 0 次**：`summary.txt` 无 `[driver] 服务已退出`；无 `server-restart-*.txt`；`/api/state.startedAt` 全程未变；包A/包B 的 `app\vulkan-crash.log` 均不存在（Vulkan device lost 未复现）。

## 3. 逐条表（48 条：包A 首跑 + 复跑）

断言数为该条设计断言数（`RESULT N/M` 记 M；`== 结果: N 通过 / M 失败 ==` 记 N+M）。

| # | 探针 | 断言 | 首跑 | 耗时 | 复跑 | 说明 |
|---|---|---|---|---|---|---|
| 1 | probe-sessions | 33 | 通过 | 0.9s | — | |
| 2 | probe-workspace-api | 9 | 通过 | 0.7s | — | |
| 3 | probe-code-run | 13 | 通过 | 22.5s | — | v1.1.0 编译 30s/运行 10s 拆分后 C++ 全绿 |
| 4 | probe-ui-metric | 0 | 通过 | 8s | — | 观察型 |
| 5 | probe-backup | 38 | 通过 | 17.8s | — | |
| 6 | probe-rag | 16 | 通过 | 0.9s | — | |
| 7 | probe-plugins | 11 | **红 7/4** | 0.8s | **11/11 绿**（旧包）/ 包B **11/11** | 探针硬编码 dev 插件目录 |
| 8 | probe-version | 14 | 通过 | 0.8s | — | |
| 9 | probe-firstrun | 18 | 通过 | 32.4s | 包B **18/18**（dryRun） | 旧版 apply 有副作用（换模型/写 config） |
| 10 | probe-debug | 35 | 通过 | 3.9s | 包B **35/35** | 需模型已加载（空载时 33/35，见 §5） |
| 11 | probe-func | 9 | **红 5/4** | 88.3s | **9/9 绿** / 包B **9/9** | R1 无工具调用、正文漏推理 |
| 12 | probe-ui-new | 30 | 通过 | 9.3s | — | |
| 13 | probe-start-screen | 12 | 通过 | 4.7s | — | |
| 14 | probe-start-flow | 8 | 通过 | 57s | — | R1 上变慢（v1.0.0 为 16.6s） |
| 15 | probe-model-add | 4 | 通过 | 8.5s | — | |
| 16 | probe-menu-stacking | 2 | 通过 | 4.1s | — | |
| 17 | probe-status | 6 | 通过 | 3.9s | — | |
| 18 | probe-code-panel | 9 | 通过 | 9.7s | — | |
| 19 | probe-settings-tools | 9 | 通过 | 5.4s | — | |
| 20 | probe-workspace-ui | 7 | 通过 | 8.2s | — | |
| 21 | probe-hero-modes | 11 | 通过 | 43.4s | — | R1 上变慢（v1.0.0 为 6.1s） |
| 22 | probe-input-extras | 8 | 通过 | 8.5s | — | |
| 23 | probe-formula-panel | 7 | 通过 | 8.1s | — | |
| 24 | probe-formula-find | 8 | 通过 | 7.4s | — | |
| 25 | probe-timestamps | 4 | 通过 | 5.4s | — | |
| 26 | probe-small-features | 6 | 通过 | 10.5s | — | |
| 27 | probe-title-ui | 13 | 通过 | 7.6s | — | |
| 28 | probe-session-jump | 4 | **红（exit 1 异常）** | 4.8s | **4/4 绿** | 首跑 `.sessionItem.sel` 取值抛异常 |
| 29 | probe-session-race | 3 | **红 1/2** | 6.8s | **3/3 绿** | 连点选中/正文归属错乱 |
| 30 | probe-ctx-panel | 25 | 通过 | 56.9s | — | |
| 31 | probe-code-run-ui | 9 | 通过 | 4.8s | — | |
| 32 | probe-ui-tools | 12 | **红 6/6** | 194.9s | **12/12 绿** / 包B **12/12** | 工具卡片 0 张（R1） |
| 33 | probe-ui-web | 39 | **红 33/6** | 222.2s | **39/39 绿** | 联网卡片 0 张（R1） |
| 34 | probe-ui-rag | 6 | 通过 | 5.2s | — | |
| 35 | probe-ui-version | 9 | 通过 | 5.2s | — | |
| 36 | probe-ui-debug | 25 | 通过 | 16.2s | — | |
| 37 | probe-ui-backup | 20 | 通过 | 9.6s | — | |
| 38 | probe-sidebar-search | 11 | 通过 | 11.4s | — | |
| 39 | probe-auto-title | 5 | **红 4/1** | 140.4s | **5/5 绿** | 40s 等不到自动标题（R1 慢） |
| 40 | probe-ui-sessions | 27 | 通过 | 14.2s | — | |
| 41 | probe-chat-plain | 11 | **红 10/1** | 24.5s | **11/11 绿** / 包B **11/11** | 流式仅 1 块（R1） |
| 42 | probe-tools-agent | 24 | 通过 | 120.5s | — | 自带 `$M` 加载 7B |
| 43 | probe-web-tools | 19 | 通过 | 119.9s | — | 自带 `$M` 加载 7B |
| 44 | probe-kv-long | 0 | 通过 | 41.7s | — | 观察型 |
| 45 | probe-context-switch | 3 | 通过 | 29.9s | — | |
| 46 | probe-ui-preload | 35 | 通过 | 32s | — | |
| 47 | probe-preload | 26 | 通过 | 40s | — | |
| 48 | probe-second-opinion | 11 | 通过 | 48.4s | — | |

## 4. 汇总

| 指标 | 包A 首跑 | 复跑/包B 后 |
|---|---|---|
| 探针 | 48 | 48 |
| 绿 | **40** | **48**（8 条复跑全绿；包B 复验 6 条全绿） |
| 红 | **8** | **0 真红** |
| 断言 | 664（结果行覆盖 660：636 通过 / 24 失败；probe-session-jump 异常未出结果行） | **664 / 664 通过**；包B 复验 96 / 96 |
| 崩溃 / 重启 | 0 / 0 | 0 / 0 |
| 耗时 | **1543.3s**（25m43s） | 8 条复跑约 8 分钟；包B 6 条复验约 2 分钟 |
| TIMEOUT | 0 | 0 |
| 最慢 | probe-ui-web 222.2s、probe-ui-tools 194.9s、probe-auto-title 140.4s（均在 R1 上；7B 复跑为 ~51s / ~19s / ~28s） | |

> 口径：Lead 预期 662 断言，实测 **664**——v1.1.0 探针自身加严（probe-debug 25→35、probe-ui-debug 19→25，+16；probe-firstrun +18；probe-ctx-panel 24→25 +1）。

## 5. 红项归因（8 项，全部已复跑转绿）

### A. 环境副作用（7 项）：probe-firstrun（旧版）的 apply 把模型换成了 DeepSeek-R1

- **直接原因**：包A 的 `config-recommend.mjs::findBig()` 取目录里**第一个**匹配 `7b|8b|4b` 的模型（不排序、不区分思考模型）；本机目录按字母序第一个是 `DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf` → `/api/sysinfo` 推荐它 → `probe-firstrun` 调 `/api/firstrun/apply` 后**立即加载 R1 并写回 config.ini**。此后至 17:25:09，所有探针都跑在思考模型 R1 上。
- **症状与复跑对比**：
  - probe-func：`toolCalls=0`、正文漏「推理过程」文本（5/9 → **9/9**）
  - probe-ui-tools / probe-ui-web：工具/联网卡片 0 张、正文里是原始 tool-call JSON（6/12→**12/12**、33/39→**39/39**）
  - probe-chat-plain：流式仅 1 块（10/11 → **11/11**，复跑 41 块）
  - probe-auto-title：40s 等不到自动标题（4/5 → **5/5**，复跑 11s）
  - probe-session-jump / probe-session-race：慢生成期间页面选择状态未落定 → 抛异常 / 选中错乱（→ **4/4**、**3/3**）
- **证据**：`dist\QingYaoTP AILauncher\logs\app.log`（09:07:45 / 09:08:04 载入 R1，09:25:09 换回 7B）；`logs\probe-func.out.txt`、`logs\probe-ui-tools.out.txt`、`logs\probe-chat-plain.out.txt`、`logs\probe-auto-title.out.txt`、`logs\probe-session-jump.err.txt`；复跑 `logs\rerun-*.out.txt`。
- **定性**：测试编排/环境副作用，**非 v1.1.0 功能回归**；但 P1/P2 是产品侧应当修的问题（已修，见 §6）。

### B. 探针适配缺口（1 项）：probe-plugins 硬编码 dev 插件目录

- 首跑 `logs\probe-plugins.out.txt` = `7 通过 / 4 失败`（插件出现在工具清单 / 列表标禁用 / 重新启用 / 启用后不标禁用）。
- 原因：探针默认 `PLUGIN_DIR=D:\LocalModels\plugins`（dev 布局，已空），发布包目录是 `D:\LocalModels\dist\QingYaoTP AILauncher\plugins`（disk/hello/notes）→ 临时插件写错地方。
- 复跑：改为从 `/api/diag.paths` 推目录的新版探针 → **11/11 绿**（日志头显示 dist 插件目录）。属探针过期/适配缺口，非产品缺陷。

### C. 包B 复验时的 1 个前置说明（非缺陷）

- 包B 空载（无模型）跑 probe-debug 得 **33/35**，2 红为「模型 KV 量化与 /api/state 一致」「KV 量化实际生效类型」——探针要求**有模型已加载**（`resources.model` 非空），这是驱动会先预加载的前提。装回 7B 后 **35/35 绿**（`kv q8_0 vs q8_0`）。全量跑时模型始终已预加载，不影响结论。

## 6. 产品侧修复清单（已进包B，复验通过）

| 编号 | 发现 | 影响 | 修复 | 包B 复验 |
|---|---|---|---|---|
| P1 | 包A `config-recommend.mjs::findBig()` 取目录首个 7B/8B/4B 模型，把 **DeepSeek-R1 思考模型**选为默认推荐；apply 会立即加载它 | 首启/CI 被切到工具调用弱、更慢的模型；7 条探针红 | 「择优」：qwen2.5-7B > qwen3-4B > phi > 其它 7B/4B；DeepSeek-R1 类思考模型降权、默认不推荐 | ✅ `/api/sysinfo` 现推荐 **qwen2.5-7b-instruct-1m-q4_k_m.gguf**（tier=large / ctx=16384 / kv=q8_0） |
| P2 | `/api/firstrun/apply` 无 dryRun，探针无法「只验证建议」而不写配置/换模型（probe-firstrun 18/18 全绿却有副作用，属探针盲区） | 全量回归被污染 | apply 支持 `{dryRun:true}`；probe-firstrun 改用 dryRun | ✅ 返回 `dryRun:true / applied:null / loaded:false`；**config.ini SHA256 前后一致**、模型未被换、18/18 |
| P3 | `probe-plugins.mjs` 硬编码 dev 插件目录 | 发布包上必红 | 目录/`plugins.json` 改从 `/api/diag.paths` 推（源码=`server\plugins`，发布包=`HERE\..\plugins`） | ✅ 包B 11/11（日志头 = dist 插件目录） |

## 7. 重建后复验（包B，17:40–17:42）

前置：包B 空载启动；按驱动同等前置 `POST /api/load {qwen2.5-7b-instruct-1m-q4_k_m.gguf, contextSize:16384}`（firstrun/plugins 在空载下跑，debug/chat-plain/func/ui-tools 在 7B 下跑），UI 条目前用 CDP `Page.navigate` 刷新页面。

| 探针 | 断言 | 结果 | 关键证据 |
|---|---|---|---|
| probe-firstrun | 18 | **18/18** | `dry-run 只给建议、不写配置不加载 [applied=null]`；`RESULT 18/18` |
| probe-plugins | 11 | **11/11** | 日志头 `插件目录 D:\LocalModels\dist\QingYaoTP AILauncher\plugins` |
| probe-debug | 35 | **35/35** | `/api/diag` 18 项；`--json` checks=18；KV `q8_0 vs q8_0` |
| probe-chat-plain | 11 | **11/11** | 流式 39 块，`[DONE]`、metrics 正常 |
| probe-func | 9 | **9/9** | `toolCalls=1`（真实时间），系统提示跨轮 70%/79% 复用 |
| probe-ui-tools | 12 | **12/12** | 工具卡片 1 张 20s，指标行含工具次数，刷新后恢复 |

- **config.ini 复验前后 SHA256 均为 `A046F3A67678F9A7CD9460BA1D593EC5741C6C0D54066864CD14697AD0F946A2`（`autoLoad=` 空）** → dryRun 确实不写盘。
- workspace 会话在复验中未丢（原 `mvn7m7kl-0d9fe764.json` 完好）；probe-ui-tools 新建的临时会话 `mvxn4ogm-4ce8f63a.json` 已在收尾删除。
- 端口/身份：8099 监听进程 = pid 11496，`/api/version` = v1.1.0 / dir=`dist\QingYaoTP AILauncher\app` / builtAt 17:33:39。

## 8. 收尾状态

- **config.ini**：`dist\QingYaoTP AILauncher\config.ini` = 原始模板（`autoLoad=` 空、`contextSize=16384`、`gpu=auto`），SHA256 `A046F3A6…` 与 `D:\LocalModels\tmp-config-orig.ini` 完全一致；全流程（整跑 → 还原 → 包B 复验）后未再被写改。
- **工作区会话**：`sessions` = 1 个（`mvn7m7kl-0d9fe764.json`，10842 字节，与跑前备份一致）、`session-snapshots` = 309 个文件（已按 `session-backups\2026-11-01_17-05-53` 还原）；`workspace\plugins.json` = `{"disabled":[]}`；发布包 `plugins` 目录仅 disk/hello/notes 三个插件（无探针临时插件）。
- **服务**：**包B 保持运行**（`D:\LocalModels\dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe`，pid 11496），8099 可访问，已加载 `qwen2.5-7b-instruct-1m-q4_k_m.gguf`（context 16384），backend = **vulkan**，未重启。
- **headless Edge**：9333 实例已关闭（`Browser.close` + 结束 `--headless=new --remote-debugging-port=9333 --user-data-dir=…\edge-probe-v11` 进程树；9333 监听已消失）。未触碰用户 WebView2 窗口/其它 Edge。
- 未 commit、未改动源码/探针/打包脚本（本轮只写 `server\docs\probe-full-2026-11-01\` 内文件）。

## 9. 证据文件清单（相对本目录）

| 文件 | 用途 |
|---|---|
| `summary.txt` | 驱动原始逐条（混合编码，仅供参考） |
| `logs\<probe>.out.txt` / `.err.txt` | 48 条首跑输出（断言数来源；`probe-session-jump.err.txt` = 异常栈） |
| `logs\rerun-*.out.txt` | 包A 上 8 个红项复跑（8/8 绿） |
| `logs\rerun2-*.out.txt` | **包B 重建后复验 6 条**（含 firstrun dryRun / plugins / debug / chat-plain / func / ui-tools） |
| `logs\_reload-page.mjs` | 复跑前置 CDP 刷新页面脚本（工作文件） |
| `logs\_close-edge.mjs` | 收尾关闭 headless Edge 脚本（工作文件） |
| `dist\QingYaoTP AILauncher\logs\app.log` | 发布包服务日志（模型加载/切换时间线、无崩溃） |
| `/api/version`、`/api/sysinfo`、`/api/diag` | 发布包身份、推荐结果、健康检查（可随时复取） |
| `shots\` | 界面探针截图（含首跑与复跑） |
