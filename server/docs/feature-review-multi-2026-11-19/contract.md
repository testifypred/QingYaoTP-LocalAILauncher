# v1.10.0 契约：多文件 / 整工作区一起审查（code-review-multi）

> 本轮唯一功能。**先读这一份，再动代码。** 目标：代码面板能一次审查多个（或整个工作区 `code/` 下）文件，
> 逐文件出结论 + 跨文件总览，结论可导出 `.multi.review.md`；探针可确定性复算。
>
> 版本 v1.10.0（feature）。硬约束见 `D:\\LocalModels\\新会话启动词.md`「硬约束」一节：
> 审查五流程共用 `codeJobLocked` 一把锁、探针就是 CI、日志只追加、新增 import 必须补 `build-portable.ps1` 两处清单。

## 0. 文件分工（互不越界）

| 谁 | 写哪些文件 |
|---|---|
| backend | `server/code-review-multi.mjs`（新建，纯函数）、`server/app.mjs`（路由 + 接线 + APP_VERSION） |
| frontend | `server/app.html`（只改这一个） |
| probe | `server/probe-code-review-multi.mjs`（新建）、`server/docs/run-full.ps1`（登记 1 行） |
| lead | `server/package.json`、`server/localai.mjs`、打包/验证/文档 |

## 1. 纯函数模块 `server/code-review-multi.mjs`

零依赖（不 import fs / node-llama-cpp / 任何本地模块），**只导出纯函数与常量**，便于探针直接 import 做确定性断言。
全部函数不得抛异常（除明显非法输入返回空结构）；字符串一律 `String(x ?? "")` 归一。

导出常量：
```js
export const MULTI_MAX_FILES = 8;        // 一次最多审查 8 个文件（第 9 个起 skipped: limit）
export const MULTI_PER_FILE_CHARS = 6000; // 单文件超过 6000 字符不直接审（skipped: too_large），提示单独审查
export const MULTI_TOTAL_CHARS = 36000;   // 可审文件累计字符上限（按顺序，超出的 skipped: budget）
export const MULTI_MAX_INPUT_FILES = 40;  // 请求里最多接受 40 个路径（超过由 API 层 400，模块不管）
```

### 1.1 `normalizeMultiPaths(raw)`
入参：`raw` 任意（期望数组，元素 string 或 `{path}`）。返回 `{ paths: string[], dropped: [{path, reason}] }`。
- 归一：`String` → trim → `\\` 换 `/` → 去开头 `./` 与 `/` → 折叠连续 `/` → 去尾部 `/`。
- 丢弃 reason：`"invalid"`（空、含 `\0`、含 `..` 段、盘符/绝对路径如 `C:`、以 `/` 开头）、`"duplicate"`（大小写不敏感去重，保留第一次）。
- 保持原顺序；非数组/空数组 → `{paths: [], dropped: []}`。

### 1.2 `isUnderCodeDir(p)`
`p` 归一后必须以 `code/` 开头且长度 > 5；返回 boolean。纯字符串判断（真正越界由 API 层 `wsResolve` 兜底）。

### 1.3 `buildMultiPlan(entries, opts)`
`entries`: `[{ path, content, error? }]`（content 已由调用方读好；读失败传 `content:"" , error:"..."`）。
`opts`: `{ maxFiles=MULTI_MAX_FILES, perFileChars=MULTI_PER_FILE_CHARS, totalChars=MULTI_TOTAL_CHARS }`。
返回：
```js
{
  files: [{ path, name, lang, chars, lines, ok, reason? }], // 顺序 = entries 顺序，name=basename，lang 由扩展名映射
  reviewable: [path, ...],   // files 里 ok:true 的 path，顺序同上
  skipped: [{ path, reason, chars }],
  totals: { input, reviewable, skipped, chars, lines }
}
```
- `lang` 映射（小写扩展名）：js/mjs/cjs→javascript、ts→typescript、py→python、html→html、css→css、json→json、
  md→markdown、ps1→powershell、java→java、cs→csharp、cpp/cc/cxx/h→cpp、c→c、go→go、rs→rust、sh→shell、sql→sql、
  yml/yaml→yaml、txt/其他→text。
