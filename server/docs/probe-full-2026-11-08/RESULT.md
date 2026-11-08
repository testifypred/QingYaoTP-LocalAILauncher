# 全量探针 2026-11-08（v1.3.0 第十三轮）：首跑 r1 + 修正驱动整跑 r2

> **结论（r2 为权威）：53 条 / 762 断言 —— 761 通过 / 1 失败 / 2 条件跳过 / 0 超时；52 条绿 / 1 条红；0 崩溃 / 0 重启；12 分 58 秒**（18:15:32 → 18:28:30）。
> 唯一红项 `probe-timestamps`（3/4）**不是 flaky**：它打开了 r1 遗留的「localStorage 迁移夹具会话」，那两条消息**没有 `t`**，用户行走了 `Date.now()` 兜底（所以只显示「18:18:56」这个渲染时刻），助手行没渲染时间 ⇒ `times=1 rows=2`。**产品侧 0 回归**；同时顺带确认了两处**低严重度的产品时间显示不一致**（迁移不补 `t`、第二意见 live 行缺 `makeMsgTime`），见三.3。
> r1（17:55:44 → 18:08:45）：**51 绿 / 2 红**——① `probe-code-panel` = **驱动传参缺陷**（已在 r2 用的驱动副本里修正，整跑 17/17）；② `probe-ui-gpu` = **Edge 扩展噪声**（单跑复跑 7/7）。
> **v1.3.0 可以作为回归基线**，但下一轮跑之前必须二选一：换干净工作区（或从备份恢复），或先修掉迁移夹具/迁移补 `t` 的问题，否则 `probe-timestamps` 会继续红。

## 一、环境与方法

