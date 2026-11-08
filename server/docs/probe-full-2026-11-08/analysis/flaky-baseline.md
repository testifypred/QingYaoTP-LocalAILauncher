# 已知易红 / 边界项基线（2026-11-08 全量轮）

> 用途：这一轮 53 条全量跑出红时，**先查这张表再写结论**。目的不是给红项找台阶，是把「环境红 / 探针过期 / 产品缺陷」分干净。
> 纪律：**先证明前置条件在，再谈回归**；同参数单条复跑一次就变绿的，一律先记环境/时序，第二次复跑仍红才升级为「真回归」。

## 一、判红四步（按顺序，别跳）

1. **服务还活着吗**：`GET /api/state` 是否 200；`server.pid` 是否对得上；`logs\app.log` 有没有崩溃/重启行。裸跑 `node app.mjs` 时 Vulkan device lost 会直接把进程干掉，**后面的探针会以「秒退 + 0 条断言」的形式红**（06 文档 L33）。这种红不算产品问题。
2. **前置条件在不在**：模型已加载 / CDP 9333 上有 8099 页面 / 视觉 pair 存在 / 工作区里有会话与索引。缺前置的红，detail 里通常是 `null`、空串、`（未加载）`。
3. **actual 是「空」还是「合理但不等」**：`actual=null`、`configured=?`、`vs ?` ⇒ 前置缺失（环境）；actual 是正常值但和期望不一致 ⇒ 产品回归或探针过期。
4. **单条复跑一次**：绿 ⇒ 环境/时序；同参数稳定红两次 ⇒ 产品缺陷；换台机器/换个工作区同样红 ⇒ 产品缺陷；只有界面选择器找不到 ⇒ 探针过期。

## 二、清单总表

