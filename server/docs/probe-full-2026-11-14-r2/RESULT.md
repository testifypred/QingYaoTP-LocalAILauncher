# 全量回归 · 2026-11-14 / 15（v1.4.0 打包轮）

> 55 条探针分两段跑完，**全部通过**。第一段整跑里 35 条界面探针整批红，原因是 headless Edge 没起来（环境），不是产品回归；第二段按小批次补跑，逐条全绿。
> 中间有四条探针第一次补跑是红的，经定性为「脏会话」造成的假红，恢复干净会话集后一次全绿（见「四」）。

## 一、两段怎么跑的

| 段 | 目录 | 内容 | 结果 |
|---|---|---|---|
| r1 整跑 | `server\docs\probe-full-2026-11-14\` | `run-full.ps1` 55 条（`FULL_PROBE_OUT` 指到该目录） | 20 条非界面探针全绿；35 条界面探针 `exit 1`、0 断言（CDP 未起来） |
| r2 补跑 | `server\docs\probe-full-2026-11-14-r2\` | 界面探针分 8 批，每条独立进程、共享一个 headless Edge | **35/35 全绿**（另四条先红后复跑全绿） |

- 服务：源码目录 `node app.mjs`（v1.4.0），8099；预加载 `qwen3-5-4B-Q4_K_M.gguf`
- 界面：headless Edge **157.0.4341.46**，`--headless=new --no-sandbox --remote-debugging-port=9333 --window-size=1440,900`
- 环境：危险在于 headless Edge 会随发起它的工具进程一起被回收 → **起 Edge 与跑探针必须在同一条命令内**

## 二、r1 非界面探针（20/20 绿）

| 探针 | 结果 | 探针 | 结果 |
|---|---|---|---|
| probe-sessions | 33/33 | probe-version | 14/14 |
| probe-workspace-api | 9/9 | probe-firstrun | 22/22 |
| probe-code-run | 13/13 | probe-debug | 54/54 |
| probe-code-workspace | 21/21（跳过 1） | probe-func | PASS |
| probe-gpu | 14/14 | probe-ui-metric | PASS |
| probe-backup | 38/38 | probe-chat-plain | 11/11 |
| probe-rag | 16/16 | probe-tools-agent | 24/24 |
| probe-plugins | 11/11 | probe-web-tools | 19/19 |
| probe-kv-long | PASS | probe-preload | 26/26 |
| probe-second-opinion | 11/11 | probe-vision-api | 25/25 |

## 三、r2 界面探针（35/35 绿）

| 探针 | 结果 | 探针 | 结果 |
|---|---|---|---|
| probe-ui-new | 30/30 | probe-title-ui | 13/13 |
| probe-menu-stacking | 2/2 | probe-session-jump | 4/4 |
| probe-ui-gpu | 7/7 | probe-session-race | 3/3 |
| probe-start-screen | 12/12 | probe-code-run-ui | 9/9 |
| probe-start-flow | 8/8 | probe-ui-version | 9/9 |
| probe-model-add | 4/4 | probe-ui-rag | 6/6 |
| probe-model-delete | 20/20 | probe-ui-web | 39/39 |
| probe-status | 6/6 | probe-ui-debug | 33/33 |
| probe-code-panel | 17/17（跳过 1） | probe-download-ui | 35/35 |
| probe-settings-tools | 9/9 | probe-ui-backup | 20/20 |
| probe-workspace-ui | 7/7 | probe-auto-title | 5/5 |
| probe-hero-modes | 11/11 | probe-context-switch | 3/3 |
| probe-input-extras | 8/8 | probe-ui-preload | 35/35 |
| probe-formula-panel | 7/7 | probe-small-features | 6/6 |
| probe-formula-find | 8/8 | probe-ctx-panel | 25/25 |
| probe-timestamps | 4/4 | probe-sidebar-search | 11/11 |
| probe-ui-tools | 12/12 | probe-ui-vision | 19/19 |
| probe-ui-sessions | 28/28 | | |

`probe-ui-gpu` 本轮 7 条（历史记 8）：没有独显设备时少一条条件断言，不是回归。
`probe-ui-web` 本轮 39 条（历史记 34）：11-11 那轮补过断言。

## 四、四条「假红」的定性（重要）

先红后绿、**原因都不是产品**：

| 探针 | 首跑 | 复跑 | 首跑为什么红 |
|---|---|---|---|
| probe-small-features | 5/6 | **6/6** | 页面停在驱动预置会话上，「复制」拿到的是预置回答「收到…」 |
| probe-ctx-panel | 18/25 | **25/25** | 当前会话历史过大 → 上下文余量 100%、进告警色 |
| probe-sidebar-search | 9/11 | **11/11** | 工作区里有两条同名 `SIDEBAR-ALPHA` 会话（我反复补跑留下的） |
| probe-ui-tools | 10/12 | **12/12** | 同上，脏会话导致卡片/正文断言错位 |

恢复动作：`workspace\sessions` 从 `server\docs\session-backups\20261114-000136\` 恢复成 8 条真实会话后重跑 → 一次全绿。
**结论：全量回归必须在干净会话集上跑**；分批补跑尤其容易把自己的中间产物当成环境。

## 五、口径

- 探针总数 **55 条**（驱动 `server\docs\run-full.ps1`），断言口径仍按 **847**（本轮没有增删探针）
- 结论：**v1.4.0 没有功能回归**

## 六、附件

- r1：`summary.txt`、`logs\<probe>.out.txt`、`server.out.txt`
- r2：`batch1.txt`（第一批试跑记录）、`logs\<probe>.out.txt`、`shots\`（截图）
- 打包与包内冒烟证据：`server\docs\packaging-2026-11-14\`
