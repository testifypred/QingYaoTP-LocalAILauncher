# 契约：云端复审上游真流式（v1.9.1）

## 1. 上游请求

- `POST {baseURL}/chat/completions`（URL 拼接规则同 v1.8.0/1.8.1）
- 新增 `stream: true`（原来 false）；其余字段不变：model / messages / temperature / max_tokens；attempt1 仍带 `thinking:{type:"disabled"}`。

## 2. 响应处理

- **`text/event-stream`**：逐块解析，按空行切事件、每行 `data: {json}`（`[DONE]` 忽略）。
  - `choices[0].delta.content` 累加并**立即**转发 `{type:"delta", text}`；
  - `choices[0].delta.reasoning_content`（或 `reasoning`）同样累加并转发（前端输出区按到达顺序展示）；
  - `choices[0].finish_reason` 记录。
- **非 SSE（200 整段 JSON）**：按 v1.8.1 解析 `choices[0].message`，由外层按 80 字切块补发 delta（老网关兼容，行为不变）。
- 非 200：读前 400 字错误体 → `{ok:false,status,rawText}`，外层照旧 502 或按重试阶梯处理。

## 3. 重试阶梯（保留 v1.8.1 语义 + 新事件）

1. attempt1：thinking 关 + max_tokens=M；
2. attempt2：仅当 attempt1 是 400/422/404 且 body 含 `thinking` → 去掉 thinking 重发；
3. attempt3：200 但 content 空且 reasoning 非空 → 去掉 thinking、max_tokens=min(6000,max(2400,3M)) 重发；
4. 兜底：仍空且 reasoning 非空 → reasoning 当正文，`meta.usedReasoningFallback=true`；两边都空才 502 `CLOUD_EMPTY`。

**新事件 `retry`**：`{type:"retry", attempt, reason}`，在重新发起上游请求之前发；前端收到后清空输出区（cwThinkBegin），避免 attempt1 的 reasoning 增量与 attempt3 输出叠在一起。服务端同时把 deltaCount 清零。

## 4. meta

`{type:"meta", provider:"cloud", host, model, sentChars, redactions, startedAt, attempts, thinkingDisabled, usedReasoningFallback, streaming:true}`

- 第一个 delta 到来时发一次（前端立刻进入「输出中」状态）；
- 全部结束后再发一次，带最终 attempts / thinkingDisabled / usedReasoningFallback（前端与探针以最后一个 meta 为准）。

事件序列：`meta → delta* → (retry → meta → delta*)? → meta → findings → done`。

## 5. 前端（app.html）

- cwCloudSend 新增分支：retry → 重开输出区 + 状态行「上游返回空正文/不认 thinking，正在重试（第 N 次）…」；
- 首个 delta：状态行显示「云端复审输出中（首字 X s，流式）…」；
- done：状态行带「（流式 N 段）」。

## 6. 探针

`server\probe-cloud-upstream-stream.mjs` **24 条**（本地 node:http SSE stub，不出网，不需要模型）：
S 真流式 8 条 / R 推理重试 7 条 / N 非 SSE 兜底 4 条 / E 空正文 2 条 / Z 收尾 3 条。关键断言：

- 首个 delta 到达时间**早于** stub 最后一块发送时间（证明不是收全再切）；
- delta 段数 = stub 块数、拼接 = 全文；
- retry 事件在 findings 之前、retry 后的 delta 只含 attempt3 内容、stub 被请求 >=2 次、最终 meta.attempts>=2；
- 空正文 → 502 `CLOUD_EMPTY`（非 SSE 200）。

全量驱动：64 → **65 条**；断言口径 1290 → **1314**。

## 7. 边界

- 不变：确认域名、脱敏、只发当前文件、Key 只存本机、日志不记原文/正文/Key。
- 超时仍由 `CLOUD_JOB_TIMEOUT_MS`（默认 60000，夹 5000–180000）管；读流中途超时抛 504。
- 不改变 findings 解析与一键纠正路径（仍走 parseFindingsFromText + snapIssuesToCodeLines）。
