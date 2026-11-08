# 2026-11-08 全量探针跑 · 独立验收报告（verify.md · 最终）

> 验收员：env-verifier（独立于执行者 probe-runner）
> 判定时间：2026-11-08 18:3x（Asia/Shanghai）
> 职责边界：只读 + 只写本 verify/ 目录；不跑探针、不启停服务、不动 8099/9333；不恢复会话（Lead 收口）。
> 原则：一切以 summary.txt、logs\、文件哈希、服务自身日志为准；不采信任何口头摘要。

## 0. 最终判定

**判定：可信（以 r2 为权威结果，r1 仅作对照）。**

- **r2（权威）**：53/53 条探针执行完毕，**52 PASS / 1 FAIL / 0 TIMEOUT**；唯一红 = probe-timestamps 3/4（FAIL 每条消息都有时间 times=1 rows=2）→ 红属实、自洽；**归因已由 task-5 定案**：跨轮残留的「无 t」夹具会话 + 产品侧一处低严重度真不一致（详见 2.3）。
- **完整性**：summary.txt 头部 (53 probes) + 53 条探针行 + # done 齐；logs\ 恰好 53 个 .out.txt + 53 个 .err.txt；shots\ 19 张；**0 个 server-restart-***。
- **代码未动**：9/9 受保护文件 SHA256 与 baseline 全 **MATCH**（源码 6 + dist 3）；git HEAD 仍 **4052e63**；git status 仅两个本轮产物目录未跟踪，无 modified/新增临时文件。
- **服务未崩**：服务进程自 17:55:02 起未重启（pid 35420 全程不变；r2 目录 0 个 server-restart 文件）；service.out/err 无 device lost / 崩溃记录；vulkan-crash.log 仅 3 条 **2026-10-31** 旧记录，本次无新增。
- **无假绿**：53 条逐条与 log 自洽；观测型探针（probe-ui-metric、probe-kv-long）本就没有断言计数（设计如此，不是假绿）；probe-func 9/9 为自定义「通过 N 项」格式；不存在「PASS 但 0 断言」的可疑条目。
- **r1（对照，不作权威）**：53 条同样跑完，**51 PASS / 2 FAIL / 0 TIMEOUT**；两条红均已定性为**非产品缺陷**——probe-code-panel 是**驱动传参缺陷**（已在本轮副本修正，r2 17/17），probe-ui-gpu 是 **Edge 扩展噪声**（复跑 7/7）。

## 1. 可信性前提（开跑前已独立复核）

baseline.json（2026-11-08T17:52:53，git HEAD 4052e63，gitDirty=[]，freeGB 284.1，probeCount 73 个脚本，8 个真实会话已备份到 docs\session-backups\2026-11-08_17-52-52\workspace-full，441 文件）。

我在 17:55:17 独立复核：9/9 文件哈希 MATCH、workspace\sessions=8 且与 baseline 名单逐一一致、git 仅本轮产物目录未跟踪、8099 由 node 形态进程占用、9333 headless Edge 单实例、8101 空闲。**baseline 本身可信，可作比对基准。**

证据：verify\pre-run-snapshot.txt、verify\expected-probes.txt。

## 2. 权威轮 r2 验收（server\docs\probe-full-2026-11-08-r2\）

### 2.1 产物完整性

| 项 | 应有 | 实测 | 结论 |
|---|---|---|---|
| summary 头 | # full suite … (53 probes) | 2026-11-08 18:15:32 (53 probes) | ✅ |
| 预加载行 | qwen2.5-7b-instruct-1m-q4_k_m.gguf | 已加载同款 | ✅ |
| 探针行 | 53 条、无重复 | 53 条，名字/顺序与 53 条权威清单**逐条一致** | ✅ |
| 尾部 | # done | # done 2026-11-08 18:28:30 | ✅ |
| logs | 53 .out.txt + 53 .err.txt | 106 文件恰好 53+53，无 rerun 杂物 | ✅ |
| shots | 有截图 | 19 张（ui-1…ui-7、ui-13…19、header、settings-*、ui-vision-*） | ✅ |
| server-restart-* | 0 | 0 | ✅ |
| baseline.json | 不得被改写 | SHA256 与 r1 版**完全一致**（4EECD199…D17），mtime 仍 17:52:53 | ✅ |