| 项 | r1 | r2（权威） |
|---|---|---|
| 时间 | 17:55:44 → 18:08:45（781s） | 18:15:32 → 18:28:30（778s） |
| 被测对象 | 源码模式 `node app.mjs`（`D:\LocalModels\server`，8099） | 同左（**同一个服务进程，中间没有重启**：`/api/version` 启动时刻两轮都是 2026-11-08T09:54:58.675Z） |
| 版本 / 基线 | v1.3.0；git `4052e63`，`dirty=false` | 同左 |
| 界面 | headless Edge，CDP 9333，1440×900 | 同左 |
| 模型 | 驱动预加载 `qwen2.5-7b-instruct-1m-q4_k_m.gguf`，context 16384 | 同左 |
| 驱动 | `server\docs\probe-full-2026-11-02\run-full.ps1`（53 条清单；`probe-code-panel` 那行只传 `@($cdp)`） | **本轮副本** `server\docs\probe-full-2026-11-08\run-full.ps1`：只改 `probe-code-panel` 一行 `a=@($cdp)` → `a=@($base,$cdp)` + 行尾注释 |
| 驱动副本校验 | — | 195 行 → 195 行，`Compare-Object` 只有 1 行差异；BOM `EF BB BF` 完好；PowerShell 5.1 `[Parser]::ParseFile` **0 错误**；11-02 历史文件未动 |
| 输出目录 | `server\docs\probe-full-2026-11-08\` | `server\docs\probe-full-2026-11-08-r2\` |
| 工作区 | Lead 已备份（`session-backups\2026-11-08_17-52-52\workspace-full`，441 文件 / 8 个真实会话） | 沿用 r1 结束时的同一工作区（**这是 r2 唯一红的来源**，见三.3） |

> 编码警告：`summary.txt` 是 **UTF-8 BOM 头 + `Tee-Object -Append` 追加的 UTF-16LE 段**混排。按单字节/纯 UTF-8 去 grep 会得到 `p r o b e - s e s s i o n s` 这种带 NUL 的串，统计必须逐段识别编码（见六）。

## 二、首跑 r1：51 绿 / 2 红（53 条 / 745 断言）

## 2.1 逐条结果

> 断言数按 `logs\*.out.txt` 逐条解析（`== 结果: N 通过 / M 失败 ==` / `RESULT N/M` / `通过 N 项，失败 M 项`），不是只抄 summary。

| # | 探针 | 断言 | 耗时 | 结果 | 备注 |
|---|---|---|---|---|---|
| 1 | `probe-sessions` | 33/33 | 0.9s | ✅ | — |
| 2 | `probe-workspace-api` | 9/9 | 0.6s | ✅ | — |
| 3 | `probe-code-run` | 13/13 | 24.9s | ✅ | 含 C++ 编译（编译 30s / 运行 10s） |
| 4 | `probe-code-workspace` | 21/21（+跳过 1） | 0.8s | ✅ | 无模型 409 条件断言跳过 |
| 5 | `probe-gpu` | 14/14 | 1.4s | ✅ | — |
| 6 | `probe-ui-gpu` | 6/7 | 8s | ❌ FAIL(exit 1) | **红** 6/7：Edge 扩展噪声；18:12 单跑复跑 **7/7** |
| 7 | `probe-ui-metric` | 0（未执行） | 9.3s | ✅ | 信息型，无断言 |
| 8 | `probe-backup` | 38/38 | 18s | ✅ | — |
| 9 | `probe-rag` | 16/16 | 0.9s | ✅ | 索引 4→6 文件 / 12→14 chunks |
| 10 | `probe-plugins` | 11/11 | 0.8s | ✅ | — |
| 11 | `probe-version` | 14/14 | 0.6s | ✅ | git `4052e63` / v1.3.0 / 启动 17:54:58 |
| 12 | `probe-firstrun` | 22/22 | 0.6s | ✅ | — |
| 13 | `probe-debug` | 35/35 | 3.3s | ✅ | KV `q8_0` 三方一致 |
| 14 | `probe-func` | 9/9 | 29s | ✅ | 只打「通过 9 项」 |
| 15 | `probe-ui-new` | 30/30 | 9.1s | ✅ | — |
| 16 | `probe-start-screen` | 12/12 | 5.7s | ✅ | 问候语按设计走 11–18 点分支 |
| 17 | `probe-start-flow` | 8/8 | 18.3s | ✅ | — |
| 18 | `probe-model-add` | 4/4 | 8.8s | ✅ | — |
| 19 | `probe-menu-stacking` | 2/2 | 3.8s | ✅ | — |
| 20 | `probe-status` | 6/6 | 3.8s | ✅ | — |
| 21 | `probe-code-panel` | 0（未执行） | 1.2s | ❌ FAIL(exit 2) | **红** 0 断言：驱动传参错（§2.2） |
| 22 | `probe-settings-tools` | 9/9 | 5.5s | ✅ | — |
| 23 | `probe-workspace-ui` | 7/7 | 8.2s | ✅ | — |
| 24 | `probe-hero-modes` | 11/11 | 6.1s | ✅ | — |
| 25 | `probe-input-extras` | 8/8 | 8.3s | ✅ | — |
| 26 | `probe-formula-panel` | 7/7 | 7.6s | ✅ | — |
| 27 | `probe-formula-find` | 8/8 | 7.3s | ✅ | — |
| 28 | `probe-timestamps` | 4/4 | 5.5s | ✅ | — |
| 29 | `probe-small-features` | 6/6 | 10.2s | ✅ | — |
| 30 | `probe-title-ui` | 13/13 | 8.3s | ✅ | — |
| 31 | `probe-session-jump` | 4/4 | 7.6s | ✅ | — |
| 32 | `probe-session-race` | 3/3 | 5.7s | ✅ | — |
| 33 | `probe-ctx-panel` | 25/25 | 13.2s | ✅ | — |
| 34 | `probe-code-run-ui` | 9/9 | 4.4s | ✅ | — |
| 35 | `probe-ui-tools` | 12/12 | 19.3s | ✅ | 1 张工具卡片 + 刷新恢复 |
| 36 | `probe-ui-web` | 39/39 | 36.5s | ✅ | 联网卡片 + 刷新恢复 |
| 37 | `probe-ui-rag` | 6/6 | 5.1s | ✅ | — |
| 38 | `probe-ui-version` | 9/9 | 5.4s | ✅ | — |
| 39 | `probe-ui-debug` | 25/25 | 15.9s | ✅ | — |
| 40 | `probe-ui-backup` | 20/20 | 10.3s | ✅ | — |
| 41 | `probe-sidebar-search` | 11/11 | 11.8s | ✅ | — |
| 42 | `probe-auto-title` | 5/5 | 26.3s | ✅ | — |
| 43 | `probe-ui-sessions` | 27/27 | 14.2s | ✅ | 破坏性：wipe 前自动备份 |
| 44 | `probe-chat-plain` | 11/11 | 6.9s | ✅ | 流式 39 块；复用 7% |
| 45 | `probe-tools-agent` | 24/24 | 114.1s | ✅ | — |
| 46 | `probe-web-tools` | 19/19 | 85.4s | ✅ | — |
| 47 | `probe-kv-long` | 0（未执行） | 24.7s | ✅ | 信息型；第 2/3 轮复用 99% |
| 48 | `probe-context-switch` | 3/3 | 28.8s | ✅ | — |
| 49 | `probe-ui-preload` | 35/35 | 27.3s | ✅ | — |
| 50 | `probe-preload` | 26/26 | 22.6s | ✅ | 重复预加载 reused=true |
| 51 | `probe-second-opinion` | 11/11 | 38.1s | ✅ | — |
| 52 | `probe-ui-vision` | 19/19 | 6.4s | ✅ | **新增**；19 条 |
| 53 | `probe-vision-api` | 25/25 | 23.2s | ✅ | **新增**；25 条 |

## 2.2 红项 1 · `probe-code-panel`（exit 2，0 断言）—— **驱动传参缺陷，非环境、非产品**

- **现象**：`logs\probe-code-panel.out.txt` 全文只有一行 `no page`，exit 2，17 条断言一条未执行；18:12 单条复跑仍 `no page`（`logs\rerun-1-probe-code-panel.out.txt`）。
- **根因（证据链）**：
  1. 探针签名是 `[base] [cdp]`：`probe-code-panel.mjs:15-16` `BASE=argv[2]` / `CDP=argv[3]`，随后 `PORT=new URL(BASE).port`，页面按 `url.includes('127.0.0.1:'+PORT)` 查找；
  2. 驱动清单行只传一个参数：`@{n='probe-code-panel'; a=@($cdp); t=150}` → `BASE` 变成 `http://127.0.0.1:9333` → `PORT=9333` → 永远找不到 8099 页面；
  3. **git 漂移点**：`6544f3f`（v1.2.0）重写该探针时把签名从「硬编码 9333 / 匹配 8099」改成 `[base] [cdp]`（旧版：`const list = await fetch("http://127.0.0.1:9333/json/list")`、`t.url.includes("8099")`），但驱动那行没同步；`2701b19`（v1.3.0 视觉）把清单 51→53 时也没碰它；
  4. **反证**：同一时段的 `probe-ui-gpu`（签名 `[cdp] [app]`，30 秒后在同一个 9333 上找到 8099 页面）单跑复跑 **7/7**，本轮其他 UI 探针也全绿 ⇒ 页面在、问题只在参数。
