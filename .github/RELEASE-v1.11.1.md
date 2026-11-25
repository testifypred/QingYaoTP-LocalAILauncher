# v1.11.1 — 启动器健康看门狗 + Apache-2.0 许可随包（稳定性补丁）

**发布日期**：2026-11-24 · **类型**：补丁版（v1.11.0 之后的许可证落地 + 启动器进程级自愈；应用功能代码零改动，仅版本号对齐）

> 由 **卿峣Testifypred** 出品 · Powered By DeepSeek Harness

## 下载

| 文件 | 大小 | SHA256 |
|---|---|---|
| `QingYaoTP-AILauncher-v1.11.1.zip`（主包，必装） | 127,971,996 B（约 122 MB / 3,951 条目） | `DECCBAE48D7CF23BF4879A60AC43EFA6F24790AF35AC198B5C1E356D0FFE213C` |
| `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（视觉增强包，选装） | 38,408,198 B（约 37 MB） | `D7924534B30143F3791D26C143B95656306AE1FFA08D52557EE25D56699A11D3` |

主包解压后约 **258.8 MB / 3,451 个文件**，**不含**看图 sidecar（拆成可选增强包；不看图可忽略）。本版起 `app\` 目录**首次随包带** `LICENSE` / `NOTICE` / `THIRD_PARTY_NOTICES.md`。

## 本版重点

### 1. 启动器 /health 进程级看门狗（本次唯一功能改动）

**解决什么**：Vulkan 原生层偶发**彻底卡死**——node 事件循环不转（`/api/state`、`/health` 全超时、CPU 持续涨），界面虽能在 120s 内报错恢复按钮，但进程只能手动重启。现在由**启动器**（node 的父进程）做外部看门狗：

- 每 5s 探 `/health`（3s 超时），**连续 90s 无响应** → 判定卡死 → 强杀 node → 自动重启 → 等就绪（≤120s）→ 托盘提示 + 内嵌界面自动重载；
- **安全边界**：用户主动停服务（`--stop` / 托盘停止 / 退出码 0）**不会被拉起**；启动/重启有宽限期；与崩溃守护互斥（不会双重启）；30 分钟内最多自动重启 5 次，超出暂停 10 分钟并托盘提示；
- 可关闭/可调：`LOCALAI_WATCHDOG=0` 关闭；`LOCALAI_WATCHDOG_INTERVAL_MS` / `_TIMEOUT_MS` / `_STALL_MS` 调整阈值。

### 2. Apache-2.0 许可证随包

- 根目录新增 `LICENSE`（Apache-2.0）、`NOTICE`（版权 + **AI 辅助开发声明**）、`THIRD_PARTY_NOTICES.md`（node-llama-cpp / llama.cpp / ws / msedge-tts / KaTeX / MathLive / CodeMirror / Node.js / WebView2 / VC++ 等）；
- 本版起随 `app\` 目录分发（已发布的 v1.11.0 zip 不含许可文件）；
- 版权：Copyright 2026 QingyaoTestifypred（卿峣Testifypred）。

### 3. 其它

- 应用功能与 v1.11.0 相同（终端 TUI 2.0、主页面增量渲染、20B useMmap:false、代码工作区 UI、审查卡死 P0 修复均已在 v1.11.0 交付）；
- 版本号四处对齐 1.11.1（app.mjs / package.json / localai.mjs / TUI --main-ver 兜底），TUI 自身版本仍 2.0.0。

## 探针与验证

- **看门狗独立验证**：修正装置（挂起 node 模拟原生层卡死、`--start-hidden`、独立端口）**24/24**；`LOCALAI_WATCHDOG=0` 禁用场景 **15/15**；默认参数 75s 健康长观察 **13/13**；桌面 0 弹窗。
- **全量回归**（源码实例 `node server\app.mjs`）：70 条 / 1,524 断言，整跑 **68 PASS + 2 环境红**（`probe-ui-web` 38/39 会话级联、`probe-web-tools` 15/19 百度反爬）→ **隔离复跑 ui-web 39/39、web-tools 19/19 全过 = 有效 70/70**；耗时约 23 分钟。证据 `server\docs\probe-full-2026-11-24-v111\`。
- **发布包冒烟**：把 v1.11.1 安装目录复制到**会话工作区之外**（等同新用户解压到任意目录；本机 DSH 会话会限制工作区内 exe 写工作区）后，**7 项全绿**：`probe-version` **14/14**、`probe-debug` **54/54**、`probe-code-review-stream` **45/45**（跳过 3：Phi 切换）、`probe-readme` **21/21**、`probe-code-window-ui` **10/10**、`probe-code-panel-v2` **44/44**、`probe-review-watchdog` **56/56**。证据 `server\docs\packaging-2026-11-24-v111\smoke\`。
- 证据：`server\docs\feature-launcher-watchdog-2026-11-24\`（看门狗）、`server\docs\probe-full-2026-11-24-v111\`（全量）、`server\docs\packaging-2026-11-24-v111\`（打包）。

## 升级方式

1. 托盘右键 →「停止服务并退出」；
2. 把新 zip 解压**覆盖**到原安装目录；
3. 保留 `workspace\`、`data\`、`models\` 三个目录即可无损（模型不用重下）。

> 目前**没有自动更新**，请以本页版本号为准。

## 已知限制

- 仅 Windows 10/11 x64；Mac / Linux 暂不支持；
- 看门狗只处理「进程还在但不响应」；若 Windows 直接杀掉进程，仍由崩溃守护/手动重启兜底；
- 本地审查长代码建议用 4B（9B/20B 在 Vulkan 上审长代码会偶发卡死，属原生层问题）；
- Phi-4-mini 不能用作审查模型（已从下拉隐藏）；
- 云端复审只接受 https（本机回环可 http），每次调用都要确认目标域名；
- 看图固定走 CPU 编码，1440×900 截图约 40–60 秒。

## 出品

- **出品**：**卿峣Testifypred**（QingYaoTP = QingYaoTestifypred）
- **开发工具链**：**Powered By DeepSeek Harness**

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