### 2.2 结果统计（逐条自洽）

- 墙钟 18:15:32 → 18:28:30 = **778s**；53 条探针耗时合计 **765.3s**（差 12.7s≈逐条 node 启动开销）→ **串行执行，无并行抢 9333**。
- 断言总数 **762**，失败 **1**；TIMEOUT **0**；FLAG 分布 52 PASS / 1 FAIL(exit 1)。
- 每条 summary 行与 logs\<name>.out.txt 的 RESULT/结果行、FAIL 行数、退出码一致；无「PASS 但 log 有 FAIL」「FAIL 但 log 无失败」的矛盾。
- 观测型无计数探针仅 probe-ui-metric、probe-kv-long（按设计输出指标/表格，exit 0；非假绿）。

### 2.3 唯一红项（原样取证）

probe-timestamps FAIL(exit 1) 5.5s RESULT 3/4，log 原文：

~~~text
{"rows":2,"times":["18:18"],"titles":["2026/11/8 18:18:56"]}
FAIL 每条消息都有时间  times=1 rows=2
ok   时间格式正确  [["18:18"]]
ok   悬停有完整时间
ok   新消息立即带时间  [18:18]

RESULT 3/4
~~~

**task-5 取证结论（已定案，我复核了其证据文件与 app.html 行号，确认属实）**

- **确定性 3/3 复现**：18:31 连跑 3 次全部 `rows=2 / times=1 / RESULT 3/4 / exit 1`；.msgTime 的 title 每次都等于当次运行时刻（18:31:25 / 18:31:37 / 18:31:49）→ 证明显示的是 `Date.now()` 兜底产物，不是存档真实时间。证据：`r2\logs\rerun-4-timestamps-{1,2,3}.{out,dump}.json`。
- **直接原因 = 跨轮残留的「无 t」夹具会话**：r1 的 probe-ui-sessions（#43，18:02:13–28）在 wipe 后用「旧版 localStorage 迁移」fixture 造了消息只有 `{role,content}`、**没有 t** 的会话（r1 留下的是 **mw7ny74f**，r2 起跑时服务端只剩它）；r2 的 probe-timestamps（#28，18:18:56）点 #recentOpen 打开的正是它 → 2 行只有 1 个 .msgTime。rerun-4 三次打开的是 r2 的 probe-ui-sessions（18:21:50）重建的同款会话 **mw7onerg**，机制相同。补正：Lead 口述中的 mw7onerg 是 rerun 时打开的 r2 重建版；**原 r2 失败打开的是 r1 残留版 mw7ny74f**，结论不变。
- **排除项**：该会话只有 `row user` / `row assistant` 两行，无 kind=second 行、无非消息行。
- **产品侧一处真不一致（低严重度，单列）**：同一份缺 t 数据，两条历史渲染路径不一致——用户行走 app.html:3391 → bubble() 的 **app.html:5546 `makeMsgTime(ts ?? Date.now())` 有兜底**，显示一个「当前时间」的**假时间**；助手行走 app.html:3392 → renderStoredAssistant 的 **app.html:3373 `makeMsgTime(entry.t)` 无兜底** → 该行没有时间。四处源码行号我已独立核对。
- **另有一处本轮未触发（潜在）**：live 第二意见行在 app.html:6824 建 `row assistant second streaming`，其 stats 在 6947–6950 只挂 makeSpeakBtn/formatStats、**没有 makeMsgTime**；刷新后由 3373/3374 渲染则**有时间** → live 与刷新后不一致。本轮因先撞上缺 t 会话，未走到该路径。
- **定性**：本条红 = **探针侧诱因（跨轮夹具残留 + #28 打开的不是自己造的会话）+ 产品侧低严重度真不一致（缺 t 历史数据的用户行显示假时间）**，**不是 flaky**；且在现有探针序列下**每轮必红**（#28 永远在 #43 之前，永远打开上一轮 #43 留下的无 t 会话），除非修夹具或修断言。

