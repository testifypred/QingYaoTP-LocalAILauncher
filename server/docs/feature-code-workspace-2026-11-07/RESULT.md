# 代码工作区 + 模型审查（v1.2.0，2026-11-07 第十一轮）

> 用户需求原话：「在 Agent 模式下输出的所有代码都要转到代码模块输出，并以代码工作区的形式（类似 VS Code）输出。旁边加上代码补全的模型调用按钮，按下后可以开始结合用户意图审查代码是否合理。」
> 结论：三件事全部落地并验证 —— Agent 自动收录（E2E PASS）、VS Code 式工作区（UI 探针 18/18）、模型审查（API 75.8s / UI 86.5s，四节结构完整）。

## 一、做法

契约先行（`CONTRACT.md`），三条线并行：backend 改 `app.mjs`、frontend 改 `app.html`、prober 重写/新增探针；Lead 负责集成、全量回归、打包与文档。

### 1. 存储：不新增文件 API

代码文件 = 工作区 `code/` 子目录，复用既有 `/api/workspace/list|read|save|delete`；路径统一 `code/xxx.py`。

### 2. 后端（`server\app.mjs`，+175 行）

| 接口 | 语义 |
|---|---|
| `POST /api/code/capture` | `{files:[{name,content}]}` 1–20 段 → 落 `workspace\code\`；basename 清洗（剥路径、禁 `..`、保留中文）、空名→`snippet.txt`、无扩展名→`.txt`、重名 `-2/-3` 不覆盖（`open(...,'wx')` 原子写）；单文件 >20 万字符 / 合计 >40 万 → 413；缺/空 files → 400 |
| `POST /api/code/review` | `{code,lang?,file?,intent?,max_tokens?}` → 独立小上下文审查，返回 `{ok,review,seconds,model,contextSize,maxTokens}`；空 code → 400、>2 万字符 → 413、无模型/模型忙 → 409 |

审查用固定 system prompt（结论 / 主要问题 / 改进建议 / 风险与边界），`temperature=0.2`、`maxTokens` 默认 900（128–1600）；**上下文按 8192 → 4096 → 2048 逐档回退**（小上下文模型不至于 500）；照 `generateTitleWithModel()` 单开 context、用完 dispose，**不碰主会话 KV 缓存**。

### 3. 前端（`server\app.html`，+605/−88）

- 顶栏「代码」从简易 textarea 运行器 → **VS Code 式工作区**：左侧文件列表（`.cwItem`）、标签页（`.cwTab` + 未保存 `.dirty`）、CodeMirror（行号/高亮，JS/Python/C-C++/Java/Go/Rust）、工具栏（保存/删除/运行/模型审查）、底部运行输出、右侧审查面板（意图输入 + Markdown 渲染）。
- 快捷键：Ctrl+S 保存、Ctrl+Enter 运行、Esc 关闭；标签 `×`；切换/关闭前对 dirty 自动保存；打开时恢复 `localai.cwOpen` / `localai.cwIntent` / `localai.cwReviewOpen`。
- **Agent 模式自动收录**：`send()` 收尾（`if (acc) paint()` 之后）→ 提取围栏代码块 → 一次 `/api/code/capture` → 大气泡后插入「Agent 模式：已收录 N 段代码到代码工作区」+「打开」按钮；每个代码块头加「工作区」按钮（无 `dataset.wsPath` 时单块补收录再打开）。失败只 toast，不影响对话。
- 设置 → 生成 加「Agent 模式代码自动收录」复选框（`localai.settings.codeCapture`，并镜像 `localai.codeCapture`；默认开）。
- 顺手修布局：`.cwBox` 原来写在 `.modalBox` 之前被 720px 压住 → 改 `.modalBox.cwBox`（1180px 宽 / 90vh）。

## 二、验证

| 项 | 结果 | 证据 |
|---|---|---|
| `probe-code-workspace`（API） | **22/22**（无模型那次）；全量回归（已加载 7B）时 21/21 + 跳过「无模型 409」1 条 | `feature-code-workspace-2026-11-07/logs/probe-code-workspace.out.txt` |
| `probe-code-panel`（UI） | **18/18**（无模型那次）；全量回归时 17/17 + 跳过 1 条 | 同目录 `probe-code-panel.out.txt` + 截图 `code-panel-*.png` |
| Agent 全链路 E2E | **PASS**：勾「调用工具」→ 发「用 Python 写判断质数」→ 22s 生成 → 自动收录 1 段 → 落盘 `code/python-110450-1.py`（随后在 UI 里打开，编辑器 272 字符） | `logs/e2e-agent-capture.out.txt` + `logs/e2e-review-ui.out.txt` |
| 模型审查（API，源码模式 4B） | **75.8s**，1193 字，四节完整，明确回应「大数 / 尽量快」；`contextSize=8192` | 当日终端实测（后由发布包复测补了原始响应） |
| 模型审查（API，**发布包** 4B） | **72.0s**，1547 字；`contextSize=8192` / `maxTokens=900` / model=qwen3-5-4B | `logs/review-api-raw.json`（含完整请求与响应） |
| 模型审查（UI 按钮，4B） | **86.5s**，1210 字，面板内 Markdown 渲染（模型名 + 耗时显示在标题） | `logs/ui-review-mw5tlyhv.png` |
| 全量回归 | 51 条 / 718 断言全绿（见 `probe-full-2026-11-07/RESULT.md`） | 同上 |
| 版本 | `APP_VERSION` / `package.json` / `/api/version` 三处 = 1.2.0 | `probe-version` 14/14 |

### 截图

- 工作区 + 审查面板（推理结果已渲染）：`logs/ui-review-mw5tlyhv.png`（推荐看这张）
- 工作区空态/运行输出：`logs/code-panel-mw5tg3py.png`
- E2E 自动收录：`logs/e2e-agent-capture-mw5tl0uh.png`（截图上首启引导浮层还在，聊天区被遮住；以 `e2e-agent-capture.out.txt` 的日志为准）

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `server\app.mjs` | L37 版本 1.2.0；L1691–1842 代码工作区后端块（常量/prompt、`codeSafeName`、`codeWriteUnique`、`handleCodeCapture`、`handleCodeReview`）；L5050–5052 路由 |
| `server\app.html` | CSS 604–655；HTML 1288–1326 + 设置项 1357；renderMarkdown 2532–2540；点击分发 2762–2771；JS 3315–3858；`send()` 钩子 5342–5344；设置 JS 5376/5416/5448/5608/5628 |
| `server\probe-code-workspace.mjs` | 新增（API，22 条） |
| `server\probe-code-panel.mjs` | 重写（UI，18 条） |
| `technique\02-接口.md` | 新增「代码工作区（v1.2.0）」接口段 |
| `server\package.json` | 1.1.0 → 1.2.0 |

## 四、与契约的偏差（实现细节，语义一致）

1. 引号风格跟随文件（app.mjs 全文双引号，契约写的单引号以现有代码为准）。
2. 空名落地为 `snippet.txt`（契约两条规则叠加），不是裸 `snippet`。
3. 收录扩展名表补了常用别名（javascript→js、python→py、typescript→ts、c++→cpp…），未知→txt。
4. `.codeToWs` 对所有围栏块都加（renderMarkdown 不区分 Agent 模式）；无 `dataset.wsPath` 时点它单块补收录再打开。
5. 切文件/关面板时对 dirty 自动保存一次；标签加 ×；开始审查时自动展开审查面板。
6. `probe-ui-gpu` 在开发模式（无 config.ini）走「未写盘说明」分支，断言数 7 而非 8。

## 五、遗留（下一轮，按性价比）

1. **审查改流式 SSE**：现在整段生成，4B 约 75–90s 才出结果；流式可以边看边等。
2. **整工作区/多文件一起审查**；审查结论一键回填聊天或另存 `.review.md`。
3. **长代码窗口**：2 万字符上限 vs 8192 上下文，超长会被截断；可考虑按 token 预算切片。
4. 重渲染历史消息后「工作区」按钮走单块补收录，可能产生 `xxx-2` 副本（不影响功能）。