- `errors` 优先：有 `error` → skipped reason `"unreadable"`（ok:false）。
- 空内容（trim 后为空）→ `"empty"`；`chars > perFileChars` → `"too_large"`；
  累计（只累计 ok 的）超过 totalChars → `"budget"`；reviewable 数量达到 maxFiles 之后 → `"limit"`。
- `totals.chars`/`lines` 只统计 ok 的（即真正会送审的）。

### 1.4 `multiReviewPrompt({ index, total, file, lang, intent, lineCount })`
字符串。在第一行加 `【第 i/N 个文件】`，其余沿用单文件审查的 `【用户意图】【文件】【语言】【代码行数】+ 围栏` 结构
（围栏用三个反引号常量 `FENCE`，与 app.mjs 的 `codeJobPrompt` 同款）。`lang` 为空时围栏不带语言标记。

### 1.5 `issueLineTexts(issues, code)`
`issues` 数组、`code` 源码。返回新数组（不改入参）：每条加 `lineText` = 该行 trim 后截断 80 字符（空行 `""`）；
行号先 clamp 到 `[1, lines.length]`。用于前端卡片显示问题所在行原文（多文件时前端没有代码，靠服务端带回来）。

### 1.6 `normalizeCrossFindings(list, knownPaths, opts)`
`list` 任意；`knownPaths` 为本次送审的 path 数组；`opts={maxFindings=12}`。
返回 `{ findings: [{file, line, endLine, severity, title, detail, fix}], dropped: number }`。
- `file` 匹配：先全等，再按 basename 唯一匹配（多个同名 → 丢弃）；匹配不到 → 丢弃计数 +1，不抛错。
- line/endLine：`Math.max(1, Math.round(Number(x)||1))`，endLine ≥ line（**不做上行 clamp**，服务端会按各文件行数再 clamp）。
- severity 只认 error/warn/info，否则 `"info"`；title ≤120（空 → `"问题"`）；detail/fix ≤800。
- 截断到 maxFindings。

### 1.7 `multiCrossPrompt({ intent, files })`
`files` = `[{ path, name, lines, issues:[{line, severity, title}] }]`。返回字符串：要求只输出一个 JSON 对象
`{"summary":"一句话跨文件总览","findings":[{"file":"code/a.js","line":3,"endLine":3,"severity":"error","title":"...","detail":"...","fix":"..."}]}`；
写明 file 必须是给定路径之一、line 必须落在该文件行数内、没有跨文件问题就 findings: []。
（提示词里只放摘要与问题标题，不放代码正文，节省上下文。）

### 1.8 `aggregateMultiReview(files)`
`files` = `[{ path, issues: [...] }]`。返回：
```js
{ files: N, issues: N, clean: N, bySeverity: { error, warn, info } }
```
（clean = 0 问题的文件数；issues 统计所有文件 issues 总数。用于 done 事件与导出总览。）

### 1.9 `buildMultiReviewMarkdown(payload)`
`payload`：`{ meta:{ intent, at, model, skipped:[{path,reason}] }, files:[{path,name,lang,lines,summary,issues,seconds,parsed}], cross:{summary,findings}|null }`。
返回 Markdown 字符串，固定结构（标题文字逐字，探针会断言）：
```
# 多文件审查 · N 个文件
（空行）
- **审查时间**：...（用 meta.at 的 ISO 本地时间；at 非法用「未知」）
- **模型**：...
- **用户意图**：...
- **计划**：审查 N 个 / 跳过 M 个
（空行）
## 一、总览
（aggregateMultiReview 的计数：文件 / 问题 / 无问题文件 / error·warn·info）
（空行）
## 二、逐文件结论
### 1. code/a.js（12 行 · 2 个问题）
摘要（或「（没有摘要）」）
- 行 3（error）标题 —— detail（建议：fix）   ← 每条问题一行；无问题写「（没有发现问题）」
（空行）
## 三、跨文件问题
（cross 为空/无 findings：写「（没有生成跨文件总览）」或「（没有发现跨文件问题）」）
- code/a.js 行 3（error）标题 —— detail
（空行）
## 四、跳过的文件
- code/big.js —— too_large（6001 字符）   ← reason 用固定说明表：too_large/empty/unreadable/budget/limit/duplicate/invalid
（没有跳过写「（没有跳过的文件）」）
（空行）
## 说明
- 本文件由「审查面板 → 导出多文件复审」生成，只含结论与问题描述，**不含代码正文**。
```
- 单文件 summary 里如果模型输出多行，保留原文（不截断 300 字也行，截 1000 字）。
- 所有 `|` 之类无需特别转义（不用表格）。