- **归类**：**工具链缺陷（探针/驱动接口不一致）**。
- **修法 / 结果**：本轮驱动副本把该行改成 `a=@($base,$cdp)` 后，**r2 整跑 17/17（跳过 1）**。建议把这行回写到 11-02 权威驱动，否则下次复制又带病。

## 2.3 红项 2 · `probe-ui-gpu`（6/7，8s）—— **headless Edge 扩展噪声**

- **红断言**：`没有未捕获的 JS 错误`，detail 是两条 `Error: Could not establish connection. Receiving end does not exist.`
- **证据**：① `app.html` 与 `server\*.mjs` 全仓 grep `chrome.runtime` / `sendMessage` **0 命中**；② `probe-ui-gpu` 的 JS 错误收集把 `Runtime.exceptionThrown` 全部算进来，没区分执行上下文；③ 该 Edge 临时 profile 里确实有 **3 个扩展的 background/service_worker**（独立验收记录在 `verify\verify.md` §3）；④ 18:12 单跑复跑 **7/7 全绿**（`logs\rerun-2-probe-ui-gpu.out.txt`），r2 整跑也是 **7/7**。
- **归类**：**环境问题（Edge headless 预置扩展噪声）**；功能断言（页签/后端/设备数/自动/写盘分支/恢复）当轮就全绿。

## 三、修正驱动后整跑 r2（权威）：52 绿 / 1 红（53 条 / 762 断言）

## 3.1 总数

