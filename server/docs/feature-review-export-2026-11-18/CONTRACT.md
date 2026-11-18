# v1.9.0 契约：审查结论导出（.challenge.md / .review.md）+ 三方对照

> 2026-11-19 · QingYaoTP AILauncher v1.9.0（v1.8.1 之后的第一批功能）
> 目标：把「质询 / 他人复审 / 云端复审」的结论从面板里带走——可导出 Markdown、可存进会话、可把三方放一张表里比对。

## 1. 接口

### 1.1 `POST /api/code/review/export`

令牌：**必需** `x-local-token`（无令牌 403）。

请求体：

```jsonc
{
  "kind": "challenge" | "review",     // 必填，其它值 400
  "meta": {
    "file": "demo.js", "lang": "javascript", "lineCount": 50,
    "intent": "用户意图（截断 200）", "at": 1763520000000,
    "model": "本地审查模型（可选）", "crossModel": "第二审查员（可选）",
    "cloudHost": "api.deepseek.com（可选）", "cloudModel": "deepseek-flash（可选）"
  },
  "primary": { "summary": "本地结论", "issues": [ /* 问题，形状同 review/stream findings */ ] },
  "challenge": { "history": [ { "question": "...", "answer": "..." } ] },   // 最多取最近 20 轮
  "cross": {                                                              // 可选
    "model": "...", "sameModel": false, "summary": "...", "issues": [],
    "verdict": "consistent|differs|contradicts", "stats": { /* compareReviewFindings.stats */ },
    "agree": [], "onlyPrimary": [], "onlySecond": [], "conflicts": []
  },
  "cloud": { "host": "...", "model": "...", "summary": "...", "issues": [] }, // 可选
  "compare3": { "verdict": "...", "stats": { }, "rows": [ ] }               // 可选，见 §1.2
}
```

响应 200：

```jsonc
{ "ok": true, "kind": "review", "filename": "demo-20261119-0145.review.md",
  "bytes": 2056, "markdown": "# 审查结论 · demo.js\n...", "at": 1763520000000 }
```

- 文件名：`<slug>-<YYYYMMDD-HHmm>.<kind>.md`；slug 取自 meta.file 的 basename（只留 `[A-Za-z0-9._-]`，空则 `unnamed`）。
- 纯计算、**不落盘**；前端拿到 markdown 后用 Blob 下载（或存进会话）。
- 导出文本做**密钥级脱敏**：`sk-…` → `<API_KEY>`（结论可分享；不含代码正文）。
- 失败：400 kind 非法 / 403 无令牌 / 500 生成失败。

### 1.2 `POST /api/code/review/compare3`

令牌：**必需**（无令牌 403）。请求体：

```jsonc
{ "lineCount": 50,
  "local": { "issues": [] }, "cross": { "issues": [] }, "cloud": { "issues": [] } }
```

响应 200：

```jsonc
{ "ok": true,
  "verdict": "consistent | majority | differs | contradicts",
  "stats": {
    "rows": 5, "all3": 1, "two": 1, "one": 3, "conflict": 1,
    "bySource": { "local": 3, "cross": 2, "cloud": 3 },
    "pair": { "lc": 1, "lu": 1, "cu": 2 },
    "judgments": { "all3": 0, "pair2": 1, "single": 3, "conflict2": 0, "conflict3": 1 }
  },
  "rows": [
    { "line": 3, "endLine": 4, "severity": "error",
      "present": ["local","cross","cloud"],
      "local": { ... }, "cross": { ... }, "cloud": { ... },
      "judgment": "all3 | pair2 | single | conflict3 | conflict2" }
  ] }
```

## 2. 纯函数口径（改算法必须同步改探针自洽断言）

### 2.1 `compareThreeWayFindings(localIssues, crossIssues, cloudIssues, lineCount)`

1. 三份问题各自 `normalizeReviewIssues`（行号 clamp 1..lineCount；lineCount 无效时取三份最大行号）。
2. **并查集聚类**：不同来源的两条问题满足「区间相交或行距 ≤2」即归到同一行；同来源内部不合并（一份审查自己报的两条不能互相吃掉）。传递闭包（A~B、B~C 也归一行）。
3. 每行：
   - `line/endLine` = 组内最小 line / 最大 endLine；`severity` = 组内最高 rank（error>warn>info）。
   - `present` = 出现过的来源；`local/cross/cloud` = 该来源在此行的第一条问题（没有则 null）。
   - `judgment`：三源且严重度 rank 全同 → `all3`；三源但不同 → `conflict3`；两源同 → `pair2`；两源不同 → `conflict2`；单源 → `single`。
4. 统计恒等式（探针 B10–B13 守着）：
   - `rows = all3 + two + one`
   - `all3 = judgments.all3 + judgments.conflict3`
   - `two = judgments.pair2 + judgments.conflict2`
   - `conflict = judgments.conflict2 + judgments.conflict3`
   - `one = judgments.single`；`bySource.* ≤ 对应来源条数`；`pair.lc ≤ min(local,cross)` 等。