## 2. app.mjs 接线

### 2.1 import
在文件顶部 import 区加：
```js
import { buildMultiPlan, normalizeMultiPaths, isUnderCodeDir, multiReviewPrompt, issueLineTexts, normalizeCrossFindings, multiCrossPrompt, aggregateMultiReview, buildMultiReviewMarkdown, MULTI_MAX_INPUT_FILES } from "./code-review-multi.mjs";
```

### 2.2 `POST /api/code/review/multi/plan`（**不需要模型**，令牌必需）
- 无/错令牌 → 403（沿用现有文案）。
- body `{ files: [...] }`；`files` 不是数组或归一后为空 → 400 `"缺少 files（只能审查 code/ 下的文件）"`。
- 归一后 > MULTI_MAX_INPUT_FILES → 400 `"一次最多提交 40 个文件"`。
- 任一 `!isUnderCodeDir(path)` → 400 `"只能审查 code/ 下的文件：" + path`。
- 逐个读：`wsRead(path)`；失败 → entry `{path, content:"", error: String(e.message)}`。
- 200 `{ ok:true, plan }`（plan 见 §1.3；`dropped` 也放进 plan 顶层 `plan.dropped`，供前端提示非法路径）。

### 2.3 `POST /api/code/review/multi`（SSE，令牌必需）
校验顺序（全部在开 SSE 之前，返回 JSON 错误）：
1. 令牌 → 403；
2. body 解析失败 → 400/413（同现有写法）；
3. files 归一后空 → 400；> 40 → 400；不在 code/ → 400；
4. 读文件 + `buildMultiPlan`；若 `plan.reviewable.length === 0` → 400 `{ error:{message:"没有可审查的文件（空 / 过大 / 超限）：见 plan"}, plan }`。

然后 `codeJobLocked`（**必须**复用现有这把锁；`/api/load` 的 409 靠 `codeJob.busy`，不要另开变量）：
1. `pickCodeJobModel(body.model)`（切模型/409 规则全沿用）；
2. `openReviewContext()`（8192→4096→2048 回退，沿用现有函数）；
3. 发事件（顺序固定）：
   - `{type:"meta", model, modelFile, contextSize, switchedModel, startedAt, total}`
   - `{type:"plan", ...plan}`
   - 每个可审文件（index 从 1 开始）：
     - `{type:"file-start", index, total, path, name, lang, chars, lines}`
     - 第一阶段（开新 sequence）：`const seq = ctx.getSequence();` + `new LlamaChatSession({ contextSequence: seq, chatWrapper: state.wrapperNoThink ?? "auto", systemPrompt: CODE_REVIEW_THINK_SYSTEM })`；
       `promptWithMeta(multiReviewPrompt({...}), { maxTokens: thinkMax, temperature: 0.2, signal, onResponseChunk: c => c?.text && send({type:"delta", index, path, text:c.text}) })`；
       **每个文件用独立 AbortController + 超时**（`MULTI_FILE_TIMEOUT_MS = Math.max(60000, Math.min(CODE_JOB_TIMEOUT_MS, 240000))`）；
     - 第二阶段：同 context/session 追加 `【代码行数】...把上面这次审查整理成 JSON`（沿用单文件那段 `CODE_REVIEW_JSON_SYSTEM.split("\\n").slice(2)` 的写法），
       `parseFindingsFromText(...)` → `snapIssuesToCodeLines(issues, code)` → `issueLineTexts(issues, code)`；
       发 `{type:"file-findings", index, total, path, name, summary, issues, parsed, lineCount, seconds}`；
     - `finally { await seq.dispose().catch(()=>{}); }`（**必须释放**，否则多文件累计吃 KV）；
     - 客户端断开（`res.on("close")`）→ 抛 499 中断，后续不再跑；单个文件失败 → 不发 error 杀全局，而是
       `{type:"file-error", index, path, message}` 后继续下一个文件（跨文件阶段跳过该文件）。
   - 跨文件阶段（仅当 `plan.reviewable.length >= 2` 且 body.includeCross !== false）：
     `{type:"cross-start"}`；新 sequence + 单次 prompt（`multiCrossPrompt`，systemPrompt 用模块导出的多行 JSON 约束文本，
     maxTokens 700、temperature 0.1、超时 `Math.min(120000, CODE_JOB_TIMEOUT_MS)`）；用`extractJsonObject` 取对象，
     `normalizeCrossFindings(obj.findings, plan.reviewable)` 再按各文件行数 clamp；发
     `{type:"cross", summary, findings, parsed}`。失败发 `{type:"cross", summary:"", findings:[], parsed:false, error: msg}`，不影响前面结果。
     只有 1 个文件时发 `{type:"cross", summary:"", findings:[], parsed:false, skipped:true}`。
   - `{type:"done", seconds, model, files: plan.reviewable.length, issues: 总数, skipped: plan.skipped.length, stats: aggregateMultiReview(...)}`
   - `res.end()`（**done 之后立刻 end**，别让 dispose 卡住界面；沿用单文件 v1.7.1 的做法）