| # | 探针 / 断言 | 历史证据 | 环境红的判据 | 真回归的判据 | 动作 |
|---|---|---|---|---|---|
| 1 | `probe-code-run`「C++ 编译并执行」 | 11-01 首跑 11773ms 越过 10s 硬超时，同参数复跑两次 13/13（`technique/06` L53） | `langs.cpp.ok=false`（找不到 g++/clang++/vswhere）；或 `timedOut=true` 且 `ms≈30000+` | `langs.cpp.ok=true` 且 stderr 是编译错误 / stdout 不含 `cpp42` | 先看 `/api/run/langs`；纯慢复跑一条即可，编译器缺失去补环境 |
| 2 | `probe-preload`「全程耗时没有退化到装卸量级（<45s）」 | 阈值原来是 <25s，机器忙时实测 29s 红；11-07 已放宽到 45s（`probe-preload.mjs` L119–120） | `secs` 45–60s，同时 `swapped=false`、`phases=thinking,answer,done` | `swapped=true` 或 `phases` 里出现 `loading`（真的换模型了） | 复跑；连续两轮 >45s 再查预加载实现 |
| 3 | `probe-start-flow` 收尾 fetch 撞 `ECONNRESET` | 11-04 红项 1：8 条断言全过，收尾 DELETE 的 fetch 撞 ECONNRESET，退出码 1 → 复跑 8/8（11-04 RESULT L30） | **RESULT 8/8 + exit 1**，`.err` 里是 `fetch failed` / `ECONNRESET`（keep-alive 被服务端关掉） | 断言红：`发送后开场白退场` / `回答已生成`（那是模型没加载，见 #6） | 复跑；反复撞就在探针 fetch 上加 `Connection: close`（11-04 RESULT L44 的遗留 TODO） |
| 4 | `probe-debug` 两条 KV 断言 | 11-07-v13：33/35，恰好是 `模型 KV 量化与 /api/state 一致` 与 `KV 量化实际生效类型与配置一致` 两条，detail `vs ?` / `actual=null · configured=? · resources=null` | `/api/state.loaded` 为空（预加载失败、被视觉 sidecar 卸载、应用重启） | loaded 有模型但 `kvQuantActual` 为空 ⇒ LlamaContext getter 失效 | 驱动已先 `POST /api/load`；红时先看 summary 有没有「预加载失败」 |
| 5 | `probe-status` 三条（状态栏格式 / tooltip / 模型名） | 11-07-v13：3/6，`statusText="未加载模型 · 7 个可用"` | 状态栏文案是「未加载模型 · N 个可用」⇒ 无模型 | text 是 `16K · 可思考` 一类但 tooltip 里缺「上下文/层」⇒ 真回归 | 重新装模型跑；格式回归才改产品 |
| 6 | `probe-hero-modes`「从开场白发送后进入对话」 | 11-07-v13：11/11 里只红这一条，detail 为空 | 无模型时发送不出回答，且**只红这一条**，其余 10 条结构断言都绿 | 有模型仍红，或同时红「两个模式按钮」「模型不支持思考提示」 | 装模型复跑；只这一条红基本就是前置 |
| 7 | 一批**默认「模型已加载」**的探针 | 06 文档 L32；11-07-v13 实测（见下） | 一次性红一片，且 summary 里「预加载失败」/驱动拉起后没装回模型 | 只有个别探针红、其余同批绿 ⇒ 才看产品 | 先确认 `/api/state.loaded`，再谈别的 |
| 8 | `probe-func` | 11-07-v13：exit 1、0.8s、out 只有一行 `1) 系统提示跨轮保留`，err 是 `TypeError: Cannot read properties of undefined (reading 'includes')`（`probe-func.mjs:82`） | 无模型 ⇒ 回答对象 undefined ⇒ 抛 TypeError；**报错是 TypeError 不是断言红** | 有模型时抛别的异常 / 断言红 9 项里某几项 | 装模型复跑；它不打 `结果: N/N`，解析口径见 RESULT 第三节 |
| 9 | `probe-code-panel` exit 2 `no page` | 11-07 首跑 exit 2（当时记成「瞬时 no page」）；**11-08 两次复现后定位到真因：驱动传参顺序错**（`probe-code-panel.mjs:15-16` 要 `[base] [cdp]`，驱动只传 `@($cdp)` → `PORT=9333` → 永远找不到页面） | 不要当环境：同一时段 `probe-ui-gpu` 能找到同一页面（7/7）就证明页面在 | 真缺陷：**驱动一行**；修 `a=@($base,$cdp)` 后应 17/17 | 改驱动后复跑；不要再当「瞬时」放过 |
| 10 | `probe-formula-find`「点行内公式复制」 | 11-07 首跑 7/8，复跑 8/8（headless 剪贴板焦点/权限偶发，11-07 RESULT L36） | 红的是复制那条，其余 7 条绿 | 复制功能真的写不进剪贴板（换有头浏览器也失败） | 复跑 |
| 11 | `probe-plugins` 插件目录推断 | 11-07 首跑 6/11：探针把插件目录推成 `server\plugins`，服务端实际是 `D:\LocalModels\plugins`；改成读 `GET /api/plugins` 返回的 `dir` 后 11/11（11-07 RESULT L34） | 现版本**不应再红**；若红先看探针是不是又写死目录 | 目录读的是接口返回值仍红 ⇒ 真回归 | 已修，不用再动 |
| 12 | `probe-ui-gpu` 开发模式分支 | 11-07 首跑 7/8：开发目录没有 `config.ini`，服务端按设计不写盘 | `/api/gpus` 的 `configWritable=false`，断言走「未写盘并给出说明」分支（`probe-ui-gpu.mjs` L56–57），总断言数 7 而不是 8 | 写盘分支（发布包）里 `config!=0` ⇒ 真回归 | 按形态看分支；开发模式 7 条是正常口径 |
| 13 | `probe-ui-gpu`「没有未捕获的 JS 错误」 | **本轮（11-08）首红**：`Error: Could not establish connection. Receiving end does not exist.`；`app.html`/`app.mjs` 里没有任何 `chrome.*` / `sendMessage` 调用（全仓 grep 0 命中）；**18:12 复跑 7/7 转绿** | 错误文案是浏览器内部/扩展消息错误，与 `app/`、`/api` 无关；6/7 其余全绿；复跑即绿 | 错误来自页面脚本且可复现（含堆栈指向 app.html/app.mjs） | 已复跑转绿；若下轮再复现，再给探针加白名单 |
| 14 | `probe-vision-api`（25 条） | 11-07 集成 25/25；sidecar 冷启动 9.8–15.3s、首图 13–34s（feature-vision RESULT 四） | `pairs=0` 或 sidecar 拉不起来（504/health 超时）⇒ 跳过 4 条并红 start；8101 被占 | start 成功、发图返回但内容不含 `QWEN 42` ⇒ 模型/mmproj 配错或退化 | 先看 `/api/vision/state` 的 `pairs`/`running`/`error`；缺 pair 是环境/配置 |
| 15 | `probe-ui-vision`（19 条） | 11-07 集成 19/19；依赖 CDP 页面在 8099 | 页面不在 8099 / 无 pair ⇒ 找不到 `#imgBtn` 或设置页签 | 页面正常但断言红 ⇒ 界面回归 | 同 #9，先看 CDP 页面 |
| 16 | `probe-tools-agent` / `probe-web-tools` / `probe-second-opinion` | machine 忙时 116.8s / 96.7s / 56.3s（11-07）；驱动超时 360/360/420 | 耗时顶到驱动超时（TIMEOUT）而不是断言红 | 真模型输出不对（工具调用没卡片、内容截断） | 忙时复跑；TIMEOUT 单条重跑 |
| 17 | `probe-ui-metric` / `probe-kv-long` | 信息型、**没有断言**（11-07 RESULT L42） | 二者不出 `RESULT` 行是正常的，别当红 | — | 解析时按 0 条断言计 |
| 18 | `probe-timestamps`「每条消息都有时间」 | **11-08 r2 唯一红**（r1 同探针 4/4）：打开的是上一轮 `probe-ui-sessions` 留下的「localStorage 迁移夹具会话」，两条消息**没有 `t`**；用户行走 `Date.now()` 兜底（只显示渲染时刻）、助手行不渲染时间 ⇒ `times=1 rows=2`（r2 `logs\probe-timestamps.out.txt`；task-5 3 次确定性复现，DOM/存档双取证） | 不要当 flaky：先看打开的是哪个会话、消息有没有 `t`（`workspace\sessions\*.json`）；stat 里的时间 ≈ 探针运行时刻就是 `Date.now()` 兜底；**同一形态连续 3 次红 ⇒ 确定性依赖，不是偶发** | 真问题在「迁移不给消息补 `t`」+「跨轮夹具污染」；修产品（补 `t`）或让探针自造带 `t` 的会话；另收 P2（live 二意见行缺 `makeMsgTime`，`app.html:6947-6950`，本轮未触发） | 详见 RESULT.md §3.3 |