5. verdict 优先级：`contradicts`（有矛盾）> `differs`（有仅一方提出的）> `majority`（两方一致、三方不全同）> `consistent`。三份都空 = `consistent`。

### 2.2 `buildChallengeMarkdown(payload)` / `buildReviewMarkdown(payload)`

- 纯字符串拼接，不读文件、不调模型；两个导出共用 `mdMetaLines / mdIssueList / num0 / redactExportText`。
- `.review.md` 固定六节：一、本地审查 ｜ 二、他人复审（含「两栏对照」四类：一致 / 仅原审查提出 / 仅他人复审提出 / 互相矛盾）｜ 三、云端复审 ｜ 四、三方对照（表格：行 / 原审查 / 他人复审 / 云端复审 / 判定）｜ 五、质询记录 ｜ 说明。
- `.challenge.md`：标题 + meta + 原审查结论 + 质询（N 轮，每轮「质疑 / 回答」）+ 说明。
- 缺失部分给确定文案：`（没有运行他人复审）` / `（没有运行云端复审）` / `还没有生成三方对照` / `（本地审查没有发现问题）`。
- 判定中文映射：consistent=一致、majority=两方一致、differs=仅一方提出、contradicts=互相矛盾；judgment 中文：all3=三方一致、pair2=两方一致、single=仅一方提出、conflict3=三方矛盾、conflict2=两方矛盾。

## 3. 前端（app.html）

### 3.1 DOM id（探针守着，别改）

| id | 作用 |
|---|---|
| `cwCompare3` | 三方对照按钮（至少跑过两项才有效） |
| `cwCompare3Panel` / `cwCompare3Verdict` / `cwCompare3Table` | 三方表容器 / 判定徽标 / 表格 |
| `cwExportReview` | 导出 .review.md |
| `cwExportChallenge` | 导出 .challenge.md |
| `cwStoreExport` | 存进会话（往当前会话追加一条助手消息） |
| `cwExportState` | 最近一次导出/存会话的状态（`已导出 <文件名>（N 字节）` / `已存进会话：<文件名>`） |

### 3.2 状态与口径

- 每跑完一种模式存一份快照：`cwSnapshotLocal / cwSnapshotCross / cwSnapshotCloud`，`sig = cwCodeSig()`（文件路径 + 编辑器长度 + 简易哈希）。
- **改过代码后旧快照不参与导出/对照**（`cwTakeSnap` 过滤），避免把旧结论和当前代码混在一起。
- 行数取 `max(编辑器行数, 三份快照最大行号)`（`cwLineCountForExport`）——否则切到短文件时后端 clamp 会把所有行号压成 1、所有结论糊成一行。
- 「存进会话」：`transcript.push({ role:'assistant', content:<markdown>, ctx:<短摘要>, exportFile, t })` → 落盘 → 在当前会话末尾渲染成一条消息；`ctx` 是短串，避免以后整份 Markdown 进模型上下文。
- 导出/三方对照/存会话都只在 `!cwReviewBusy` 时可点（`cwRefreshActionButtons`）。

## 4. 探针契约

- 新探针：`server/probe-code-review-export.mjs`（**66 条**，不需要加载模型；无 CDP 时 E 段 skip）。
  - A 令牌/参数 5 条；B compare3 口径 23 条（含 4 条恒等式）；C .challenge.md 10 条；D .review.md 13 条；E UI 15 条。
  - E 段会自建临时会话 `probe-export-<stamp>`，测完 DELETE；不写用户真实会话。
- 全量驱动：`server/docs/run-full.ps1` 63 → **64 条**；断言口径 1224 → **1290**。
- 真实上游协议另有一条**手动/发版前**冒烟 `server/probe-cloud-upstream-real.mjs`（20 条，配置未就绪即 SKIP），**不进** run-full（依赖外网+付费 Key、非确定性）。

## 5. 文件清单（本轮写作用域）

- `server/app.mjs`：`compareThreeWayFindings` / `exportSlug` / `exportStamp` / `redactExportText` / `mdIssueList` / `mdMetaLines` / `buildChallengeMarkdown` / `buildReviewMarkdown` / `handleCodeReviewExport` / `handleCodeReviewCompare3` + 两条路由。
- `server/app.html`：按钮/面板/CSS、快照钩子、导出/存会话/三方对照函数与绑定。
- `server/probe-code-review-export.mjs`（新）、`server/docs/run-full.ps1`（+1 条）。
- 证据：`server/docs/feature-review-export-2026-11-18/`。

## 6. 边界（刻意不做）

- 导出**不落盘**到工作区（用户自己下载/存会话，避免默默写文件）。
- 导出**不含代码正文**（安全 & 体积）；代码以工作区文件为准。
- 三方对照不做「自动重跑三份结论」——只对照**已经跑出来**的快照，避免误触发模型任务与费用。