4. 收尾 `ctx.dispose()`；catch 里 `clientGone` → 只记日志；未开 SSE 前的错误 → JSON；已开 SSE → `{type:"error", message}`。

日志（沿用 `log()`）：`代码审查(多文件) N 个文件 问题 X 跳过 Y 上下文 S 秒数s`。

### 2.4 导出 kind=multi
`handleCodeReviewExport`：`kind` 允许 `"challenge" | "review" | "multi"`；multi → `buildMultiReviewMarkdown(body)`。
文件名：`exportSlug(meta.file || "workspace") + "-" + exportStamp(at) + ".multi.review.md"`（即扩展名是 `.multi.review.md`）。
其余（令牌 403 / 500 文案）不变。

### 2.5 路由注册（`app.mjs` 约 8856 行一带）
```js
if (req.method === "POST" && url === "/api/code/review/multi/plan") return handleCodeReviewMultiPlan(req, res);
if (req.method === "POST" && url === "/api/code/review/multi") return handleCodeReviewMultiStream(req, res);
```
（放在 `/api/code/review/stream` 后面即可；`/api/code/review/multi/plan` 要在 `/api/code/review/stream` 之前/后都行——现有匹配全是全等，不冲突。）

### 2.6 版本
`APP_VERSION` 改 `"1.10.0"`（另两处 package.json / localai.mjs 由 lead 改）。

## 3. app.html 前端契约

### 3.1 文件列表多选
- `#cwList` 头部（`#cwRefresh` 附近）加：
  ```html
  <label class="cwSelAll" title="全选/取消全选"><input type="checkbox" id="cwSelAll">全选</label>
  <span id="cwSelCount" class="hintText">已选 0</span>
  <button id="cwReviewSel" class="ghost" title="把勾选的文件一起审查（最多 8 个）">审查选中</button>
  <button id="cwReviewWs" class="ghost" title="把 code/ 下所有文件一起审查">审查工作区</button>
  ```
- 每个 `.cwItem` 前面加 `<input type="checkbox" class="cwSel" data-path="...">`；勾选 `stopPropagation`，点条目名称仍是打开文件。
- `let cwSelPaths = new Set();` `cwLoadList()` 重新渲染后保留仍然存在的勾选（`e.path`），并调 `cwRenderSelState()`：
  `#cwSelCount` 文案 `已选 N`，`#cwSelAll` 的 checked/indeterminate 正确。
- 「审查工作区」= 当前 `#cwList` 里的全部文件路径（`cwFilesCache`）。

