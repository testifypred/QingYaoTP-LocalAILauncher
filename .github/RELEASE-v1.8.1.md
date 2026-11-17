# v1.8.1 — 云端复审兼容推理型模型

**发布日期**：2026-11-16 · **类型**：缺陷修复（云端复审）+ 探针加固

> 由 **卿峣Testifypred** 出品 · Powered By DeepSeek Harness

## 下载

| 文件 | 大小 | SHA256 |
|---|---|---|
| `QingYaoTP-AILauncher-v1.8.1.zip`（主包，必装） | 127,902,252 B（约 122 MB） | `BE6AB2CBCE5B8D930933212286A1B77AB0897AA8F296FE829366DEC034A874EC` |
| `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（视觉增强包，选装） | 38,408,198 B（约 37 MB） | 见该文件发布页 |

主包解压后约 **258.6 MB / 3,447 个文件**；**不含**看图 sidecar（拆成可选增强包，不看图可忽略）。

## 本版修了什么

**「云端复审」在推理型模型上会误报失败。** 配置 `https://api.deepseek.com` + `deepseek-flash` 时，面板报：

> 云端复审失败：上游 200 但没有返回内容（不是 OpenAI 兼容响应？）

根因：这类模型先输出 `reasoning_content` 再输出 `content`，默认 `max_tokens=1200` 会被思考过程吃光（`finish_reason=length`、正文 0 字），而旧版只读 `content`。

修法：

1. 请求默认带 `thinking: { type: "disabled" }`（关掉推理）；
2. 不认这个参数的上游（4xx）→ 去掉它重发；
3. 200 但正文空、只有 reasoning → 去掉 thinking 并放大 `max_tokens` 重发；
4. 仍为空 → 把 reasoning 当正文（`meta.usedReasoningFallback`）；两边都空才报 `502 CLOUD_EMPTY`，并提示「换成非推理模型或加大 max_tokens」。

实测：`deepseek-flash` 从「报错」变成 **1.5–2.8 秒返回**，且能正常给出问题清单。

## 顺带的改进

- `meta` 新增 `attempts` / `thinkingDisabled` / `usedReasoningFallback`，面板能看出走了哪条路；
- 日志红线不变：不记 API Key、不记代码正文、不记上游原文；
- 探针新增 **F1–F4** 四条「推理型模型」回归（本地 stub，不出网）：探针 73 → **87 条**，全量断言口径 1,210 → **1,224**；
- 探针现在会**备份并原样写回**云端配置，不会再清掉你配好的 Key。

## 升级方式

1. 托盘右键 →「停止服务并退出」；
2. 把新 zip 解压覆盖到原安装目录；
3. 保留 `workspace\`（会话 / 代码 / 索引）、`data\`（界面状态与云端配置）、`models\`（模型）三个目录即可无损。

> 目前**没有自动更新**，请以本页版本号为准。

## 已知限制

- 仅 Windows 10/11 x64；Mac / Linux 暂不支持；
- Phi-4-mini 不能用作审查模型（Vulkan 上偶发原生层卡死），界面上已隐藏；
- 云端复审只接受 https（本机回环可用 http），每次调用都要确认目标域名；
- 看图固定走 CPU 编码，因此 1440×900 截图约 40–60 秒。

## 出品

- **出品**：**卿峣Testifypred**（QingYaoTP = QingYaoTestifypred）
- **开发工具链**：**Powered By DeepSeek Harness**

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
