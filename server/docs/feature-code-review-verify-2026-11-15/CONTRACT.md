# CONTRACT v1.8.0 —— 质询 / 他人复审 / 云端复审

> 本轮（2026-11-15 深夜，v1.7.1 → **v1.8.0**）唯一需求：**代码审查的「二次验证」三件套**。
> 背景（用户拍板）：单模型自审有盲区（Web 版 DeepSeek：「AI 发现不了自己的问题」；实测 9B 会把问题标到空行、也说「没问题」）。
> 本文件是**唯一的接口/字段/ID 契约**：后端、前端、探针三方都按这里写，谁先写完都不许改字段名。
> 需求来源：`新会话启动词.md`「下一步」第 1 项 + `交接文档.md`「下一步」第 1 项。

---

## 0. 范围与不变量

| 做 | 不做 |
|---|---|
| ① 质询（质疑原审查结论，模型反驳/自证，产出质询记录） | 不改旧接口行为（`/api/code/review`、`/api/code/review/stream`、`/api/code/fix` 全部保持原样） |
| ② 他人复审（换一个模型独立再审，UI 并列 + 判定 一致/仅一方/矛盾） | 不重打视觉增强包（沿用 v1.6.0 那份） |
| ③ 云端复审（OpenAI 兼容 API，脱敏外发，每次确认） | 不让云端配置进交付包（`data\\` 已被 zip 排除，另加断言） |

**不变量（硬约束，违反即打回）**
1. 三条新接口全部走**同一把串行锁** `codeJobLocked`；审查/纠正/质询/复审/云端进行中 `POST /api/load` 必须仍然 **409**（`codeJob.busy` 已有逻辑，复用即可）。
2. 破坏性接口（POST）必须校验 `x-local-token`，缺失/错误 **403**（与 `/api/code/review/stream` 一致）。
3. 浏览器收到的 SSE 事件用 `data: {json}\n\n`（复用现成的 `sseOpen()`）。
4. **apiKey 永不落日志、永不出现在任何响应、永不进 git**。
5. 只改 `server/app.mjs` + `server/app.html` + 新探针 + `run-full.ps1` + 文档；**不新增 server 侧 import 模块**（避免 build-portable.ps1 清单漏项）。
6. 代码统一用 `CODE_REVIEW_MAX_CHARS`（20000 字符）上限，超限 **413**。
7. 版号 1.7.1 → **1.8.0**：`app.mjs` 的 `APP_VERSION`、`server/package.json`、`server/localai.mjs` 三处对齐；TUI 的 `VER` 不动。

---

## 1. 接口契约

### 1.1 `POST /api/code/review/challenge` —— 质询（SSE，令牌必需）

把「代码 + 原审查结论 + 用户的质疑」喂回模型，让它**反驳或自证**；多轮靠前端回传 history。

**请求体**
```json
{
  "code": "……（必填，<=20000 字符）",
  "lang": "python",
  "file": "main.py",
  "intent": "用户意图（可选）",
  "primary": { "summary": "原审查结论", "issues": [ { "line": 3, "endLine": 3, "severity": "error", "title": "t", "detail": "d", "fix": "f" } ] },
  "question": "用户的质疑（必填，1..1000 字符）",
  "history": [ { "question": "上一轮质疑", "answer": "上一轮模型回答" } ],
  "model": "另一模型的 gguf 文件名（可选，省略=当前已加载）",
  "max_tokens": 1200
}
```
- `history` 最多 **4** 轮（多传截断到最近 4 轮）；每轮 question/answer 各截断到 1500/4000 字符。
- `primary` 可省略（没有原结论也能质询，只是少了对照）。

**SSE 事件序列**（顺序固定）
```text
meta      {type:"meta", model, modelFile, contextSize, switchedModel, startedAt, turn}
delta     {type:"delta", text}                     // 0..n 段，逐段推正文
done      {type:"done", seconds, model}            // 最后
error     {type:"error", message}                  // 出错时；此时不发 done
```
**状态码**：403 令牌 / 400 缺 code 或 question 为空 / 413 code 超长 / 404 模型不存在 / 409 无模型或模型忙 / 504 超时。