### 3.2 结果区（`#cwReviewPanel` 内、`#cwReviewBody` 之后或之前都行，建议 `#cwReviewSummary` 之前）
```html
<div id="cwMultiWrap" hidden>
  <div id="cwMultiState" class="cwMultiState"></div>
  <div id="cwMultiPlan" class="cwMultiPlan"></div>
  <div id="cwMultiFiles" class="cwMultiFiles"></div>
  <div id="cwMultiCross" class="cwMultiCross"></div>
</div>
```
- 每个文件一张卡 `div.cwMultiFile[data-path]`：头 `div.cwMultiFileHead`（文件名 + `行 N · M 个问题`），点头部 → `cwOpenFile(path)` 并在打开后对该文件 issues 调 `cwApplyIssueHighlights`；卡内 `details.cwThink`（审查思路，delta 累积）+ `div.cwMultiIssues`（问题卡片：复用 `.cwIssue` 的视觉，但点击 = 先开文件再 `cwGotoIssue`；**不做「一键更改」**，多文件不改代码）。
- `#cwMultiCross`：`div.cwMultiCrossSummary`（renderMarkdown）+ 每条跨文件问题 `div.cwCrossFinding[data-path][data-line]`，点击 → 打开该文件 + 跳行。
- 单文件审查/重置（`cwResetReviewView`）要 `#cwMultiWrap` hidden 并清空内容；多文件审查开始时也先 reset。

### 3.3 运行流程 `cwReviewMulti(scope)`（scope='selection'|'workspace'）
- 先 `if (cwCurrent && cwDirty) await cwSaveFile(true)`（未保存的当前文件先落盘，否则服务端读到旧内容）。
- 路径：selection → `[...cwSelPaths]`；workspace → `cwFilesCache.map(f=>f.path)`。空 → toast 提示。
- 与现有五项共用 `cwReviewBusy`/`cwReviewMode='multi'`/`cwAbortCtl`；`cwReviewStartTimer('multi', t0)`；
  `cwReviewPaint` 的 multi 分支显示「多文件审查中」+ 当前文件进度（`正在审查 2/3：code/a.js`）。
- SSE 用现有 `cwStreamSSE`（自动带令牌）：`/api/code/review/multi`，body `{ files, intent: cwIntentValue(), model: cwReviewModelEl?.value || undefined }`。
- 事件处理：
  - `meta` → `#cwReviewMeta` = 模型名（+已切换提示）。
  - `plan` → `cwMultiResult.plan = ev`，渲染 `#cwMultiPlan`（「将审查 N 个文件 · 跳过 M 个」+ 跳过原因前 3 条），建好每张文件卡骨架。
  - `file-start` → 当前卡标记 `.on`，状态行「正在审查 i/N：名字」。
  - `delta` → 追加到该文件卡的 `details pre`（可只保留最近 4000 字）。
  - `file-findings` → 该卡填充摘要 + 问题卡；`cwMultiResult.files[i]` 存 `{path,name,lang,lines,summary,issues,parsed,seconds}`。
  - `file-error` → 该卡显示红字错误。
  - `cross-start` → 状态行「正在做跨文件总览…」。
  - `cross` → 渲染总览与跨文件问题；`cwMultiResult.cross = ev`。
  - `done` → `#cwReviewState` = `完成：N 个文件 · X 个问题 · 跳过 M · 秒`（kind 'ok'），开 `#cwExportMulti`。
  - `error` → 状态红字 + toast；保留已完成文件的结果。
- 停止：`cwStopReview()` 的 multi 分支 → 文案「已停止（多文件审查已中断）」，保留已完成结果。

### 3.4 导出按钮
导出动作行加 `<button id="cwExportMulti" class="ghost" type="button" title="导出 .multi.review.md：总览 + 逐文件结论 + 跨文件问题 + 跳过清单">导出多文件复审</button>`。
- 只有 `cwMultiResult` 有文件结果时 enable；`cwRefreshActionButtons` 里统一 busy → disabled。
- 点击：`cwPostJson('/api/code/review/export', { kind:'multi', meta:{file:'workspace', intent, at: cwMultiResult.at, model}, files: cwMultiResult.files, cross: cwMultiResult.cross })`
  → `cwDownloadText(j.filename, j.markdown)` → `#cwExportState` 显示「已导出 ...」+ toast。