| 项 | 值 |
|---|---|
| 探针数 | **53** |
| 断言 | **762**：761 通过 / 1 失败；另 **2 条条件跳过**（`probe-code-workspace` 与 `probe-code-panel` 各自的「无模型 409」，本轮已加载 7B） |
| 结果 | **52 PASS / 1 FAIL / 0 TIMEOUT** |
| 崩溃 / 重启 | **0 / 0**（summary 无 `[driver] 服务已退出`；`vulkan-crash.log` 只有 10-31 的 3 条旧记录） |
| 耗时 | **778s（12 分 58 秒）**；最慢 `probe-tools-agent` 102.7s、`probe-web-tools` 90.7s |
| 与 r1 的 3 处差异 | `probe-code-panel` 0 → **17/17**（驱动修正生效）；`probe-ui-gpu` 6/7 → **7/7**（噪声未复现）；`probe-timestamps` 4/4 → **3/4**（跨轮夹具污染） |

## 3.2 逐条结果

| # | 探针 | 断言 | 耗时 | 结果 | 备注 |
|---|---|---|---|---|---|
| 1 | `probe-sessions` | 33/33 | 0.9s | ✅ | — |
| 2 | `probe-workspace-api` | 9/9 | 0.7s | ✅ | — |
| 3 | `probe-code-run` | 13/13 | 23.1s | ✅ | 含 C++ 编译（编译 30s / 运行 10s） |
| 4 | `probe-code-workspace` | 21/21（+跳过 1） | 0.9s | ✅ | 无模型 409 条件断言跳过 |
| 5 | `probe-gpu` | 14/14 | 0.6s | ✅ | — |
| 6 | `probe-ui-gpu` | 7/7 | 8.1s | ✅ | **7/7**：r1 的扩展噪声未复现 |
| 7 | `probe-ui-metric` | 0（未执行） | 9.1s | ✅ | 信息型，无断言 |
| 8 | `probe-backup` | 38/38 | 16.8s | ✅ | — |
| 9 | `probe-rag` | 16/16 | 0.8s | ✅ | 索引 4→6 文件 / 12→14 chunks |
| 10 | `probe-plugins` | 11/11 | 0.7s | ✅ | — |
| 11 | `probe-version` | 14/14 | 0.6s | ✅ | git `4052e63` / v1.3.0 / 启动 17:54:58 |
| 12 | `probe-firstrun` | 22/22 | 0.7s | ✅ | — |
| 13 | `probe-debug` | 35/35 | 3.1s | ✅ | KV `q8_0` 三方一致 |
| 14 | `probe-func` | 9/9 | 23.7s | ✅ | 只打「通过 9 项」 |
| 15 | `probe-ui-new` | 30/30 | 9.1s | ✅ | — |
| 16 | `probe-start-screen` | 12/12 | 5s | ✅ | 问候语按设计走 11–18 点分支 |
| 17 | `probe-start-flow` | 8/8 | 16.4s | ✅ | — |
| 18 | `probe-model-add` | 4/4 | 9.4s | ✅ | — |
| 19 | `probe-menu-stacking` | 2/2 | 4.3s | ✅ | — |
| 20 | `probe-status` | 6/6 | 4.1s | ✅ | — |
| 21 | `probe-code-panel` | 17/17（+跳过 1） | 7s | ✅ | **17/17**：驱动修正生效（r1 是 0 断言） |
| 22 | `probe-settings-tools` | 9/9 | 5.7s | ✅ | — |
| 23 | `probe-workspace-ui` | 7/7 | 8.1s | ✅ | — |
| 24 | `probe-hero-modes` | 11/11 | 6.1s | ✅ | — |
| 25 | `probe-input-extras` | 8/8 | 8.5s | ✅ | — |
| 26 | `probe-formula-panel` | 7/7 | 7.5s | ✅ | — |
| 27 | `probe-formula-find` | 8/8 | 7.2s | ✅ | — |
| 28 | `probe-timestamps` | 3/4 | 5.5s | ❌ FAIL(exit 1) | **红** 3/4：最近会话是 r1 遗留的迁移夹具（消息无 `t`，§3.3） |
| 29 | `probe-small-features` | 6/6 | 9.2s | ✅ | — |
| 30 | `probe-title-ui` | 13/13 | 7.1s | ✅ | — |
| 31 | `probe-session-jump` | 4/4 | 7.6s | ✅ | — |
| 32 | `probe-session-race` | 3/3 | 5.7s | ✅ | — |
| 33 | `probe-ctx-panel` | 25/25 | 13s | ✅ | — |
| 34 | `probe-code-run-ui` | 9/9 | 4.9s | ✅ | — |
| 35 | `probe-ui-tools` | 12/12 | 20.4s | ✅ | 1 张工具卡片 + 刷新恢复 |
| 36 | `probe-ui-web` | 39/39 | 34.1s | ✅ | 联网卡片 + 刷新恢复 |
| 37 | `probe-ui-rag` | 6/6 | 5.1s | ✅ | — |
| 38 | `probe-ui-version` | 9/9 | 5s | ✅ | — |
| 39 | `probe-ui-debug` | 25/25 | 15.8s | ✅ | — |
| 40 | `probe-ui-backup` | 20/20 | 9.3s | ✅ | — |
| 41 | `probe-sidebar-search` | 11/11 | 11.1s | ✅ | — |
| 42 | `probe-auto-title` | 5/5 | 23.8s | ✅ | — |
| 43 | `probe-ui-sessions` | 27/27 | 13.9s | ✅ | 破坏性：wipe 前自动备份 |
| 44 | `probe-chat-plain` | 11/11 | 5.7s | ✅ | 流式 39 块；复用 7% |
| 45 | `probe-tools-agent` | 24/24 | 102.7s | ✅ | — |
| 46 | `probe-web-tools` | 19/19 | 90.7s | ✅ | — |
| 47 | `probe-kv-long` | 0（未执行） | 40.8s | ✅ | 信息型；第 2/3 轮复用 99% |
| 48 | `probe-context-switch` | 3/3 | 30.2s | ✅ | — |
| 49 | `probe-ui-preload` | 35/35 | 27.9s | ✅ | — |
| 50 | `probe-preload` | 26/26 | 25.2s | ✅ | 重复预加载 reused=true |
| 51 | `probe-second-opinion` | 11/11 | 33.7s | ✅ | — |
| 52 | `probe-ui-vision` | 19/19 | 6.4s | ✅ | **新增**；19 条 |
| 53 | `probe-vision-api` | 25/25 | 22.3s | ✅ | **新增**；25 条 |