**提示词要求（后端）**：系统提示词规定「对每条质疑给出 成立 / 不成立 / 需验证 的结论 + 依据 + 最小验证步骤；承认自己上轮说错时不狡辩；不输出 JSON、不输出代码块；≤400 字」。同一 context 里把 `history` 逐轮重放后再问新问题（**stateless**：每次请求新建小 context，用完 dispose，不碰主会话 KV 缓存）。

**超时**：复用 `CODE_JOB_TIMEOUT_MS`（默认 300s）+ `res.on("close")` 掐生成（与 v1.7.1 相同写法）。

---

### 1.2 `POST /api/code/review/cross` —— 他人复审（SSE，令牌必需）

**请求体**
```json
{
  "code": "……（必填）",
  "lang": "python", "file": "main.py", "intent": "……",
  "primary": { "summary": "原审查结论", "issues": [ … ] },
  "model": "第二审查员模型 gguf（可选）",
  "role": "可选，第二审查员角色（默认「独立复核员」）"
}
```
**选模型规则（后端，确定性）**
- 指定了 `model` → 用它；与当前相同则 `sameModel=true`。
- 没指定 → 在模型列表里挑**第一个与当前不同的**模型（按 `scanModels()` 顺序）；只有一个模型时用当前模型 + `temperature 0.45` + 对抗式提示词，`sameModel=true`。
- **永远不使用 `Phi-4-mini*`**（Vulkan 上偶发原生层卡死）：候选过滤 `/^Phi-4-mini/i`，只剩 Phi 时按「只有一个模型」处理（sameModel=true，用当前模型）。
- 切模型走 `pickCodeJobModel` 同款前置检查（loading / activeChats / vision → 409）。

**SSE 事件序列**
```text
meta      {type:"meta", model, modelFile, contextSize, switchedModel, sameModel, startedAt}
delta     {type:"delta", text}                     // 第二审查员的「审查思路」，流式
phase     {type:"phase", phase:"findings"}         // 第二阶段开始（整理 JSON）
findings  {type:"findings", summary, issues, parsed, lineCount}
compare   {type:"compare", verdict, stats, agree, onlyPrimary, onlySecond, conflicts}
done      {type:"done", seconds, model}
error     {type:"error", message}
```
- `findings.issues` 必须已过 `snapIssuesToCodeLines`（行号吸到真代码行）。
- `verdict` 取值：**`"consistent"`（一致）/ `"differs"`（仅一方提出）/ `"contradicts"`（互相矛盾）**。

**比对算法（后端纯函数 `compareReviewFindings(primaryIssues, secondIssues)`，必须可确定性复算）**
1. 归一：`{line, endLine, severity(rank: error=2,warn=1,info=0), title}`，行号 clamp 到 `1..lineCount`。
2. 匹配：对每条 second 问题，找**未被占用**且与它行距 ≤2（或区间有交集）的 primary 问题里行距最小的；并列取 primary 里行号小的。每条 primary 只用一次。
3. 匹配对：`rank` 相等 → `agree`；`rank` 不等 → `conflicts`（`reason: "严重度不一致：error vs info"`）。
4. 未匹配 → `onlyPrimary` / `onlySecond`。
5. `stats = {primary, second, matched, agree, onlyPrimary, onlySecond, conflicts}`（各为计数；`matched = agree + conflicts`；`matched + onlySecond === second`；`matched + onlyPrimary === primary`）。
6. `verdict`：
   - `contradicts`：`conflicts.length > 0`，**或**正好一方 0 个问题而另一方 ≥1 个问题；
   - `differs`：`onlyPrimary.length + onlySecond.length > 0`（含只有一方提出问题）；
   - `consistent`：两侧问题完全匹配（含两侧都是 0 个问题）。
7. `agree/onlyPrimary/onlySecond/conflicts` 每项都是完整对象（`conflicts` 是 `{primary, second, reason}`），前端要能直接渲染。

**提示词要求**：第二审查员 system 提示词写明「你是独立复核员，不复述原审查意见（不给你），从零审查；只输出审查思路（- 行号 + 依据）；别客气、别下结论式客套」。第二阶段 JSON 复用 `CODE_REVIEW_JSON_SYSTEM` 的格式要求（**注意 primary 不要塞进第二阶段提示，避免被带偏**）。

---

### 1.3 云端复审

