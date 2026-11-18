# 真实上游兼容性冒烟（云端复审 / v1.8.1 推理型模型）

- 时间：2026-11-19 00:05（Asia/Shanghai；目录名按任务沿用 2026-11-18）
- 目标服务：`http://127.0.0.1:8099` —— **发布包实例 v1.8.1**（`D:\LocalModels\dist\QingYaoTP AILauncher\app`，pid 21672，未重启、未改动）
- 真实上游：`https://api.deepseek.com` · 模型 `deepseek-flash`（用户已在「设置 → 代码 → 云端复审」配置好；本探针只读配置，不打印明文 Key）
- 探针：`server\probe-cloud-upstream-real.mjs`（新增；**手动 / 发版前冒烟，不进 run-full.ps1**）
- 证据：本目录 `run.txt`（探针原始输出，UTF-8，3,496 字节）

## 结果：**20/20 通过**（exit 0）

```text
== 结果: 20/20 通过 ==
RESULT 20/20
```

| 项 | 值 |
|---|---|
| 探针断言 | **20 / 20**（P1–P3 + S1–S16 + Z1） |
| HTTP / 协议 | **200 + text/event-stream**，事件序列 `meta -> 18×delta -> findings -> done` |
| 真实上游 | `api.deepseek.com` / `deepseek-flash`，**attempts=1** |
| meta 字段 | `thinkingDisabled=true`、`usedReasoningFallback=false`（都是 boolean）、`sentChars=377`、`redactions=0` |
| findings | `parsed=true`、`lineCount=9`（= 合成代码行数）、`issues` 数组 4 条 |
| 计时 | 端到端（含网络）**4.0s**；`done.seconds=4` |
| 泄露反向断言 | 3,373 字符响应里没有 apiKey 可见尾段、没有 `sk-` 长串明文、没有完整 `keyMasked` |
| 配置卫生 | 运行前后 `GET /api/cloud/config` 一致（enabled/host/hasKey 不变），探针没写任何配置 |
| 外部请求数 | **1 次**（探针 1 次 `POST /api/code/review/cloud` = 服务端 1 次上游请求） |

## 1. 复跑命令（证据就是这么产生的）

```powershell
# 0) 前提：服务在跑 + 「设置 → 代码 → 云端复审」已启用（enabled/ready/hasKey 都为真）
cd D:\LocalModels

# 1) 直接看结果（只发 1 次真实上游请求，9 行合成代码）
node server\probe-cloud-upstream-real.mjs http://127.0.0.1:8099

# 2) 存证据（用 cmd /c 重定向，保留 Node 的 UTF-8 原始字节；PowerShell 5.1 的 > 会写成 UTF-16）
cmd /c "node server\probe-cloud-upstream-real.mjs http://127.0.0.1:8099 > server\docs\feature-cloud-upstream-real-2026-11-18\run.txt 2>&1"
```

退出码：断言失败 → 1；全过 → 0；**SKIP → 0**（服务没起 / 配置未就绪都不算失败，不发任何上游请求）。

## 2. 探针做什么 / 不做什么

- 只读 `GET /api/state`（拿 localToken）与 `GET /api/cloud/config`（拿 `enabled/ready/host/model/hasKey/keyMasked`，本来就是遮罩）。
- 配置不就绪：打印清楚 SKIP 原因（缺 enabled / 缺 Key / host 为空 / model 为空 / 服务不可用）并 **exit 0**。
- 就绪时发 **1 次** `POST /api/code/review/cloud`（SSE，body 带 `confirm=host`，header 带 `x-local-token`），代码是自写的 **9 行 JS**（`sumPrices`：循环 `i <= items.length` 越界、`items[i].price` 空值未防、`total / items.length + 1` 口径多余），不含任何用户数据。
- 不 POST 改云端配置、不读 `data\cloud-review.json`、不写日志、不重启服务、不打印明文 Key。
- 自测：先用一个本地假 app 接口（临时 stdin 脚本，不写仓库文件、不产生费用）把探针自身解析/断言跑通 **20/20**，再打真上游。

## 3. 断言口径（20 条）

| 组 | 断言 |
|---|---|
| P 前置（3） | P1 `/api/state` 200 + localToken 可用；P2 `/api/cloud/config` 200 + enabled/ready/host 就绪；P3 `keyMasked` 是「前3+***+后4」遮罩 |
| S 真跑（16） | S1 HTTP 200 + text/event-stream；S2 不是 502 / 正文无 `CLOUD_EMPTY` / 无 error 事件；S3 meta 第一；S4 `meta.provider=cloud`；S5 `meta.host` = 配置 host；S6 `meta.attempts>=1` 整数；S7 `thinkingDisabled` 是 boolean；S8 `usedReasoningFallback` 是 boolean；S9 findings 存在且 `issues` 是数组；S10 `parsed` 是 boolean 且 `lineCount` = 代码行数；S11 delta≥1 段且都在 meta 与 findings 之间；S12 `done.seconds>0`；S13 done 最后；S14 响应全文不含 Key 可见尾段；S15 响应全文无 `sk-` 长串明文、不含完整 keyMasked；S16 端到端 < 60s |
| Z 收尾（1） | Z1 探针没改云端配置（enabled/host/hasKey 前后一致） |

## 4. 关键发现（真实上游协议细节）

### 4.1 `thinking:{type:"disabled"}` 被真实上游接受（attempts=1 是铁证）

服务端 v1.8.1 的重试阶梯只有三种出口：attempts=1 = 第 1 次就拿到正文；attempts=2 = 第 1 次 4xx 且报「不认识 thinking」→ 去掉 thinking 重发；attempts=3 = 第 1 次 200 但正文空、reasoning 非空 → 放大 `max_tokens` 重发。本次 **attempts=1**，说明：

