# 功能契约：代码工作区（Agent 模式代码接管）+ 模型审查

> 2026-11-07 第十一轮。Lead 定契约，backend / frontend / prober 三方并行实现。
> 契约改动必须 Lead 拍板；实现与契约不一致时以契约为准，确有更好做法先在报告里说明。

## 一、目标（用户原话）

> 在 Agent 模式下输出的所有代码都要转到代码模块输出，并以代码工作区的形式（类似 VS Code）输出。
> 旁边加上代码补全的模型调用按钮，按下后可以开始结合用户意图审查代码是否合理。

落地为三件事：
1. **Agent 模式自动接管代码**：每轮助手回复结束后，把其中的围栏代码块自动收录进「代码工作区」（服务端 `code/` 目录），聊天里留一条可点击的收录提示。
2. **VS Code 式代码工作区**：左侧文件列表、顶部标签页、CodeMirror 编辑器（行号/高亮）、工具栏（新建/保存/删除/运行/模型审查）、底部运行输出、右侧审查面板。替换现有 `#codeModal` 里的简易 textarea 运行器（`#codeBtn` 入口不变）。
3. **模型审查按钮**：基于当前已加载模型，结合「用户意图 + 当前文件代码」给出一段结构化审查（结论/问题/建议/风险），显示在右侧面板。

## 二、存储（不新增文件 API）

代码文件 = 工作区根目录下的 `code/` 子目录，复用既有接口：

| 用途 | 接口 |
|---|---|
| 列表 | `GET /api/workspace/list?dir=code` |
| 读 | `GET /api/workspace/read?path=code/xxx.js` |
| 存 | `POST /api/workspace/save` `{path:"code/xxx.js", content}` |
| 删 | `POST /api/workspace/delete` `{path:"code/xxx.js"}` |
| 建目录（内部） | `POST /api/workspace/mkdir` `{path:"code"}` |

路径一律用正斜杠、相对工作区根，例如 `code/hello.py`。

## 三、新增后端接口（app.mjs）

### 3.1 `POST /api/code/capture`

请求：`{ files: [ { name: string, content: string } ] }`（1–20 个）

规则：
- `files` 非数组或为空 → 400 `{error:{message:"缺少 files"}}`
- 单个 content 非字符串或空 → 400；单文件 > 200,000 字符 → 413；合计 > 400,000 字符 → 413
- `name` 只取 basename（剥掉 `/` 与 `\`，禁止 `..`），保留 `[A-Za-z0-9._\-]` 与中文；清洗后为空 → `snippet`；无扩展名 → 补 `.txt`
- 目标目录 `code/` 自动创建（mkdir recursive）
- 重名不覆盖：`a.js` → `a-2.js` → `a-3.js`
- 以 UTF-8 写盘

响应 200：`{ ok:true, dir:"code", saved:[{ name, path, bytes }] }`

### 3.2 `POST /api/code/review`

请求：`{ code: string, lang?: string, file?: string, intent?: string, max_tokens?: number }`

规则：
- `code` 缺失/空 → 400；`code.length > 20000` → 413
- 未加载模型（`!state.model`）→ 409 `{error:{message:"先加载一个模型"}}`
- 正在生成（`activeChats > 0`）→ 409 `{error:{message:"模型正忙，稍后再试"}}`
- 用独立小上下文（`state.model.createContext({ contextSize: 8192 })`，用完 `dispose`），**不得动主会话的 sequence / KV 缓存**（照 `generateTitleWithModel()` 的写法）
- `chatWrapper: state.wrapperNoThink ?? "auto"`；`maxTokens = clamp(body.max_tokens ?? 900, 128, 1600)`；`temperature = 0.2`
- system prompt（逐字使用）：
  ```
  你是严格的代码审查员。结合用户给出的意图，判断这段代码的实现是否合理：先给结论，再列主要问题（按严重度排序，指出具体位置或片段），再给可执行的改进建议，最后说明风险与边界。用中文、Markdown，四节标题固定为：## 结论 / ## 主要问题 / ## 改进建议 / ## 风险与边界。不要复述整段代码，不要客套。
  ```
- user prompt 组装：
  ```
  【用户意图】<intent 或 "（未提供，按代码本身判断）"，截断 500 字>
  【文件】<file 或 "未命名">
  【语言】<lang 或 "未知">

  ```<lang>
  <code>
  ```
  ```
- 响应 200：`{ ok:true, review, seconds, model: state.file, maxTokens }`
- 其他异常 → 500 `{error:{message}}`；成功/失败都 `log()` 一行（"代码审查 文件 exit? Xs"）

### 3.3 版本号

`APP_VERSION` 由 `1.1.0` → `1.2.0`（本功能是可见能力升级；发布包/zip 命名随 Lead 收尾更新）。

## 四、前端契约（app.html）

保留：`#codeBtn`、`#codeModal`、`#codeClose`、Esc/点击遮罩关闭。
删除：`#codeLang`、`#codeEditor`、`#codeOutput`、`#codeRunBtn`、`#codeClearBtn`、`#codeMeta` 及其 JS（`openCodePanel/runCodePanel/saveCodeDraft` 整段重写）。