#### 1.3.1 配置存储
- 落盘：`<程序目录>\\data\\cloud-review.json`（app.mjs 里用 `path.join(HERE, "..", "data", "cloud-review.json")`；dev 即仓库根 `data\\`，不存在就 mkdir）。
  - 为什么不是 config.ini：dev 目录没有 config.ini（`updateConfigFile` 会跳过）；`dist\\data\\` 已被 `make-zip.ps1` 整体排除（robocopy `/XD data`），不可能进交付包。
- 文件结构：`{ "enabled": true, "baseURL": "https://api.example.com/v1", "model": "gpt-4o-mini", "apiKey": "sk-…", "updatedAt": 1763… }`
- 读取：文件不存在/坏 JSON → 全默认（`{enabled:false, baseURL:"", model:"", apiKey:""}`），**不许抛错**。

#### 1.3.2 `GET /api/cloud/config`（只读，无令牌）
```json
{ "ok": true, "enabled": false, "baseURL": "", "model": "", "hasKey": false,
  "keyMasked": "", "host": "", "ready": false, "file": "data\\cloud-review.json" }
```
- `keyMasked`：只有 `hasKey` 时给 `"sk-***abcd"` 形状（前 3 + `***` + 后 4；key ≤ 8 字符时全遮成 `"***"`）。**绝不返回明文**。
- `host`：`new URL(baseURL).host`（baseURL 非法或空 → `""`）。`ready = enabled && baseURL && model && apiKey`。

#### 1.3.3 `POST /api/cloud/config`（令牌必需）
请求：`{ enabled?, baseURL?, model?, apiKey?, dryRun? }`（只更新出现的字段；`apiKey: ""` = 清除）。
校验（失败 400，`{ok:false, code, message}`）：
- `baseURL`：必须能被 `new URL()` 解析且协议是 `http:`/`https:`；**http 只允许本机回环**（`127.0.0.1` / `localhost` / `::1`），否则 `code:"INSECURE_URL"`「云端复审只允许 https（本机回环可用 http）」；末尾 `/` 去掉；长度 ≤ 500。
- `model`：1..120 字符。
- `apiKey`：≤ 400 字符。
- `enabled`：必须是 boolean。
- `dryRun:true` → 只校验不落盘，返回同 `GET` 的形状 + `{ok:true, dryRun:true}`。
成功：200 + `GET` 形状（`ok:true`）。

#### 1.3.4 `POST /api/code/review/cloud`（SSE，令牌必需；**每次必须确认目标域名**）
请求：
```json
{ "code": "……", "lang": "", "file": "", "intent": "",
  "confirm": "api.example.com",       // 必填：必须等于当前配置的 host（前端弹窗确认后带回来）
  "max_tokens": 1200 }
```
- 守卫：未配置/未启用 → **400** `code:"CLOUD_NOT_READY"`；`confirm` 缺失或不等于 host → **409** `code:"CONFIRM_REQUIRED"`「未确认目标域名」；code 超长 → 413。
- 上游调用：`POST {baseURL}/chat/completions`（若 baseURL 已以 `/chat/completions` 结尾则不再拼），头 `authorization: Bearer <apiKey>`、`content-type: application/json`；体 `{model, messages, temperature:0.2, max_tokens, stream:false}`。
- 上游超时：`CLOUD_JOB_TIMEOUT_MS` 环境变量，默认 **60000**，夹在 5000..180000；`AbortSignal.timeout` 实现，超时 **504** `code:"CLOUD_TIMEOUT"`。
- 上游非 2xx / 非 JSON → **502** `code:"CLOUD_UPSTREAM"`，message 带「上游 <status>：<最多 200 字>」（**只取 body，不取 headers**）。
- 脱敏：见 1.3.5，请求里只发脱敏后的代码。
- **SSE 事件序列**：`meta{type,provider:"cloud",host,model,sentChars,redactions,startedAt}` → `delta{text}`（把上游返回文本按 ~80 字分 3..n 段推，前端当思考/正文展示）→ `findings{summary,issues,parsed,lineCount}`（用 `parseFindingsFromText` + `snapIssuesToCodeLines`；解析失败 `parsed:false, issues:[]`）→ `done{seconds,model}`；失败 `error{message}`。
- 日志：`log("云端复审 " + host + " 模型 " + model + " 发出 " + sentChars + " 字符 / 脱敏 " + n + " 处 " + seconds + "s")` ——**不许出现 apiKey、不许出现代码正文**。
- 走 `codeJobLocked`（与本地审查串行，避免同时烧内存/避免 /api/load 竞态）。