### 2.4 修正驱动独立核验

- 11-02 版权威驱动：server\docs\probe-full-2026-11-02\run-full.ps1，SHA256 **FF1D3480…C69287C**，mtime 2026-11-07T13:40:08（**未被动过**，与本轮开始前记录的哈希一致）。
- 本轮副本：server\docs\probe-full-2026-11-08\run-full.ps1，SHA256 **A13281AC…DE19A7B**，11128B，195 行；BOM=EF BB BF，PowerShell Parser 报错 **0**。
- **逐行 diff：195/195 行，唯一差异 = 第 135 行**
  - 11-02：`@{n='probe-code-panel'; a=@($cdp); t=150},`
  - 副本：`@{n='probe-code-panel'; a=@($base,$cdp); t=150},` + 行尾注释说明。
- 与 probe-code-panel.mjs 源码签名 `node probe-code-panel.mjs [base] [cdp]` 比对：**原驱动只传 cdp，探针把 9333 当成 base 去找 8099 页面 → 必然 no page / exit 2**。这一归因由我独立复现逻辑链确认，不是采信口述。
- 旁证：r2 中 probe-code-panel **17/17（跳过 1 条无模型 409 断言）**，说明副本修正确实生效。

### 2.5 r2 环境证据

- 服务：/api/version = 1.3.0 / commit 4052e63 / dirty=false / buildSource=git / node v24.17.0 / pid 35420 / port 8099 / startedAt=2026-11-08T09:54:58Z（=17:54:58）。**与 r1 同一进程、全程未重启**。
- 服务日志（r1 目录 service.out.txt，r2 复用同一进程故日志连续）：r2 时段 18:15:25→18:28:30 无「device lost」、无崩溃/拉起/切 CPU；仅探针自身的模型装卸、会话增删、备份与视觉 sidecar 起停。
- 视觉 sidecar：18:28:09 启动 pid 22700 → 18:28:23 就绪 → 18:28:28 停止 → 18:28:30 退出（code=1，与 r1 一致的正常停止码）；跑后 **8101 空闲、无残留进程**。
- vulkan-crash.log：内容仍是 3 条 2026-10-31 旧记录；18:16:49 的 mtime 变化是 probe-debug「调试面板：清理崩溃记录 成功」重写所致，**不是新崩溃**。
- 端口/进程：8099 pid 35420、9333 pid 38792（单个 headless Edge）；无遗留 probe-*.mjs / mmproj / 视觉进程。
- 跑后 /api/state：models=7，loaded 为空（最后一条 probe-vision-api 会先卸载文本模型给 sidecar 让内存，属预期终态；r1 是由 runner 在跑后手动重新 preload 的）。

## 3. 对照轮 r1（server\docs\probe-full-2026-11-08\）