### 4.1 DOM

```html
<div id="codeModal" class="modal" hidden>
  <div class="modalBox cwBox">
    <div class="modalHead">
      <b>代码工作区</b><span id="cwDir" class="hintText">code/</span><span class="spacer"></span>
      <span id="cwStatus" class="hintText"></span>
      <button id="cwReviewToggle" class="ghost">审查面板</button>
      <button id="codeClose" class="ghost" title="关闭">✕</button>
    </div>
    <div class="cwBody">
      <div class="cwSide">
        <div class="cwToolbar">
          <input id="cwNewName" placeholder="new.js（回车新建）" spellcheck="false">
          <button id="cwNew" class="ghost">新建</button>
          <button id="cwRefresh" class="ghost">刷新</button>
        </div>
        <div id="cwList" class="cwList"></div>
        <div id="cwEmpty" class="cwEmpty" hidden>还没有代码。Agent 模式下的代码会自动收进这里。</div>
      </div>
      <div class="cwCenter">
        <div id="cwTabs" class="cwTabs"></div>
        <div class="cwBar">
          <span id="cwFile" class="hintText">未打开文件</span>
          <span class="spacer"></span>
          <button id="cwSave" class="ghost">保存</button>
          <button id="cwDelete" class="ghost danger">删除</button>
          <button id="cwRun">运行</button>
          <button id="cwReview">模型审查</button>
        </div>
        <textarea id="cwEditor"></textarea>
        <div id="cwOutput" class="codeOut" hidden></div>
      </div>
      <div id="cwReviewPanel" class="cwReview">
        <div class="cwReviewHead">模型审查 <span id="cwReviewMeta" class="hintText"></span></div>
        <textarea id="cwIntent" placeholder="用户意图（留空 = 自动取当前会话最后一条提问）"></textarea>
        <div id="cwReviewBody" class="cwReviewBody"></div>
      </div>
    </div>
  </div>
</div>
```

### 4.2 行为

- `#codeBtn` 打开：`codeModal.hidden=false`；载入语言表（`GET /api/run/langs` 用于扩展名映射与可运行判断）；`GET /api/workspace/list?dir=code` 填 `#cwList`（条目 `.cwItem[data-path]`，选中加 `.sel`，显示文件名 + 字节数）。空列表显示 `#cwEmpty`。
- 点文件 → 顶部标签 `.cwTab[data-path]`（有未保存改动加 `.dirty`）+ 读内容进 CodeMirror（`CodeMirror.fromTextArea(#cwEditor)`，mode 按扩展名：js/py/clike/go/rust，缺省 text/plain，`lineNumbers:true`）。
- 保存：`POST /api/workspace/save`；成功后清 dirty、刷新列表字节数；Ctrl+S 同效。
- 新建：取 `#cwNewName`（空则 `snippet.js`），`save` 空内容后打开；回车也可新建。
- 删除：确认后 `/api/workspace/delete`；关掉对应 tab。
- 运行：按扩展名映射 lang，`POST /api/run`（带 `x-local-token`），结果用既有 `renderRunResult()` 渲染到 `#cwOutput`；Ctrl+Enter 同效。
- 模型审查：`POST /api/code/review`，body `{ code: 当前编辑器内容, lang, file, intent: #cwIntent.value.trim() || 当前会话最后一条用户提问 }`；请求期间按钮置灰、显示"审查中…（已用 Xs）"计时；成功后 `#cwReviewBody.innerHTML = renderMarkdown(review)`，`#cwReviewMeta` 显示 `模型 · N.Ns`；409/400/500 用 toast + 面板内红字提示。若 #cwEditor 为空则 toast "先打开或写点代码"。
- 审查面板可折叠：`#cwReviewToggle` 切换 `.cwReview[hidden]`，状态存 localStorage `localai.cwReviewOpen`（默认开）。
- 状态记忆：`localai.cwOpen`（上次打开的文件路径）、`localai.cwIntent`（意图草稿）。打开时若文件还在则恢复。
- 老键 `localai.codeDraft` 不再使用（可忽略）。

