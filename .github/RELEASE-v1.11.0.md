# v1.11.0 — 体验与稳定性（终端 TUI 2.0 / 输出提速 / 审查卡死修复）

**发布日期**：2026-11-22 · **类型**：体验优化 + 稳定性修复（累积 2026-11-22 全部未发布改动）

> 由 **卿峣Testifypred** 出品 · Powered By DeepSeek Harness

## 下载

| 文件 | 大小 | SHA256 |
|---|---|---|
| `QingYaoTP-AILauncher-v1.11.0.zip`（主包，必装） | 127,961,662 B（约 122 MB / 3,948 条目） | `18B83B2920DF2617CC6D72EE39F900095648D33568C14C10F42BEF63ECCA7932` |
| `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（视觉增强包，选装） | 38,408,198 B（约 37 MB） | 见该文件发布页 |

主包解压后约 **258.8 MB / 3,448 个文件**，**不含**看图 sidecar（拆成可选增强包；不看图可忽略）。

## 本版重点

### 1. 终端 TUI 2.0.0
- 头部显示 `tui 2.0.0 · 主程序 v1.11.0`（两条版本线解耦）；
- 流式 **Markdown / LaTeX 降级渲染**（没有渲染库也能读）；
- 空输入按 `/` 开**能力面板**（命令 + 工具，带参数说明）；
- 输入区线框 + 可见光标；等待时 `/ - \ |` 旋转 + 原创颜文字。

### 2. 主页面输出优化
- 流式改**块级增量渲染**：6000 字单帧 **14.3–16.8ms → 0.37–0.48ms**；
- rAF 合帧 + 滚动合并；流式期间不跑全量 KaTeX；
- 工具说明瘦身（tools 首字 **6.4–7.1s → 5.3–5.9s**）+ **首字税 chip**；
- 设置新增**极简流式**（老机器 / 长回答可选）。

### 3. 20B 内存与加载
- 三处 `llama.loadModel` 显式 **`useMmap:false`**（Windows Vulkan 上默认 mmap 会让权重双份）；
- 20B 加载 **48.6s → 14.0s**、可用内存 **0 → 8.1GB**、生成 **13.7 tok/s**（4B 15.3 tok/s）；
- 卸载后 ~20GB 是 Windows 备用缓存，不是泄漏。

### 4. 代码工作区 UI
- 窗口可**拖拽 / 最大化 / 原生缩放**；编辑区与审查栏之间加**分隔条**（宽度记忆、双击复位）；
- 审查结果改成**标签页**（∫ 模型审查 / ≠ 他人复审 / ☁ 云端复审，带模型名）；
- 没点「模型审查」直接点「他人复审」时，先自动补一次普通审查作为第 1 个结果；
- 审查面板滚动修复：思路追加时距底 <80px 才跟随，上滚不再被拽回。

### 5. P0 修复：本地模型审查卡住
**根因（确定性）**：`cwReviewCode()` 在 `try` 之前读了未声明的 `lineCount` → `ReferenceError`，且抛出点在 `cwReviewBusy=true` 之后、`finally` 之前 → busy 永不释放、**后端一次请求都没收到**。所以页面停在「审查思路（思考中…）」、除云端复审外按钮全灰，而服务日志里没有任何审查记录。

修复 + 防御：
- 修根因（`const lineCount = code.split("\n").length`）；
- 前端：SSE **空闲看门狗 120s**（无任何事件 → abort + 明确报错，400ms 保险丝强制清 busy）、单次审查**总时长闸 300s**、`unhandledrejection` **结构兜底**（busy 卡住且无 SSE 在跑时自动收尾）；
- 后端：审查生成**停滞看门狗 120s**（思路 / JSON 阶段无输出 → 504 error + 释放 codeJob 锁）。

**已知限制**：Vulkan 原生层偶发彻底卡死仍存在（事件循环不转、`/api/state` 超时、CPU 持续涨）。此时界面会在 120s 内报错并恢复按钮，但进程需要重启启动器；不要用 9B/20B 审长代码（长代码用 4B 或分段）。

## 探针与验证

- 新增 `probe-review-watchdog` **56 条**（A 空闲闸 / C 总时长闸 / D 兜底 / B 后端停滞闸）；
- 全量驱动 **70 条 / 1524 断言**（新增 1 条探针、+56 断言）；
- 目标回归：`probe-review-watchdog` 56/0、`probe-code-review-stream` 48/0、`probe-code-window-ui` 10/0、`probe-review-scroll` 10/0；
- 手点真 4B：22 行 **87.3s / 2 问题**；62 行 **129.9s / 4 问题**；
- 全量整跑与发布包冒烟结果见 release 附件说明 / 仓库 `server\docs\feature-review-watchdog-2026-11-22\`。

## 升级方式

1. 托盘右键 →「停止服务并退出」；
2. 把新 zip 解压**覆盖**到原安装目录；
3. 保留 `workspace\`、`data\`、`models\` 三个目录即可无损（模型不用重下）。

> 目前**没有自动更新**，请以本页版本号为准。

## 已知限制

- 仅 Windows 10/11 x64；Mac / Linux 暂不支持；
- 本地审查长代码建议用 4B（9B/20B 在 Vulkan 上审长代码会偶发卡死，属原生层问题）；
- Phi-4-mini 不能用作审查模型（已从下拉隐藏）；
- 云端复审只接受 https（本机回环可 http），每次调用都要确认目标域名；
- 看图固定走 CPU 编码，1440×900 截图约 40–60 秒。

## 出品

- **出品**：**卿峣Testifypred**（QingYaoTP = QingYaoTestifypred）
- **开发工具链**：**Powered By DeepSeek Harness**

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