- 同样 53/53 条、# done（17:55:44 → 18:08:45，墙钟 781s，耗时合计 770.0s）、53+53 logs + 19 shots、0 server-restart。
- 结果：**51 PASS / 2 FAIL / 0 TIMEOUT（53 条，51+2=53）**；断言总数 745、失败 1（ui-gpu），另有 probe-code-panel 因 no page 执行了 **0 条断言**。
- **更正记录（2026-11-08 18:4x，Lead 指正）**：本报告初稿把 r1 误写成「52 PASS / 2 FAIL」。原因是我把 r2 的「52 PASS」直接抄进了 r1 段落，**没有用「53 − 2 条非 PASS = 51」重新算**；另一个诱因是 r1 的 probe-code-panel 标 FAIL(exit 2) 但 0 条断言，我一度按「断言失败数」口径把它算成不算一条红，若那样 STA 会多出一条 PASS——但 summary 的 FLAG 口径是「非 PASS」，它就是一条 FAIL。现已按解码后的 r1 summary 逐条重数：**非 PASS 只有 probe-code-panel(exit 2) 与 probe-ui-gpu(6/7) 两条，其余 51 条 PASS**。教训：PASS 数必须由「总条数 − 非 PASS 条数」重算，且同时给出 绿+红=总数 的自校验（51+2=53）。
- 红 1 **probe-code-panel FAIL(exit 2) 0.8~1.2s，out=「no page」**：驱动传参缺陷（见 2.4），**非产品缺陷**；r2 修正后 17/17。v13（11-07 整跑中途作废那轮）同一位置同样 no page，可交叉印证。
- 红 2 **probe-ui-gpu FAIL 6/7**：唯一失败断言「没有未捕获的 JS 错误」，错误为 `Could not establish connection. Receiving end does not exist.`（Edge 扩展运行时消息噪声；该 Edge 临时 profile 内有 3 个扩展的 background/service_worker）。runner 在 18:12 复跑得 **7/7 全绿**。**归因：环境/浏览器侧，非产品**。
- r1 的 logs\ 比 53 套多出 **2 对复跑产物**：rerun-1-probe-code-panel（仍 no page）、rerun-2-probe-ui-gpu（7/7）。这是 r1 里的额外取证，不改变 r1 summary；也说明 r1 不能当「一次干净全量」的权威产物（r2 没有 rerun 杂物）。
- 结论：**r1 因驱动 bug 不作权威**，但作为对照证明「缺陷定位正确、与产品无关」。

## 4. 受保护文件哈希（跑后重算，均与 baseline 比对）

| 文件 | 结果 |
|---|---|
| server\app.mjs | MATCH |
| server\app.html | MATCH |
| server\doc-extract.mjs | MATCH |
| server\config-recommend.mjs | MATCH |
| server\debug.html | MATCH |
| server\package.json | MATCH |
| dist\QingYaoTP AILauncher\app\app.mjs | MATCH |
| dist\QingYaoTP AILauncher\app\app.html | MATCH |
| dist\QingYaoTP AILauncher\config.ini | MATCH |

dist\ 本轮不参与运行，全部 MATCH 且 mtime 仍是 11-07 → **dist 未被碰过**。

## 5. git 与仓库卫生

- HEAD = **4052e63a18737cc53be8c3ad9fe7bf279a91071c**（未变）。
- git status --porcelain 仅：
  - `?? server/docs/probe-full-2026-11-08/`
  - `?? server/docs/probe-full-2026-11-08-r2/`
  → 都是本轮产物目录，属预期；**无 modified 的已跟踪文件**（git diff 为空），无仓库内临时文件。logs\、shots\、summary.txt、server-restart-* 均被 .gitignore 覆盖，不产生脏区。
- 本轮窗口（17:54–18:31）server\ 与 dist\ 下被写的文件只有：`server\server.pid`（17:55:02 服务启动）、`server\vulkan-crash.log`（17:57:04 / 18:16:49 两次被 probe-debug「清理崩溃记录」重写）——均为运行期文件且被 gitignore。
- 探针会把截图写到固定目录（如 docs\feature-code-workspace-2026-11-07\logs\code-panel-*.png、docs\ui-new\status.png），这些 .png 已被 gitignore，**不构成仓库污染**，但属探针产物落点不规范，可记一笔。

## 6. 数据污染范围（只记录，不恢复）

