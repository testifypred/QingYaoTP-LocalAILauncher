# codeui 自检结果 —— v1.7.0 代码面板升级（app.html）

日期：2026-11-15（第二十二轮）　负责：codeui　改动文件：`server/app.html`（git diff +704 / −16，未 commit）

## 1. 实现清单（契约 §2）

| 契约 | 实现 | 关键 id / 函数 |
|---|---|---|
| 2.1 新建可选语言 | 15 语言下拉（js/ts/py/c/cpp/java/go/rust/html/css/json/md/sh/sql/txt）+「按文件名」；名字没扩展名自动补、有扩展名尊重用户；CodeMirror mode 跟着切；placeholder 跟着变；记 `localai.cwNewLang` | `#cwNewLang`、`CW_NEW_LANG_EXT/PH`、`cwNewFile`、`cwSyncNewLangUI/cwInitNewLang` |
| 2.2 审查可选模型 | 首项「本对话模型（当前）」value=""，其余 = `/api/state.models` 的 file；请求带 `model`；切模型时先显示「正在切换模型…」，meta.switchedModel=true → toast「已切换到 …」 | `#cwReviewModel`、`cwPopulateReviewModels` |
| 2.3 流式思维链 | `POST /api/code/review/stream`（x-local-token + SSE getReader/TextDecoder 按空行切）；delta 实时 append 进 `<details id="cwThink">`；兼容后端 `phase` 事件；findings → 摘要 + `#cwIssues` 卡片；done → `#cwReviewState` | `cwStreamSSE`、`cwRunReviewStream`、`cwApplyFindings`、`cwRenderIssues` |
| 2.4 错误行高亮 | issues line..endLine → CodeMirror `addLineClass(background)` 上 `.cwLineErr/.cwLineWarn/.cwLineInfo`；新审查先清旧；点卡片跳行并选中 | `cwApplyIssueHighlights`、`cwClearLineClass`、`cwGotoIssue` |
| 2.5 一键更改/纠正/重新审查 | `#cwFixAll`（scope=all）/ 单条 `.cwIssueApply`（scope=single）→ `POST /api/code/fix` SSE；delta 追加进同一思考块；result 写入编辑器（保持 dirty 不落盘）+ `.cwLineChanged`；`#cwReReview` 清空重跑 | `cwFixIssues`、`cwApplyFixResult`、`cwApplyChangedHighlights`、`cwReReview` |
| 2.6 发回对话 | 当前代码 + 「这是修正后的版本：文件（语言）」+ 改动行摘要 → 围栏块写进聊天输入框（本库 id 是 `#q`，JS 变量 input）并聚焦、toast、不自动发送/不自动保存 | `#cwSendChat`、`cwSendChat`、`cwFenceLang` |
| 2.7 高亮颜色自定义 | 设置新增「代码」页（`data-tab=code` / `#paneCode`）；`#cwColorErr/#cwColorWarn/#cwColorInfo/#cwColorChanged` + `#cwColorReset`；`localai.cwColors`，CSS 变量 `--cw-err-bg/--cw-warn-bg/--cw-info-bg/--cw-changed-bg`（默认 #7f1d1d66/#78350f66/#164e6366/#14532d66） | `cwLoadColors/cwApplyColors/cwSaveColors/cwBindColorInputs` |
| 2.8 兼容 | 契约 18 个老 id + 新增共 32 个全在；`renderMarkdown` 摘要路径保留；流式接口 404 时自动退回老 `/api/code/review` | `cwReviewLegacy` |

## 2. 验证（2026-11-15，8099 dev v1.7.0 / 9333 headless Edge 1408×723 / 4B）