## 3.3 唯一红项 · `probe-timestamps`（3/4）—— 跨轮残留夹具 + 探针依赖 #recentOpen

**红了哪条 + 实际值 vs 期望**（log 原行）：

  > {"rows":2,"times":["18:18"],"titles":["2026/11/8 18:18:56"]}
  > FAIL 每条消息都有时间  times=1 rows=2

期望 `times >= rows`（2 条消息 2 个时间），实际只有 1 个，且那个时间是 **18:18:56 = 探针渲染时刻**，不是消息时间。

**因果链（直接原因：跨轮残留夹具 + 对 #recentOpen 的依赖）**

1. **r1 同探针是绿的**：r1 的 `probe-timestamps`（17:59）点 #recentOpen 打开的是真实会话 `mw6hhdy0`（11-07 22:13），两条消息都带 `t` ⇒ 4/4。
2. **r1 的 #43 `probe-ui-sessions`（18:02）先 wipe 服务端会话**（设计行为，删前已备份 10 个会话到 `session-backups\2026-11-08T10-02-14\`），再用「旧版 localStorage 迁移」fixture 造了一个会话 `mw7ny74f`：两条消息只有 `{role, content}`、**没有 `t`**（`probe-ui-sessions.mjs:72-75`）。这条会话留在服务端，成为「最近会话」。
3. **r2 的 #28 `probe-timestamps`（18:18:56）点 #recentOpen 打开的正是它** ⇒ `rows=2 / times=1`。r2 的 #43 在 18:21:50 又 wipe 重建了同款夹具 `mw7onerg`，所以 18:31 的 3 次复跑打开的是这一条——**同一形态，3/3 确定性复现**。
4. **task-5 双取证**：
   - 3 次连跑全部 `3/4`、`rows=2 / times=1`；时间戳标题每次都等于「运行时刻」（18:31:25 / 18:31:37 / 18:31:49）——正是 `Date.now()` 兜底，不是存档时间；
   - DOM dump：`row user` 有 `.msgTime`，`row assistant` 没有；
   - 存档 dump：`GET /api/sessions/mw7onerg` 两条消息 `hasT=false`、`keys=role,content`；
   - 明确排除两种假设：该会话没有 `kind=second` 的行（**不是第二意见行**）、`#msgs` 里也没有混入非消息行（**不是 .row 计数问题**）。