| 项 | 跑前 | r1 后 | r2 后 | 说明 |
|---|---|---|---|---|
| workspace\sessions | 8 个真实会话（名单与 baseline 一致） | 1 个探针会话（mw7ny74f，「旧版 localStorage 迁移」无 t 夹具） | 1 个探针会话（mw7onerg，同款夹具） | probe-ui-sessions 的 wipe() 会清空**服务端所有会话**，属预期破坏性行为；真实会话已由 Lead 于 17:52:52 备份。残留的无 t 夹具会直接导致下一轮 probe-timestamps 红（见 2.3） |
| 真实会话备份 | Lead: workspace-full **441 文件 / 516291B** | 完好 | 完好 | ✅ 未被破坏 |
| wipe 自备份 | — | 2026-11-08T10-02-14：**10 份**（8 真实 + 2 探针新建） | 2026-11-08T10-21-50：**3 份**（1 残留 + 2 探针新建） | wipe() 删除前自动整份备份（已知设计） |
| workspace\code | 1 项（snippet.js，11-07） | 1 项 | 1 项 | 探针建的文件均已自复位删除 |
| workspace\rag\index.json | 存在 | 被 probe-rag 重建（18:01:03） | 被 rebuild（18:20:44） | 探针预期副作用 |
| workspace\backup.json | 74B，11-07 mtime | 被 probe-backup 写（18:01:35） | 被写（18:21:15） | 探针预期副作用 |
| workspace\plugins.json | 存在 | 被写（18:16:46） | 被写（18:16:46 前） | 探针临时插件预期副作用 |

**未越界**：产品源码、dist、config.ini、package.json、探针脚本均未被改写；会话备份目录完整；不恢复会话（Lead 负责）。

## 7. 逐项检查表（最终）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | r2 summary 含 # done | ✅ 18:28:30 |
| 2 | r2 探针行 = 53 且与权威清单顺序一致 | ✅ |
| 3 | r2 logs 53+53、无多余/缺失 | ✅ |
| 4 | r2 每条 flag/exit/fails/结果行自洽 | ✅（逐条脚本核对） |
| 5 | 红项取证：probe-timestamps 3/4 | ✅ 红属实，归因已定案（3/3 复现 + 夹具残留 + 产品低严重度真不一致，见 2.3） |
| 6 | 无 PASS 但 0 断言的假绿 | ✅（2 条为观测型探针，设计无断言） |
| 7 | 9/9 受保护文件哈希 MATCH | ✅ |
| 8 | git HEAD 不变、无 tracked 修改 | ✅ |
| 9 | 服务 0 重启 / pid 不变 | ✅ |
| 10 | 无 device lost / 崩溃新增记录 | ✅ |
| 11 | 8101 无 sidecar 残留、9333 单实例 | ✅ |
| 12 | 会话被清范围与备份完整 | ✅ 记录在案 |
| 13 | 修正驱动差异仅 1 行、11-02 原文件未动 | ✅ |
| 14 | r2 baseline 未被改写 | ✅ |

## 8. 可疑点 / 注意事项（不影响「结果可信」判定）

1. **r2 复用了 r1 的服务进程**（pid 35420，起于 17:54:58），没有为 r2 全新拉起服务。好处：全程 0 重启、无 device lost；代价：r2 不是「全新进程 + 全新内存」的跑，严格意义上与「全新安装形态」不同。建议下一轮权威跑前重启一次服务并在 summary 记录 pid。
2. **r2 的环境预置没有补种会话，且这个残留直接造成了唯一红**：驱动 Seed-Workspace 只在「会话为空」时造会话，r2 起跑时已有 1 个 r1 残留的「无 t」迁移夹具会话（mw7ny74f），因此跳过补种；r2 的 probe-timestamps（#28）随后点 #recentOpen 打开的正是它 → 红（task-5 已定案，见 2.3）。这说明「跨轮不清 workspace」会让上一轮的破坏性探针夹具污染下一轮的语义型断言。建议下一轮权威跑前重置 workspace（或至少删掉 ui-sessions 留下的迁移会话）。
3. 该红的取证窗口问题已由 task-5 用 rerun-4 现场 dump 补上（3/3 确定性复现 + DOM/存档双取证）；但仍建议 probe-timestamps 在失败时把 rows/times 的 outerHTML 直接写进 log，降低下次取证成本。
4. summary.txt 是混合编码（表头 UTF-8 BOM + 逐条 UTF-16LE + 尾部 UTF-8），是该驱动 `Tee-Object -Append` 的已知行为，**不是本轮缺陷**；但用普通 UTF-8 读会误判成 0 条探针行，验收/后续工具需按混合编码解析（我已留 verify\r1-summary.decoded.txt、verify\r2-summary.decoded.txt）。
5. r1 的 probe-ui-gpu 红（Edge 扩展噪声）提示：界面探针的『没有未捕获 JS 错误』断言会被 Edge 扩展 runtime 报错污染，建议把扩展消息过滤掉（或专用干净 profile）。