## 三、11-07-v13 作废轮就是「环境连锁」的样本

整跑停在第 23 条 `probe-workspace-ui`（21:58:57），summary 里**没有 `# done`**；22 条里 6 条红，全部指向同一件事：

| 探针 | 结果 | 一句话 |
|---|---|---|
| `probe-version` | 13/14 | 唯一一条非模型红：`pkg=1.2.0` vs 接口 1.3.0（版本号升到一半，11-08 已一致） |
| `probe-debug` | 33/35 | KV 两条 `actual=null · configured=?` |
| `probe-func` | exit 1 | 无模型 → 回答 undefined → TypeError |
| `probe-start-flow` | 6/8 | `发送后开场白退场`/`回答已生成` 红 |
| `probe-status` | 3/6 | `未加载模型 · 7 个可用` |
| `probe-hero-modes` | 11/12 | 只红「从开场白发送后进入对话」 |
| `probe-code-panel` | exit 2 | `no page`——当时以为是「页面被前一条探针刷新」，11-08 已证伪：是驱动传参顺序（见清单 #9） |

关键证据：summary 头部写着 `已加载: qwen2.5-7b-instruct-1m-q4_k_m.gguf`，但**第 4 条 `probe-code-workspace` 的日志（21:55:22）已经打出 `当前模型: （未加载）`**。
也就是说模型在开跑后早期就没了，而驱动只探 `/api/state`（服务还在回答），既发现不了、也不会重装模型 —— 这就是「应用中途重启 → 无模型 → 一片红」的机制。
**判据：红项 detail 全是「空/未加载」，且同一时刻结构断言仍在绿，就不是回归。**