### 4.3 Agent 模式自动收录（app.html，`send()` 的 finally 段）

位置：`send()` 里 `if (acc) { paint(); history.push(...) }` 之后、`transcript.push/latestEntry` 之后（约 4819–4840 行）。
条件：`toolChk.checked`（Agent 模式）且 `localai.codeCapture` 未被设为 false（默认 true）。
动作：
1. 从 `acc` 提取围栏代码块：`/```([^\n`]*)\n?([\s\S]*?)```/g`（与 renderMarkdown 同规则）。
2. 有代码块 → 依次生成 name：`<lang 或 code>-<HHmmss>-<n>.<ext>`（ext 映射：js/jsx→js, py→py, c→c, cpp→cpp, java→java, go→go, rust/rs→rs, html→html, css→css, json→json, sh/bash→sh, sql→sql, md→md, 其他→txt）。
3. 一次 `POST /api/code/capture` 提交全部；成功后在大气泡 `out` 之后插入 `.codeCaptured` 条：「Agent 模式：已收录 N 段代码到代码工作区」+ 按钮 `.codeCapturedOpen`（点击打开代码工作区并定位第一个文件）。失败只 toast，不抛异常、不影响对话。
4. 同时在每个围栏块的 `.codeHead` 里加一个 `<button class="codeToWs">工作区</button>`（点击打开该段代码所在的收录文件；需要能对应上——用 capture 返回顺序与块顺序一致的假设，或用块序号 data-idx）。

### 4.4 设置项

设置 → 生成 面板里 `#setCodeRun` 下面加一行：
`<label class="chk"><input type="checkbox" id="setCodeCapture" checked>Agent 模式代码自动收录到代码工作区</label>`
持久化 `localai.codeCapture`；启动时读回；与 `codeRunOn` 同样的写法（`saveSettings`/`loadSettings`）。

## 五、探针契约

### 5.1 `probe-code-panel.mjs`（重写，UI，headless Edge 9333）
≥12 条断言：入口存在 / 面板打开 / 列表加载（空态或条目）/ capture API 收录 2 个文件 / 刷新后列表出现 / 点文件出 tab + 编辑器有内容 / 保存后读回一致 / 新建 +1 / 运行 python 文件输出 42 与 exit 0 / 审查按钮与意图框存在 / 删除 -1 / Esc 关闭。结束时清理自己创建的文件。

### 5.2 `probe-code-workspace.mjs`（新增，纯 API）
- capture：正常 2 文件 → 200 且 saved 路径以 `code/` 开头；空 files → 400；>20 → 400；名字含 `../` → 落盘路径不含 `..`
- review：缺 code → 400；>20000 字符 → 413；无模型时 → 409（按 `/api/state.loaded` 条件断言）
- 清理：删掉自己建的文件。

## 六、硬约束（全员）

- 只改自己范围内的文件：backend=`server/app.mjs`；frontend=`server/app.html`；prober=`server/probe-code-panel.mjs`、`server/probe-code-workspace.mjs`。**不要动 dist\ 与 zip**（Lead 收尾）。
- 改完先 `node --check`；前端可起 `PORT=8101 node app.mjs` 自测（**不要占用 8099**，那是用户在跑的发布包；不要加载大模型）。
- 不要并行跑界面探针；不要清 `workspace/sessions`。
- 日志只追加不改；大输出别贴，证据落 `server/docs/feature-code-workspace-2026-11-07/`。
- 中文注释、代码风格跟现有文件一致（无框架、无构建、原生 DOM）。
