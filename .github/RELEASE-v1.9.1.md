# v1.9.1 — 云端复审上游真流式

**发布日期**：2026-11-19 · **类型**：体验改进（云端复审）

> 由 **卿峣Testifypred** 出品 · Powered By DeepSeek Harness

## 下载

| 文件 | 大小 | SHA256 |
|---|---|---|
| `QingYaoTP-AILauncher-v1.9.1.zip`（主包，必装） | 127,913,114 B（约 122 MB） | `4586C0D37716E6E1A19787BE7870E700141604A1A8328CE5C322364EC4609D36` |
| `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（视觉增强包，选装） | 38,408,198 B（约 37 MB） | 见该文件发布页 |

主包解压后约 **258.7 MB / 3,447 个文件**；**不含**看图 sidecar（拆成可选增强包，不看图可忽略）。

## 本版改进

**云端复审从「等上游整段返回」改成「上游真流式」**：以前服务端用 `stream:false` 收完整段再按 80 字切给前端，上游慢时界面上只有计时、没有进度；现在用 `stream:true` 请求 OpenAI 兼容 SSE，收到一个 delta 就推一个，前端立刻能看到输出。

- 兼容两种上游：返回 `text/event-stream` 的按真流式解析；只返回整段 JSON 的老网关自动走原来的 80 字切块兜底，行为不变。
- v1.8.1 的推理型模型重试阶梯保留：不认 `thinking` → 去参数重试；200 空正文 + 有 reasoning → 放大 `max_tokens` 重试；重试时会发一个 `retry` 事件让前端清空上一次已收到的增量，不会两次输出叠在一起。
- `meta` 增加 `streaming` 标记；前端显示首字耗时与流式段数。
- 安全口径不变：每次云端复审仍要确认目标域名、只发脱敏后的代码、Key 只存本机。

## 探针

- 新增 `probe-cloud-upstream-stream` **24 条**（本地 SSE stub，不出网）：真流式「首字早于上游最后一块」、delta 拼接、推理型重试的 retry 事件与 attempts、非 SSE 兜底、空正文 502 `CLOUD_EMPTY`、收尾恢复云端配置。
- 全量驱动 64 → **65 条**，断言口径 1,290 → **1,314**。
- 发布包冒烟：`probe-version` 14/14、`probe-debug` 54/54、`probe-readme` 21/21、`probe-code-review-export` 66/66。

## 升级方式

1. 托盘右键 →「停止服务并退出」；
2. 把新 zip 解压覆盖到原安装目录；
3. 保留 `workspace\`、`data\`、`models\` 三个目录即可无损。

> 目前**没有自动更新**，请以本页版本号为准。

## 已知限制

- 仅 Windows 10/11 x64；Mac / Linux 暂不支持；
- Phi-4-mini 不能用作审查模型（Vulkan 上偶发原生层卡死），界面上已隐藏；
- 云端复审只接受 https（本机回环可用 http），每次调用都要确认目标域名；
- 看图固定走 CPU 编码，因此 1440×900 截图约 40–60 秒；
- 三方对照只对照已经跑出来的快照；云端上游流式化后，超时仍由 `CLOUD_JOB_TIMEOUT_MS` 管（默认 60s）。

## 出品

- **出品**：**卿峣Testifypred**（QingYaoTP = QingYaoTestifypred）
- **开发工具链**：**Powered By DeepSeek Harness**

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