11-07 22:10 的复跑（应用带着模型重启后）把上面这些全部转绿：`rerun-probe-version` 14/14、`rerun-probe-status` 6/6、`rerun-probe-start-flow` 8/8、`rerun-probe-func` 9/9、`rerun-probe-debug` 35/35（KV `q8_0 vs q8_0`）、`rerun-probe-code-panel` 17/17。**这是环境连锁最直接的佐证。**

## 四、本轮（2026-11-08）实测：r1 + r2 两轮

说明：本轮跑了两次——**r1** 用 11-02 权威驱动（51 绿 / 2 红），**r2** 用修正后的驱动副本（52 绿 / 1 红，权威）。r2 的 `probe-code-panel` 已 **17/17（跳过 1）**、`probe-ui-gpu` 已 **7/7**。

| 命中的表项 | r1 | r2（权威） | 判定 | 依据 | 动作 |
|---|---|---|---|---|---|
| #9 `probe-code-panel` exit 2 `no page` | ❌ 0 断言 | ✅ **17/17** | **工具链缺陷（驱动传参）**，已修 | 探针签名 `[base] [cdp]`（`probe-code-panel.mjs:15-16`）vs 驱动 `a=@($cdp)`；`6544f3f` 改签名、`2701b19` 未同步 | 已在本轮驱动副本改 `a=@($base,$cdp)`；**建议回写 11-02 权威版** |
| #13 `probe-ui-gpu`「没有未捕获的 JS 错误」 | ❌ 6/7 | ✅ **7/7** | **环境**（Edge 扩展噪声） | 全仓无 `chrome.runtime`/`sendMessage`；18:12 单跑复跑 7/7；r2 未复现 | 已转绿；连续复现再给探针加白名单 |
| #18 `probe-timestamps`「每条消息都有时间」 | ✅ 4/4 | ❌ **3/4** | **环境/状态污染（跨轮夹具）** + 产品侧两处低严重度缺口 | r2 打开的是 r1 留下的迁移夹具（消息无 `t`）；r1 打开的是 11-07 真实会话（两条都有 `t`） | 见 RESULT.md §3.3（P1 迁移补 `t`、P2 二意见 live 行补 `makeMsgTime`） |

本轮**没**触发的边界项（记录实测值，证明这些阈值现在不紧）：

- #1 `probe-code-run`：r1 24.9s / r2 23.1s，13/13（C++ 编译一次过，编译 30s 预算未逼近）。
- #2 `probe-preload`：r1 22.6s / r2 **11.0s**（阈值 45s），`swapped=false`，重复预加载 `reused=true / 0s`。
- #3 `probe-start-flow`：8/8、exit 0，两轮都没有收尾 fetch 的 ECONNRESET。
- #4 `probe-debug`：35/35，KV 三方一致 `q8_0 vs q8_0`。
- #5/#6 `probe-status` 6/6、`probe-hero-modes` 11/11——7B 全程在线，没有「未加载模型」连锁。
- #14/#15 两条视觉探针首次进全量：r2 `probe-ui-vision` 19/19、`probe-vision-api` 25/25（start 14.9s / 发图 5.6s / stop 1.4s）。
- #16 慢探针：r2 tools-agent 102.7s、web-tools 90.7s、second-opinion 33.7s，都没到驱动超时。

> 本轮结论改写两项（#9 从「环境时序」改成「驱动传参缺陷」）、新增一项（#18）。#9 的教训：8 字节的 `no page` 连续两次出现，就不该再用「瞬态」结案。