#### 1.3.5 脱敏 `sanitizeCodeForCloud(text)`（纯函数，后端导出给探针用 HTTP 间接验）
返回 `{ text, counts: { apiKey, email, ip, path, hex }, total }`。按顺序替换（**先替换长的**）：
1. `apiKey`：`/(sk-[A-Za-z0-9_\-]{8,})/g` → `<API_KEY>`；`/((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*)(["']?)([^\s"',;]{6,})/gi` → `$1$2<REDACTED>`
2. `email`：`/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g` → `<EMAIL>`
3. `path`：`/[A-Za-z]:\\[^\s'"<>|]*/g` → `<PATH>`（Windows 绝对路径；含 `C:\\Users\\某人`）
4. `ip`：`/\b\d{1,3}(?:\.\d{1,3}){3}\b/g` → `<IP>`
5. `hex`：`/\b[A-Fa-f0-9]{32,}\b/g` → `<HEX>`
`total` = counts 之和（同一处被两条规则命中时，后一条不再计数——按顺序替换天然如此）。

---

## 2. 前端契约（`server/app.html`）

### 2.1 代码面板新增 DOM（id 全部固定，探针靠它们）
| id | 类型 | 作用 |
|---|---|---|
| `cwChallenge` | `<button>` | 「质询」：展开/收起质询区 |
| `cwChallengeBox` | div（默认 hidden） | 质询区容器 |
| `cwChallengeText` | `<textarea>` | 质疑输入（placeholder「例如：第 3 行不是 bug，因为…」） |
| `cwChallengeSend` | `<button>` | 发送质询（busy 时变「停止」） |
| `cwChallengeLog` | div | 质询记录卡片列表（`.cwChalCard` 里 `.cwChalQ` / `.cwChalA`） |
| `cwCross` | `<button>` | 「他人复审」 |
| `cwCrossModel` | `<select>` | 第二审查员：第一项 `value=""`「自动（换一个模型）」+ 各模型；**过滤 `/^Phi-4-mini/i`** |
| `cwCrossVerdict` | span | 判定徽标：`一致` / `仅一方提出` / `互相矛盾`（class `.ok` / `.warn` / `.err`）+ 计数 |
| `cwCrossPanel` | div（默认 hidden） | 并列两栏容器 |
| `cwCrossColPrimary` | div | 左栏「原审查」问题列表 |
| `cwCrossColSecond` | div | 右栏「他人复审」问题列表 |
| `cwCrossDiff` | div | 差异清单（`.cwDiffItem` + `.agree/.onlyP/.onlyS/.conflict`） |
| `cwCloud` | `<button>` | 「云端复审」：先弹确认，确认后才发请求 |
| `cloudConfirmModal` | div.modal（hidden） | 云端确认弹窗 |
| `cloudConfirmHost` | span | 弹窗里显示「会把当前文件的代码（已脱敏）发到 **host**」 |
| `cloudConfirmOk` | button | 「确认发送」 |
| `cloudConfirmCancel` | button | 「取消」 |
| `cloudEnabled` | checkbox | 设置 → 代码：「启用云端复审（把代码发到外部服务）」 |
| `cloudBase` | input | baseURL（placeholder `https://api.openai.com/v1`） |
| `cloudModel` | input | 模型名 |
| `cloudKey` | input[type=password] | API Key（显示占位 masked；不显示明文） |
| `cloudSave` | button | 保存配置（POST /api/cloud/config） |
| `cloudClearKey` | button | 清除已存 Key（POST apiKey:""） |
| `cloudState` | span | 状态行：`未配置` / `已保存（host）` / `已启用（host）` / `未启用` |
| `cloudHint` | span | 提示：apiKey 只存本机、不进日志 |