5. **归类**：**环境/状态污染（跨轮夹具残留）**，不是 flaky、也不是本轮改动引入的功能回归；但它同时暴露了产品侧一处低严重度不一致（P1）与另一处本轮未触发的真实不一致（P2）。

**产品侧同时暴露的不一致（低严重度）**

| # | 现象 | 代码位置 | 影响 |
|---|---|---|---|
| P1（本轮红项直接暴露） | **同一份「缺 t」数据两条渲染路径不一致**：用户行走 `bubble()` 的 `ts ?? Date.now()` 兜底 ⇒ 显示**假时间（运行时刻）**；助手行走 `makeMsgTime(entry.t)` 且无兜底 ⇒ 返回 null ⇒ **没有时间** | `renderStored()` `app.html:3391/3392`；用户行 `3391` → `bubble()` `5546`；助手行 `renderStoredAssistant()` `3373-3374` | 旧数据/迁移会话里，用户行时间显示为「现在」、助手行什么都不显示——视觉上自相矛盾 |
| P2（本轮**未触发**，单列） | **live 第二意见行没有时间戳，刷新后才有**：`oneSecondOpinion()` 组装 stats 只加朗读按钮 + 指标（`app.html:6947-6950`），**没有 `makeMsgTime`**；刷新后重建同一行走 `renderStoredAssistant()`（`3374`）**有**；正常助手 live 行也是有的（`5788-5789`），唯独第二意见行漏了 | `app.html:6824`、`6947-6950` vs `3373-3374`、`5788-5789` | live 看二意见行没时间、刷新一下又有了。**源码级确认（lead 定位 + 本报告复核代码），本轮无 UI 断言覆盖、未运行验证** |

**建议动作（写进下一轮，本轮不改代码）**

1. **探针侧（最稳）**：`probe-timestamps` 只对「存档里有 `t` 的行」计数（或跑前不依赖 #recentOpen 的上一轮残留）。
2. **探针侧（更根治）**：`probe-ui-sessions.mjs:72-75` 给两条迁移 fixture 消息补 `t`，之后所有依赖 `t` 的探针都不会再被它拖红。
3. **产品侧（可选）**：缺 `t` 时统一兜底（用户行别显示运行时刻假时间）；迁移/写入路径补 `t`；顺手补 live 二意见行的 `msgTime`。

> **确定性提醒**：`probe-timestamps`（#28）在 `probe-ui-sessions`（#43）之前跑 ⇒ **不修根因的话下轮必红**，不是偶发；r2 已 3/3 确定性复现。
## 3.4 断言总口径（762 怎么算）

- r2 逐条解析：**762 = 761 通过 + 1 失败**；另有 **2 条条件跳过**（`probe-code-workspace` 1 + `probe-code-panel` 1，都是「无模型 409」）。
- 与 11-07 对账：**762 = 718 + 44**（`probe-ui-vision` 19 + `probe-vision-api` 25）——逐位吻合，说明口径没漂。
- r1 的对账：**745 = 762 − 17**（`probe-code-panel` 因传参错一条未执行）；r2 修好后补回 17。
- 历届链条：

| 轮次 | 探针 | 断言 | 变化 |
|---|---|---|---|
| 11-02 | 48 | 668 | — |
| 11-04 | 50 | 690 | +22 = `probe-gpu` 14 + `probe-ui-gpu` 8 |
| 11-07 | 51 | 718 | +28（48 条基线修正到 676 + `probe-gpu` 14 + `probe-ui-gpu` 7 开发模式 + `probe-code-workspace` 21） |
| **11-08 r1** | **53** | **745** | +44（两条视觉探针）− 17（code-panel 未执行） |
| **11-08 r2** | **53** | **762** | 745 + 17（code-panel 修好）；**下一轮全绿口径就是 762** |

## 3.5 结构信号（不是断言，但决定结果可信度）