### 2.1 真模型 CDP 全流程 —— `codeui-cdp-check.mjs`：**33/33 绿**
- 语言：`#cwNewLang=py` → placeholder「main.py（回车新建）」、`localai.cwNewLang=py`、输入无扩展名 → 自动落 `code/main.py`、CodeMirror mode=python
- 审查：首段思考 **5.2s** 出现；整轮 **47.9s**；`#cwReviewState` =「审查完成 · 2 个问题 · 47.9s」；卡片 2 条（error 行 3–4 / warn 行 4，均带 Head/Detail/Fix/Apply）；`.cwLineErr`×2、`.cwLineWarn`×1
- 点卡片：选中行 3–4、滚动到位
- 一键纠正：13.4s；`#cwReviewState` =「已修改 1 处（新增 5 / 删除 2）· 可保存或发回对话」；代码 187→270 字符；`.cwLineChanged`×5（新代码 3–7 行）；标签 ● / 文件「未保存（已修改）」；服务端读回**仍是原 bug 代码**（未自动落盘）
- 发回对话：`#q` 含 ```javascript 围栏块 + 「这是修正后的版本：codeui-bug-*.js（javascript）」+「改动行：第 3–7 行（新增 5 / 删除 2）」；面板收起、未发送
- 颜色：`#cwColorErr=#00ff00` → `localai.cwColors.err=#00ff0066`、`--cw-err-bg=#00ff0066`；`#cwColorReset` → 回到 #7f1d1d66
- 控制台 0 error / 未捕获异常；结束时自删探针文件
- 截图：`codeui-review.png`（审查完成 + 问题卡片 + 错误行）、`codeui-fix.png`（一键纠正 + 改动行绿色 + 状态行 + toast）、`codeui-settings-code.png`（设置 → 代码 四色 + 恢复默认）

### 2.2 fetch stub UI 自检 —— `codeui-stub-check.mjs`：**35/35 绿**（8099 卡死期间用，不依赖后端）
额外覆盖真跑不便复现的分支：单条 scope=single（只 1 行 `.cwLineChanged`）、`#cwReReview`（旧高亮清 0 后重跑）、`meta.switchedModel=true` 的「正在切换模型…」+「已切换到」toast、修正 delta 追加同一思考块。
截图：`codeui-stub-review.png`、`codeui-stub-fix.png`、`codeui-stub-settings-code.png`。

### 2.3 回归
- `node probe-code-workspace.mjs http://127.0.0.1:8099` → **21/21**（跳过 1 条：当前已加载模型）
- `node probe-code-panel.mjs` → **17/17**（跳过 1 条：当前已加载模型）
- 静态：`server/app.html` 内联脚本 `node --check` 0 错；id 无重复（`hero/heroGreet` 是 JS 模板字符串，原有）；设置 tab/pane 一一对应。

## 3. 已知遗留 / 风险
1. 旧的非流式 `/api/code/review` 兜底路径只在「流式接口 404」时触发，真后端在线时无法实测（代码路径已保留；老接口本身由 probe-code-workspace 覆盖）。
2. 单条「一键更改」在真模型下没单独跑（真跑只跑了 scope=all；single 由 stub 35/35 覆盖）。可按需补一次真跑。
3. 审查期间 `/api/load` 由后端 409 保护；界面在审查中不会切模型（审查模型下拉默认空 = 本对话模型）。
4. 需求文案里的聊天输入框 `#input` 在本代码库实际是 `#q`（JS 变量 `input`）；已写 `#q` 并在开场白 `#heroInput` 同步。
5. 本轮不重打发布包、不 commit（按约定由 Lead 统一提交）。

## 4. 复跑命令
```powershell
cd D:\LocalModels\server\docs\feature-code-review-terminal-2026-11-15
node codeui-cdp-check.mjs        # 真模型全流程（要求 8099 活着、模型已加载或可自动装 4B）
node codeui-stub-check.mjs       # 不碰 8099 的 stub 版（要求 9333 里 8099 页面已打开）
cd D:\LocalModels\server; node probe-code-workspace.mjs http://127.0.0.1:8099; node probe-code-panel.mjs
```
## 5. 附：probe-code-panel-v2 首跑 31/40 的定性（2026-11-15 16:10 后）
- 10 条红里有 **8 条**来自探针自身 readIssues() 少一个右括号（Runtime.evaluate SyntaxError 被 catch 吞掉 → 永远返回 []，卡片明明在 DOM 里也判 0 张）；probes 已在 16:08 修好（现注释「以前这里少一个 )」），单实例复跑 **40/40 绿**。
- 另 2 条颜色断言红是**共用 9333 同一页面并发串台**：Lead 的 CDP 复跑与 probes 探针同时操作同一页面（互相切文件/清高亮），非产品缺陷；隔离复验（点卡片 cursor=3=issue.line、改色 localStorage/CSS 变量/恢复默认）全部正确。
- 结论：**共享 9333 页面的 UI 测试一次只跑一个**；本文档里真跑 33/33、stub 35/35 均为单实例结果。