## 9. 证据文件（全部在 verify\ 下）

| 文件 | 内容 |
|---|---|
| verify.md | 本报告 |
| pre-run-snapshot.txt | 开跑前 9 文件哈希 / sessions / 代码目录 |
| post-run-snapshot.txt | r1 跑后哈希 / sessions / 仓库写文件扫描 / 备份计数 |
| r2-post-run-snapshot.txt | r2 跑后哈希 / 驱动 diff / 端口进程 / 崩溃日志 |
| expected-probes.txt | 53 条权威清单 + 11-02 驱动 SHA256 |
| r1-summary.decoded.txt / r2-summary.decoded.txt | 混合编码正确解码后的 summary（含 # done） |
| selfconsistency.tsv | r1 53 条逐条 flag/断言/自洽标记 |
| （外部）server\docs\probe-full-2026-11-08-r2\logs\rerun-4-findings.md | task-5 对唯一红的取证报告（3/3 复现、DOM/存档 dump、源码行号） |
| （外部）同目录 rerun-4-timestamps-{1,2,3}.{out,err}.txt / .dump.json | task-5 三次复跑与现场 DOM/会话存档取证 |
| assertions.txt | r1 断言统计与每条断言数 |
| r1-recount.txt | r1 FLAG 重数证据：53 条 = 51 PASS + 2 非 PASS（更正用） |

## 10. 收口建议

1. **采用 r2 作为本轮回归证据**：53 条 / 52 绿 / 1 红（probe-timestamps），0 重启、0 假绿、代码零改动、环境未污染。
2. 驱动修复**应上游化**：把 `probe-code-panel` 参数改成 `a=@($base,$cdp)` 同步进 server\docs\probe-full-2026-11-02\run-full.ps1（下次全量的基准），否则下一轮还会红。
3. probe-timestamps 已定案（task-5）：按成本三选一——①（最稳，改探针）断言只统计「有 t 的存档行」，缺 t 是合法旧数据形态；②（更根治，改探针）probe-ui-sessions 的迁移 fixture 两条消息补 `t: Date.now()`，顺带修掉跨轮污染；③（可选，改产品）历史渲染的用户行不要复用 `ts ?? Date.now()` 兜底 / 迁移写入路径统一补 t——现状是同一份缺 t 数据用户行显示假时间、助手行不显示。另建议顺手修 live 第二意见行缺 makeMsgTime（app.html 6824/6947–6950）与刷新后不一致的问题。**不修根因的话，当前序列下每轮都会红。**
4. Lead 收口时用 docs\session-backups\2026-11-08_17-52-52\workspace-full 恢复 8 个真实会话（另有 wipe 自备份 2026-11-08T10-02-14 的 10 份可交叉校验）。
5. 下轮权威跑建议：全新服务进程 + 明确记录起跑 sessions 状态；界面探针使用干净 Edge profile 过滤扩展噪声。

---
（本报告基于只读核验与哈希比对写成；所有数字均可由 verify\ 下证据文件与 summary/log 复算。）