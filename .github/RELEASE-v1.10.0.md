# v1.10.0 — 多文件 / 整工作区一起审查

**发布日期**：2026-11-20 · **类型**：新功能（代码工作区）

> 由 **卿峣Testifypred** 出品 · Powered By DeepSeek Harness

## 下载

| 文件 | 大小 | SHA256 |
|---|---|---|
| `QingYaoTP-AILauncher-v1.10.0.zip`（主包，必装） | 127,941,208 B（约 122 MB） | `49E6D6839F1B8A97ED82AC2AA3DB56220245CDB3F3FE8323AE4DA2E6C1773FF9` |
| `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（视觉增强包，选装） | 38,408,198 B（约 37 MB） | 见该文件发布页 |

主包解压后约 **258.7 MB / 3,447 个文件**；**不含**看图 sidecar（拆成可选增强包，不看图可忽略）。

## 本版新增：多文件 / 整工作区一起审查

以前「模型审查」一次只能审一个文件；改完一个文件想再看另一个，要重复点。v1.10.0 让代码面板能**一次审多个文件**：

1. **勾选多个文件**：文件列表每一行左边多了勾选框（表头「全选」+「已选 N」，刷新列表保留勾选）；面板上有两个入口——**审查选中**（审勾的这几个）与**审查工作区**（审 `workspace\code\` 下当前全部文件）。
2. **计划先行**：开始前先算计划（`POST /api/code/review/multi/plan`，不加载模型）——一次最多 **8 个文件**、单文件 **6000 字符**、可审文件累计 **36000 字符**；空文件 / 太大 / 读不到的会在结果区列出**跳过原因**，不会静默丢。
3. **逐文件结论**：每个文件一张卡，先流式出「审查思路」，再出问题清单；卡头显示「行 N · M 个问题」，点卡片头直接打开该文件并高亮它的问题，点某条问题跳到那一行。
4. **跨文件总览**：两个及以上文件时再多跑一轮，找**文件之间**的不一致（调用与实现不匹配、重复定义、约定/命名不一致等），不重复各文件内部已列的问题；跨文件问题同样可以点着跳。
5. **导出**：新增「导出多文件复审」→ `.multi.review.md`（总览 / 逐文件结论 / 跨文件问题 / 跳过清单；**只含结论不含代码正文**）。
6. **稳定性**：与既有的审查 / 纠正 / 质询 / 他人复审 / 云端复审**共用一把串行锁**（多文件进行中 `POST /api/load` 仍返回 409，防切换模型把原生层卡死）；每个文件独立小 sequence 且用完释放；**单个文件失败只标红那张卡，不影响其余文件**。

## 探针与验证

- 新增 `probe-code-review-multi` **86 条**：A 纯函数 39（路径归一 / 计划预算 / 跨文件归一 / Markdown）/ B API 校验 15 / C 真 4B SSE 14（事件顺序、行号、`lineText`、跨文件、`done.stats`、并发 `/api/load` 409）/ D 导出 8 / E UI 9。
- 全量驱动 65 → **66 条**，断言口径 1,318 → **1,404**；**66 条整跑 64 绿 + 2 环境红（probe-small-features 5/6 → 隔离复跑 6/6 全绿；probe-web-tools 15/19，百度反爬 0 条、同探针后段流式搜索正常 → 外网波动）；断言口径 1404，5 条未过 = 1399/1404**。
- 目标回归：`probe-version` 14/14、`probe-code-review-export` 66/66、`probe-code-panel-v2` 44/44、`probe-code-review-stream` 45/45（3 skip）、`probe-code-review-verify` 87/87。
- 发布包冒烟：probe-version 14/14、probe-debug 54/54、probe-readme 21/21、probe-code-review-export 66/66、probe-code-panel-v2 44/44、probe-code-review-multi 86/86（dist 实例 v1.10.0，真 4B + headless Edge）。
- 实测耗时（本机 4B）：单文件审查 30–50s；多文件约 60–90s/个（2 个 8 行小文件约 130–180s + 跨文件总览）。

## 升级方式

1. 托盘右键 →「停止服务并退出」；
2. 把新 zip 解压覆盖到原安装目录；
3. 保留 workspace / data / models 三个目录即可无损。

> 目前**没有自动更新**，请以本页版本号为准。

## 已知限制

- 仅 Windows 10/11 x64；Mac / Linux 暂不支持；
- 多文件一次最多 8 个、单文件 6000 字符、累计 36000 字符；超出会跳过并在计划里说明原因；
- 多文件**不参与**质询 / 他人复审 / 云端复审 / 三方对照（仍是单文件流程），多文件问题卡也没有「一键更改」；
- Phi-4-mini 不能用作审查模型（Vulkan 上偶发原生层卡死），界面上已隐藏；
- 云端复审只接受 https（本机回环可用 http），每次调用都要确认目标域名；
- 看图固定走 CPU 编码，因此 1440×900 截图约 40–60 秒。

## 出品

- **出品**：**卿峣Testifypred**（QingYaoTP = QingYaoTestifypred）
- **开发工具链**：**Powered By DeepSeek Harness**

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