### 2.2 行为
1. **单锁**：`cwReviewBusy` 是所有五项（审查/纠正/质询/复审/云端）的互斥标志；busy 时其他按钮 disabled，进行中的按钮变「停止」（复用 `cwStopReview()`）。
2. **质询**：点发送 → 校验输入非空 → `POST /api/code/review/challenge`（带当前代码/lang/file/intent/最近一次 `cwIssues` 作为 primary/history）→ 回答追加到 `#cwChallengeLog`（卡片：质询问题 → 模型回答；流式时先建卡再逐段填）。history 内存保留最近 4 轮。
3. **他人复审**：`POST /api/code/review/cross`，`primary` 用当前 `cwIssues`+`summary`；流式思考进 `#cwThink`（复用）；`compare` 事件到达后：填 `#cwCrossVerdict`（`consistent`→「一致」.ok；`differs`→「仅一方提出」.warn；`contradicts`→「互相矛盾」.err + 计数 `stats`）、两栏列表、差异清单；点列表项跳到对应代码行（复用现有跳行函数）。
4. **云端**：点 `#cwCloud` → 先 `GET /api/cloud/config`：`ready=false` → toast 提示去 设置 → 代码 配置（不弹确认）；ready → 弹 `#cloudConfirmModal`，`#cloudConfirmHost` 写 host 与「已脱敏」；点确认才发请求（`confirm: host`）。结果 issues 写回 `cwIssues` 并渲染卡片（这样「一键纠正」对云端结论同样可用），`#cwReviewMeta` 显示 `云端 · host · 模型 · 秒数`。
5. **设置 → 代码**：新增「云端复审」卡片（`cloudEnabled` 未勾选时 base/model/key/save 仍可编辑保存，但不能启用）；打开设置或切到该 tab 时 `GET /api/cloud/config` 回填（key 输入框只显示 masked 占位，用户不改就不提交 apiKey 字段）。
6. 所有新文案中文；不破坏既有 id（`#cwReview`/`#cwFixAll`/`#cwReReview`/`#cwSendChat`/`#cwReviewModel`/`#cwThink*`/`#cwIssues`/`#cwReviewState`/`cwColor*` 全部保留）。

### 2.3 CSS
新增类：`.cwChalCard`、`.cwChalQ`、`.cwChalA`、`.cwCrossCols`（两列 flex/grid，窄窗换行）、`.cwCrossCol`、`.cwDiffItem`、`.cwDiffItem.agree/.onlyP/.onlyS/.conflict`、`.cwVerdict.ok/.warn/.err`。沿用现有配色变量（`--err/--warn/--ok/--cyan/--line/--panel`）。

---

## 3. 探针契约（`server/probe-code-review-verify.mjs`，新建）

`node probe-code-review-verify.mjs [base] [cdp]`；默认 `http://127.0.0.1:8099`，第二参数有值时跑 UI 段（CDP，Edge 在 9333）。
必须**自带本地 stub 云端服务**（`node:http` 随机端口）：`POST /v1/chat/completions` 返回固定 OpenAI 形状 JSON，支持 `?fail=1` 返回 500、`?slow=1` 延时 3s。**不许真出网**。

