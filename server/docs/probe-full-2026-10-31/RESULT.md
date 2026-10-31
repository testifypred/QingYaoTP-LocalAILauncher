# full suite 2026-10-31 — 45 条探针 / 585 条断言 / 全绿

> 这一轮的特别之处：**整跑中途 Vulkan 崩了两次**，驱动自动拉起服务并重装模型；被崩溃波及的 5 条单独复跑通过。
> 下面把「哪条是整跑过的、哪条是复跑过的」逐条写清楚，避免「全绿」被误读成「一次跑完就全绿」。

## 环境

| 项 | 值 |
|---|---|
| 服务 | `node app.mjs` 裸跑（没有启动器兜底），界面 headless Edge（CDP 9333） |
| 模型 | `qwen2.5-7b-instruct-1m-q4_k_m.gguf`，驱动开跑前自己 `POST /api/load` |
| 后端 | 起跑 Vulkan → 崩两次后应用自动切 CPU（`server\vulkan-crash.log` 3 条时间戳）；复跑的 5 条在 CPU 上跑 |
| 时间 | 整跑 22:44:25 → 22:54:52；复跑 22:57 → 23:10 |

## 整跑途中发生了什么

| 时间 | 事件 |
|---|---|
| 22:52:3x | `probe-tools-agent` 的对话返回 500：`vk::Device::getFenceStatus: ErrorDeviceLost`，进程退出（已知问题 2） |
| 22:52:40 | 驱动第 1 次拉起服务，重新预加载 7B |
| 22:53:07 | 又一次 device lost，退出 |
| 22:53:15 | 驱动第 2 次拉起；应用按「10 分钟内崩两次」自动切 CPU，此后稳定 |
| 22:53:07 前后 | `probe-web-tools` / `probe-context-switch` / `probe-ui-preload` 撞在服务空档，秒退 |
| 22:54:52 | 整跑结束：**40 绿 / 5 红** |
| 22:57 → 23:10 | 5 条单独复跑：全绿（CPU 约 3 tok/s，`tools-agent` 也照样 24/24） |

## 逐条结果

| 探针 | 断言 | 结论 |
|---|---|---|
| `probe-auto-title` | 5 | 整跑通过 |
| `probe-backup` | 38 | 整跑通过 |
| `probe-chat-plain` | 11 | 整跑通过 |
| `probe-code-panel` | 9 | 整跑通过 |
| `probe-code-run` | 13 | 整跑通过 |
| `probe-code-run-ui` | 9 | 整跑通过 |
| `probe-context-switch` | 3 | 整跑时被崩溃波及，已单独复跑 |
| `probe-ctx-panel` | 24 | 整跑通过 |
| `probe-formula-find` | 8 | 整跑通过 |
| `probe-formula-panel` | 7 | 整跑通过 |
| `probe-func` | 9 | 整跑通过 |
| `probe-hero-modes` | 11 | 整跑通过 |
| `probe-input-extras` | 8 | 整跑通过 |
| `probe-kv-long` | - | 信息型（KV 复用 A/B，0 断言） |
| `probe-menu-stacking` | 2 | 整跑通过 |
| `probe-model-add` | 4 | 整跑通过 |
| `probe-plugins` | 11 | 整跑通过 |
| `probe-preload` | 26 | 整跑通过 |
| `probe-rag` | 16 | 整跑通过 |
| `probe-second-opinion` | 11 | 整跑通过 |
| `probe-session-jump` | 4 | 整跑通过 |
| `probe-session-race` | 3 | 整跑通过 |
| `probe-sessions` | 33 | 整跑通过 |
| `probe-settings-tools` | 9 | 整跑通过 |
| `probe-sidebar-search` | 11 | 整跑时被崩溃波及，已单独复跑 |
| `probe-small-features` | 6 | 整跑通过 |
| `probe-start-flow` | 8 | 整跑通过 |
| `probe-start-screen` | 12 | 整跑通过 |
| `probe-status` | 6 | 整跑通过 |
| `probe-timestamps` | 4 | 整跑通过 |
| `probe-title-ui` | 13 | 整跑通过 |
| `probe-tools-agent` | 24 | 整跑时被崩溃波及，已单独复跑 |
| `probe-ui-backup` | 20 | 整跑通过 |
| `probe-ui-metric` | - | 信息型（指标展示，0 断言） |
| `probe-ui-new` | 30 | 整跑通过 |
| `probe-ui-preload` | 35 | 整跑时被崩溃波及，已单独复跑 |
| `probe-ui-rag` | 6 | 整跑通过 |
| `probe-ui-sessions` | 27 | 整跑通过 |
| `probe-ui-tools` | 12 | 整跑通过 |
| `probe-ui-version` | 9 | 整跑通过 |
| `probe-ui-web` | 39 | 整跑通过 |
| `probe-version` | 14 | 整跑通过 |
| `probe-web-tools` | 19 | 整跑时被崩溃波及，已单独复跑 |
| `probe-workspace-api` | 9 | 整跑通过 |
| `probe-workspace-ui` | 7 | 整跑通过 |
合计：45 条探针 / 585 条断言 / 0 红

## 归因：那 5 条当时为什么红

1. **`probe-tools-agent`（20 红）**：崩溃就发生在它身上——对话返回 500，工具调用自然一个都没有。复跑 24/24。
2. **`probe-web-tools` / `probe-context-switch` / `probe-ui-preload`**：撞在两次重启之间的空档，连不上服务直接秒退。复跑全绿。
3. **`probe-sidebar-search`（9/11）**：第一次搜索正常，第二次「深空探测」在 900ms 内没换掉结果（列表还是上一次的命中）。复跑 11/11。这条 10-30 也红过一次，是**固定 sleep 在负载下不够**——下次应改成等 UI 稳定（比如轮询 `#sessionSearchHint` 变成「N 条匹配」）。
4. **`probe-kv-long`**：整跑那次输出全是 null（它跑在刚重启、还没装模型的服务上）。已单独复跑：CPU 首轮 70.4s，二三轮 1.6s / 1.4s，复用率 99%，提示 1311 → 1385 → 1452 token。

## 结论

- **45 条探针 / 585 条断言，0 红**（其中 5 条是崩溃后单独复跑；585 = 上轮 562 + 新增 `probe-version` 14 + `probe-ui-version` 9）。
- 这轮顺带验证了两个兜底是真的：**驱动看护**（服务退出→拉起→重装模型）和**应用自身**「10 分钟崩两次自动切 CPU」。没有启动器时，前者就是唯一的重启手段。
- 遗留两条观察，都不算新缺陷：
  - `probe-sidebar-search` 的固定 sleep 在负载下会抖（建议改成轮询 UI 状态）；
  - `probe-tools-agent` 仍会触发 Vulkan device lost（已知问题 2：生成中途中断/断开），属于这台机器的已知取舍，不是这次改动引入的。