### 3.5 不破坏的既有契约
- 现有 id 一个都不能改名（`cwReview`、`cwIssues`、`cwExportReview` 等全被探针守着）。
- 单文件审查/纠正/质询/复审/云端 流程与文案不变；多文件不参与质询/三方对照/云端（按钮在 multi 结果下仍按原逻辑）。
- `cwRefreshActionButtons` 里加 `cwReviewSel / cwReviewWs / cwExportMulti` 的 busy 禁用。
- 新增 CSS 走现有风格变量；不要动 `header::before` 扫光。

## 4. 探针 `server/probe-code-review-multi.mjs`
```
node probe-code-review-multi.mjs [base] [cdp] [shotDir]
```
分段（不需要模型的分段必须能在**未加载模型**时全绿）：
- **A. 纯函数（import 模块，确定性）**：normalizeMultiPaths / isUnderCodeDir / buildMultiPlan（顺序、四类 reason、totals）/
  multiReviewPrompt / issueLineTexts / normalizeCrossFindings（全等、basename、未知丢弃、severity、截断）/ multiCrossPrompt /
  aggregateMultiReview / buildMultiReviewMarkdown（标题与四节、跳过说明表、空 cross 兜底）。
- **B. API plan + 校验（不需要模型）**：403 无令牌；400 缺 files；400 超过 40；400 非 code/ 路径；400 穿越；
  200 用临时夹具（`code/probe-multi-*.js` 等，探针自己建、收尾删）返回 plan 计数与跳过原因（empty / too_large / limit）；
  无模型时 `/api/code/review/multi` 的**参数错误仍先于模型校验**（400）。
- **C. 真模型 SSE（模型没加载就 skip 并 exit 0）**：2 个临时小文件（各 ~10 行、埋一个明显的 bug），
  断言事件顺序 meta→plan→file-start→delta→file-findings→...→cross→done、每个 file-findings 的行号在各自行数内、
  issues 是数组、done.stats 自洽；跑的过程中并发 `POST /api/load` 期望 **409**（锁复用）；跑完服务仍 /api/state 200。
- **D. 导出 kind=multi（不需要模型）**：200 + `filename` 以 `.multi.review.md` 结尾 + markdown 含四节标题；
  403 无令牌；给一个含跳过项的 payload，断言「## 四、跳过的文件」有内容。
- **E. UI（需要 cdp + 模型；否则 skip）**：`#cwSelAll/#cwReviewSel/#cwReviewWs/#cwExportMulti` 存在；
  勾 2 个文件 → `#cwSelCount` 文案正确；点「审查选中」→ 等 `#cwMultiFiles .cwMultiFile` 数量 = 2、
  `#cwMultiState` 含「完成」；点文件卡头部 → 编辑器打开该文件（`#cwFile` 文案）；导出按钮点击后 `#cwExportState` 含「已导出」。
  收尾：删临时文件、`reload` 页面、还原 `localStorage['localai.lastSession']`（硬约束）。

输出 `RESULT x/y`，失败 exit 1。**探针造的文件名统一 `probe-multi-*`，跑前先删残留。**

登记：`server/docs/run-full.ps1` 的 `$probes` 里加一行（放在 `probe-code-review-export` 之后）：
```powershell
  # v1.10.0：多文件 / 整工作区一起审查（纯函数 + 真模型 SSE + 导出；带 cdp 时含 UI 段）
  @{n='probe-code-review-multi'; a=@($base,$cdp,$shots); t=720},
```
（全量 65 → **66 条**；断言口径在原 1318 基础上加本条探针的断言数，跑完以实测为准。）

## 5. 验收口径（lead 跑）
1. `node --check` 三个改动的 .mjs；`parsers` 验 `run-full.ps1`（PS 5.1）。
2. 杀启动器 → `node app.mjs` 起 dev（8099）→ 手工 curl 两条接口冒烟。
3. 目标探针全绿：multi 新探针、probe-code-panel-v2、probe-code-review-stream、probe-code-review-export、probe-code-review-verify、probe-version。
4. 全量 66 条整跑（机器保持唤醒；跑完恢复会话备份）。
5. `build-portable.ps1`（补 `code-review-multi.mjs` 两处清单）→ `make-zip.ps1` → 发布包实例冒烟。