| 段 | 断言（目标 ~70 条） |
|---|---|
| A 质询 | 无令牌 403 / 缺 code 400 / question 空 400 / code 超长 413 / SSE 顺序 meta→delta*→done / delta 拼起来非空且不含裸 JSON 围栏 / done 有 seconds / 带 history 两轮仍 200 |
| B 他人复审 | 无令牌 403 / 缺 code 400 / SSE 顺序 meta→delta*→(phase)→findings→compare→done / `findings.issues` 字段齐全 + 行号在 `1..lineCount` / `compare.verdict ∈ {consistent,differs,contradicts}` / `stats` 数与数组长度自洽（`matched=agree+conflicts`、`matched+onlySecond===second`、`matched+onlyPrimary===primary`）/ `sameModel` 为 boolean / `agree/onlyPrimary/onlySecond/conflicts` 是数组且项有 line / 指定 `model` 时 `modelFile` 匹配 / 不指定时不会挑 Phi-4-mini |
| C 云端校验 | GET 形状（8 字段）/ POST 无令牌 403 / http 非回环 400 INSECURE_URL / 非法 URL 400 / dryRun 不落盘（GET 不变）/ 保存 → hasKey true + keyMasked 形状 + host 正确 + ready 真 / 响应里**不含明文 key**（全文搜 Key 串）/ apiKey:"" 清除 → hasKey false |
| D 云端复审 | 未配置 400 CLOUD_NOT_READY / confirm 不匹配 409 CONFIRM_REQUIRED / 配置好 stub 后 200 SSE：meta.provider=cloud + host + sentChars>0 + redactions>0（代码里塞 `sk-ABC…`、`user@example.com`、`C:\\Users\\bob\\x.py`、`10.1.2.3`）/ delta 拼接 = stub 文本 / findings 解析出 issues / done 有 seconds / **请求体里发出去的代码已被脱敏**（stub 记录收到的 body，断言不含原 key/邮箱/路径）/ 上游 500 → 502 CLOUD_UPSTREAM / 上游慢 → 超时（设 `CLOUD_JOB_TIMEOUT_MS=5000` 不现实，改为断言 stub slow 时 502 或正常返回——**不做超时断言**，改为断言错误分支 message 非空） |
| E UI（有 cdp 参数才跑） | 代码面板里 `#cwChallenge/#cwCross/#cwCrossModel/#cwCloud` 存在；`#cwCrossModel` 无 Phi 选项；点 `#cwChallenge` 展开 `#cwChallengeBox`；设置 → 代码 有 `#cloudBase/#cloudModel/#cloudKey/#cloudSave`；云端 ready 时点 `#cwCloud` 弹 `#cloudConfirmModal` 且 `#cloudConfirmHost` 含 host；点取消不发请求；配置指向 stub 时点确认 → `#cwReviewState`/meta 出现「云端」字样且 `#cwIssues` 卡片渲染 |

收尾：`finally` 里恢复配置（关掉 enabled、清空 key）、关 stub、UI 段导航回 base。退出码 `fail>0 → 1`。

**全量驱动**：`server/docs/run-full.ps1` 追加一条 `@{n='probe-code-review-verify'; a=@($base,$cdp); t=900}`（62 → **63 条**），断言口径 1137 → **~1207**（以探针实数上报为准）。

---

## 4. 验收与交付（Lead 负责）

1. 三份改动落地后：`node --check server/app.mjs` 通过；dev 8099 真跑新探针全绿；回归 `probe-code-review-stream`（`PROBE_SKIP_SWITCH=1` 45/45）、`probe-code-panel-v2`、`probe-code-workspace`、`probe-code-panel`。
2. 全量 63 条（`server/docs/run-full.ps1`，06:00 前跑完即可）。
3. 重打包 `build-portable.ps1` → `make-zip.ps1`（v1.8.0，预期 258.6MB/3447 文件、zip ~121.96MB/3947 条目），断言交付包里**没有** `data/cloud-review.json`。
4. 8099 切回发布包实例 v1.8.0；发布包冒烟 `probe-version` 14/14 + 新探针（无 cdp，云端段用 stub）。
5. 文档：`README.md` / `交接文档.md` / `新会话启动词.md` / `DeveloperRealtimeLog.md`（第六十五节）/ `technique/02-接口.md` / `technique/07-坑与约定.md`。
6. `git commit`（源码 + 文档；dist/zip 不入库）。

---

## 5. 三方分工（写作用域互不重叠）

| 角色 | 文件 | 任务 |
|---|---|---|
| backend-api | `server/app.mjs`、`server/package.json`、`server/localai.mjs` | §1 全部接口 + 版本 1.8.0 |
| frontend-ui | `server/app.html` | §2 全部 UI |
| probe-verify | `server/probe-code-review-verify.mjs`、`server/docs/run-full.ps1` | §3 探针 + 驱动追加 |
| lead | 文档、`server/make-zip.ps1`（data 排除断言）、打包、全量、git | §4 |

**协作纪律**
- 只改自己作用域内的文件；发现契约有洞 → 立刻 `send_message` 给 lead，**不要自己改契约里的字段名**。
- 8099 上同一时刻只跑一个探针/界面流程；`codeJob` 是串行锁，两个审查同时发会排队（不是 bug）。
- **别用 Phi-4-mini** 做任何审查模型（Vulkan 上偶发原生层卡死，只能重启进程）。
- 打包前必须先杀 `QingYaoTP AILauncher` 进程 + 它的 `runtime\\node.exe` 子进程（否则 dist 文件被锁）。
- 日志只追加不回改；别整份贴大输出，证据落文件给路径。