- `api.deepseek.com` 对 `deepseek-flash` **接受顶层 `thinking` 参数**（若拒绝会 400 → attempts=2）；
- 且第 1 次就返回了**非空 content**（否则会 attempts=3 或 `usedReasoningFallback=true`）；
- v1.8.1 的修复在真协议上成立：默认关思考这一手没有副作用，也没有触发任何兼容重试。

### 4.2 `reasoning_content` 行为

- `usedReasoningFallback=false`：**没有**用到「正文空 → 拿 reasoning_content 当答案」的兜底；服务端只有在 `content` 为空时才会读 `reasoning_content`（app.mjs 4811–4812、4842–4848）。
- 说明在 `thinking:disabled` 下，真实 deepseek-flash 不再把 `max_tokens` 全烧在 reasoning 上（v1.8.0 被用户踩到的「200 但没内容」在本次 1 条样本上没有复现）。
- **局限（如实记录）**：服务端不把上游原始 JSON 透给客户端，探针看不到 `reasoning_content` 字段是否出现/为空；只能由 `attempts` + `usedReasoningFallback` 两个 meta 字段反推。若要直接观测，需要临时在服务端加调试日志（本轮禁止改 app.mjs，未做）。

### 4.3 有没有「流式」可能性：现在**不是真流式**，但改造可行

- 现状（读代码确认）：服务端调上游固定 `stream:false`（app.mjs 4778），**收全 JSON 后**再按 80 字符切段 `send({type:"delta"})`（4859–4864）。所以 4.0s 里浏览器只看到计时，**没有首字**；SSE 只是传输形状，不是上游增量。
- 真流式可行：DeepSeek / OpenAI 兼容接口支持 `stream:true`，上游按 `data: {"choices":[{"delta":{"content":"…","reasoning_content":"…"}}]}` 增量返回；服务端已有 `AbortController` + `AbortSignal.any` + `res.on("close")` 的停止链路（4762–4765、4736–4743），接上「逐段解析上游 SSE → 立即 send delta」即可，改动集中在 `handleCloudReviewStream` 的 `callCloudUpstream` 与推流段。
- 需要一并处理：reasoning 增量与正文增量分流（避免把思考过程当正文）、`CLOUD_EMPTY` 判定挪到流结束后、前端已支持的 `delta` 事件契约不用改。

### 4.4 成本 / 延迟 / 质量（1 条样本）

- 9 行代码 → 脱敏后 prompt **377 字符**，`max_tokens=800`，上游返回 18×~80 字符（约 1,400 字符），端到端 **4.0s**；外部调用 1 次。
- findings 质量正常：`parsed=true`，**4 条 issues**（我们埋的 3 类已知问题都被覆盖），行号 `lineCount=9` 与代码对齐。
- 远端延迟 4s 量级 → 强化了 4.3 的结论：**无真流式时用户要干等 4s+**，这是「云端复审升级为流式」值得做的直接证据。

## 5. 为什么不纳入 run-full.ps1（63 条口径保持不变）

1. **依赖外网 + 用户真实 API Key**：全量回归 / CI 不应依赖外网与付费调用；没有 Key 的机器会 SKIP，但有了 Key 的机器每跑一次都会产生真实外部请求（含认证）。
2. **非确定性**：上游模型版本、限流、网络抖动都会影响结果；断言的「不变量」只有协议形状与 v1.8.1 语义，不适合作为门禁。
3. **成本**：每次跑至少 1 次上游请求（最坏重试阶梯 3 次）；全量 63 条会被反复跑，不适合夹带。
4. **定位不同**：stub（`probe-code-review-verify` F 段）证「代码路径」，这条只证「真实上游协议兼容」——是**手动 / 发版前冒烟**：换 Key、换云端模型/域名、升级服务端云端逻辑、或发布 v1.8.x 前各跑一次。

因此 `server\docs\run-full.ps1` **未改动**，全量仍是 **63 条 / 断言口径 1224**；本探针只在证据目录留档。

## 6. 如何启用 / 复跑

1. 界面「设置 → 代码 → 云端复审」填 baseURL / 模型 / API Key 并勾选启用（`GET /api/cloud/config` 的 `enabled && ready` 为真）。
2. `node server\probe-cloud-upstream-real.mjs http://127.0.0.1:8099`（或按上面的 `cmd /c` 组合存证据）。
3. 想临时「关掉」这条冒烟：设置里取消启用或清空 Key → 探针自动 SKIP、exit 0，不发任何请求。
4. 服务没起时也是 SKIP（exit 0）；本探针不会自己拉起服务、不会重启 8099。

## 7. 约束执行与卫生

- **只写了** `server\probe-cloud-upstream-real.mjs` 与本目录（`run.txt` / `RESULT.md`）；未改 app.mjs / app.html / dist / 构建脚本 / run-full.ps1 / 其它 probe。
- **未重启 8099**：发布包实例 v1.8.1（pid 21672）保持运行；探针只做 3 次 GET + 1 次 SSE POST。
- **未读 `data\cloud-review.json`、未打印明文 apiKey**；`run.txt` 里只有后端本来就返回的遮罩 `sk-***ffd7`（用它的后 4 位做「响应不含 Key 片段」的反向断言，见 S14）。
- 未 `git commit` / `git push`。
- 云端配置运行前后一致（Z1）；本次冒烟没有改动任何模型加载状态（云端复审不依赖本地模型）。

## 8. 证据清单

| 文件 | 说明 |
|---|---|
| `run.txt` | 探针原始输出（20/20、attempts/thinkingDisabled/usedReasoningFallback、耗时、脱敏计数、反泄露断言） |
| `RESULT.md` | 本文件 |