1. **流式**：`probe-chat-plain` 逐块流式 **39 块**、带 metrics 复用 7%；`probe-tools-agent`「流式：工具事件先到、正文后到」——`收到 tool 增量事件`，且正文里没有原始调用块；`probe-ui-tools` 指标行 `↑773 ↓43 tok · 6.29 tok/s · 预填充 0.74s，复用 88% → 工具 1 次 → 生成 6.8s · 共 7.6s`。
2. **KV 复用**：`probe-kv-long` 三轮 **0% → 99% → 99%**（复用 token 1368 / 1440，首字 16187ms → 942ms → 877ms）；旁证：`probe-func` 70% / 79%、`probe-chat-plain` 7%、`probe-ui-metric` 72%（`reused=43 prefill=17 hit=0.717`）、`probe-ui-tools` 88%、`probe-preload` 重复预加载 `reused=true / 0s`。
3. **工具调用卡片**：`probe-ui-tools` 1 张（8s，带工具名/输入/结果）+ **刷新后恢复** 1 张；`probe-ui-web` 联网专用卡片 1 张（15s / 4 条 / 引擎 baidu）+ 刷新后恢复；`probe-tools-agent` 工具结果含真实时间 `2026/11/8 18:22:31`、指标记录工具 1 次。
4. **视觉 sidecar 串行**：本轮 r2 只发 1 张图，**串行队列未压测**（`probe-vision-api` 25 条里没有并发断言；串行/并发结论沿用 feature 自测 3 条 13.1/2.6/2.6s、并发 2 条 200）。r2 实测：start **14.9s**、发图 **5.6s**（`QWEN 42`）、stop **1.4s**、8101 释放 1.4s；start 前先卸载文本模型（`loaded=(空)`，内存互斥生效）。
5. **device lost**：**0**。`server\vulkan-crash.log` 只有 3 条 10-31 的旧记录（22:15:12 / 22:52:31 / 22:53:07），`probe-debug` 清后原样写回；两轮都没有新增崩溃记录。
6. **服务拉起**：**0 次**（r1、r2 的 summary 都没有 `[driver] 服务已退出`）；两轮的 `/api/version` 启动时刻都是 2026-11-08T09:54:58.675Z ⇒ **r1→r2 之间同一个进程，没重启**。
7. **会话数据安全**：`probe-ui-sessions` 在 r1（18:02:14）和 r2（18:21:50）各 wipe 一次，都先整份备份（r2：`session-backups\2026-11-08T10-21-50\`，已备份 3 个会话）；Lead 跑前的全量备份也在。**它每轮都会留下一个「迁移夹具会话」，这正是 r2 timestamps 红的原因**。

## 四、结论与遗留

1. **最终判定：v1.3.0 无功能回归。** r2 是权威轮：53 条 / 762 断言，52 绿 / 1 红 / 0 超时，0 崩溃 0 重启；唯一红项是「探针数据形态依赖（跨轮夹具）+ 产品一处低严重度不一致」，不是本轮改动引入；r1 的两条红（驱动传参、Edge 扩展噪声）也都定性清楚。
2. **口径确认**：**r2** = 53 条 / **762 断言**（761 通过 / 1 失败 / 2 条件跳过）、**52 PASS / 1 FAIL / 0 TIMEOUT**、墙钟 **778s**、0 重启、0 device lost；**r1** = 53 条 / 745 断言、**51 PASS / 2 FAIL / 0 TIMEOUT**（53 条里非 PASS 的只有 `probe-code-panel` 与 `probe-ui-gpu`）。
3. **必须上游化的一行**：把本轮 `run-full.ps1` 第 135 行的修正（`a=@($cdp)` → `a=@($base,$cdp)`）合并进下一轮基准驱动（11-02 权威版），否则 code-panel 仍会 0 断言。
4. **下轮跑之前二选一**：① 换干净工作区（从 `session-backups\2026-11-08_17-52-52\workspace-full` 恢复）；② 修掉迁移夹具（探针给 fixture 补 `t` / timestamps 只对有 `t` 的行计数）。否则 `probe-timestamps` 每轮必红。
5. **下轮口径**：53 条 / 762 断言（2 条条件跳过），预期全绿。
6. **收口动作（Lead 负责，别忘）**：两轮 wipe 已把服务端会话清成 1 个迁移夹具；真实 8 个会话可从 `session-backups\2026-11-08T10-02-14\`（10 个 json）或 Lead 的 `2026-11-08_17-52-52\workspace-full` 恢复。
7. **顺手记（不是回归）**：`probe-start-screen` 的「问候语按时间」只校验三选一、不校验小时（17:58 显示「中午好」是 `app.html` `11 ≤ hh < 18` 的设计判定）。
## 五、证据

| 路径 | 内容 |
|---|---|
| `server\docs\probe-full-2026-11-08\summary.txt` | r1 summary（混合编码：UTF-8 BOM 头 + UTF-16LE 正文 + UTF-8 尾） |
| `server\docs\probe-full-2026-11-08-r2\summary.txt` | r2 summary（同上编码；权威轮） |
| `server\docs\probe-full-2026-11-08\logs\` | r1：53 份 `.out.txt` + 53 份 `.err.txt`（全 0 字节）+ 2 份单条复跑（`rerun-1/2-*`） |
| `server\docs\probe-full-2026-11-08-r2\logs\` | r2：53 份 `.out.txt` + 53 份 `.err.txt`（全 0 字节），无复跑杂物 |
| `server\docs\probe-full-2026-11-08\shots\` | 19 张界面截图（含 `ui-vision-preview.png`、`ui-vision-settings.png`、`ui-18-web-cards.png`） |
| `server\docs\probe-full-2026-11-08\baseline.json` | 跑前基线：git 4052e63 / 441 文件 / 8 会话哈希 / 73 个探针文件 |
| `server\docs\probe-full-2026-11-08\run-full.ps1` | 修正后的驱动副本（BOM 完好、Parser 0 错误、仅 1 行差异） |
| `server\docs\probe-full-2026-11-08\service.out.txt` / `.err.txt` | 服务进程全程 stdout/stderr（17:55:01 启动 → r1 → r2，无 device lost） |
| `server\docs\probe-full-2026-11-08-r2\logs\rerun-4-findings.md` | task-5 取证报告：3 次确定性复现 + DOM/存档双取证（§3.3 的直接证据） |
| `server\docs\probe-full-2026-11-08-r2\logs\rerun-4-timestamps-1/2/3.dump.json` | 每次复跑的 DOM + 会话存档 dump |
| `server\docs\probe-full-2026-11-08\verify\verify.md` | 独立验收报告（哈希 9/9 MATCH、0 重启、逐条自洽、数据污染范围） |
| `server\docs\probe-full-2026-11-08\analysis\flaky-baseline.md` | 已知易红/边界项判红手册（18 项，本轮新增/改写 3 项） |

## 六、已知易红 / 边界项清单

详见 `server\docs\probe-full-2026-11-08\analysis\flaky-baseline.md`（17+1 条判红手册）。本轮更新：

| 项 | 本轮结论 |
|---|---|
| `probe-code-panel` `no page` | 原表判「环境时序」→ **已改判驱动传参缺陷**（§2.2），修一行后 r2 17/17 |
| `probe-ui-gpu`「没有未捕获的 JS 错误」 | 环境（Edge 扩展噪声），r1 一次、单跑复跑 7/7、r2 未复现 |
| `probe-timestamps`「每条消息都有时间」 | **新增**：跨轮迁移夹具（消息无 `t`）⇒ 打开夹具会话必红；修法见 §3.3 |
| `probe-code-run` C++ / `probe-preload` <45s / `probe-start-flow` ECONNRESET / `probe-debug` KV | 本轮均未触发（24.9s、11.0s、8/8 无 reset、35/35 `q8_0`） |

## 七、过程教训（这次真踩到）

1. **summary 混合编码**：`run-full.ps1` 用 `Out-File -Encoding utf8` 写头，正文用 `Tee-Object -Append`（PS 5.1 默认 UTF-16LE）⇒ 一个文件里两种编码。纯 UTF-8 读会得到带 NUL 的 `p r o b e ...`，直接 grep 会漏统计甚至误判。**统计脚本必须逐段识别编码**（按字节看 `xx 00` 判 UTF-16LE 行，否则按 UTF-8 行）。
2. **探针产物统一 UTF-8 落盘**：本轮所有 `.out.txt`/`.err.txt` 是 UTF-8（r1 55 份 `.err.txt` 含 2 份复跑、r2 53 份，全部 0 字节），中文没乱码；但 v13 的复跑日志是 UTF-16LE，merge 进证据目录后中文全成乱码。产物一律显式 UTF-8（无 BOM），别用 `Tee-Object` 直接写。
3. **跨轮状态**：r1/r2 共用一个工作区，才让「上一轮探针留下的夹具会话」变成下一轮的红。**整跑要么每次换干净工作区，要么每轮收尾把夹具清掉**。
4. **8 字节的 `no page` 值得多问一句**：11-07 把它记成「瞬时」，本轮复跑仍 `no page` 才逼出驱动传参 bug——**连续两次同形红不要再用「瞬态」结案**。