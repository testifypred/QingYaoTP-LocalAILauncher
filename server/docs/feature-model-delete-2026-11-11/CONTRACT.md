# 删除模型文件 · 契约（2026-11-11）

> 需求：模型菜单里能直接删掉一个模型文件（含分片整组），删除前要确认、默认进回收站。
> 这是**破坏性操作**：安全（令牌、路径、正在使用拒绝）和可恢复（回收站）比花哨更重要。

## 一、文件所有权

| 谁 | 可写 |
|---|---|
| Lead | `server/app.mjs`（后端已实现）、dist/提交/文档 |
| ui-model-delete | `server/app.html` |
| probe-model-delete | `server/probe-model-delete.mjs`（新建）、`server/docs/run-full.ps1`（加一行，54→55） |

## 二、后端契约（已实现，可直接用）

`POST /api/models/delete`（必须带 `x-local-token`，否则 403）

请求体：`{ file: "Qwen3.5-9B-Q4_K_M.gguf", dryRun?: true }`

- `dryRun: true` 只做校验，**不删文件**，返回将删除的清单：
  ~~~jsonc
  { "ok": true, "dryRun": true, "file": "…",
    "files": [{ "name": "…", "bytes": 123, "mb": 0.1 }],
    "shardCount": 1, "totalBytes": 123, "totalMB": 0.1, "totalGB": 0 }
  ~~~
- 真删：同样结构 + `dryRun:false` + `recycled: true|false`（true = 已移入回收站；false = 回收站不可用、已永久删除）。
- 分片模型（`xxx-00001-of-00002.gguf`）：传任意一片，**整组一起删**，`files` 里是全部切片。
- 错误（`{ok:false,error:{message}}`，message 是给人看的中文）：
  - 400：缺 file / 带路径 / 非 `.gguf` / 路径越界
  - 404：文件不存在
  - 409：模型正在加载 / 视觉 sidecar 在用 / 该文件正在下载
  - 500：删除失败（少见，回收站与永久删除都失败）
- 已实测：干跑不删、单文件删除、分片整组删除、`/api/state.models` 立即不再列出。

## 三、页面契约（ui-model-delete 实现，只改 app.html）

1) **模型行删除键**：在 `renderModelTabs()` 的每行 `.modelRow`（仍保持 `<button class="modelRow">` + `dataset.file` + 原有点击选中/加载逻辑）里，追加一个 `<span class="modelDel" role="button" tabindex="0" title="删除这个模型文件（默认进回收站）">删</span>`。
   - 点击必须 `stopPropagation()`，**不能触发行的选中/加载**；键盘 Enter 也触发。
   - 样式：右侧小字、`color:var(--dim)`、hover/聚焦变 `var(--err)`；有运行绿点时排在绿点右侧（用 `margin-left:auto`，` .on + .modelDel{margin-left:4px}` 之类的写法避免挤）。
   - 行本身宽度不变（菜单 308px），不要换行。
2) **确认弹窗** `#delModelModal`（复用现有 `.modal/.modalBox/.modalHead/.modalFoot` 结构）：
   - 标题「删除模型」，正文显示文件名（`#delModelName`）与「N 个文件 · 共 X」+ 分片提示（`#delModelMeta`，数据来自 dryRun 的 `shardCount/totalBytes`，用现有 `fmtSize()`）。
   - 警告一句话：**默认移到回收站，可在回收站还原；回收站不可用时才永久删除、无法恢复。**
   - 按钮：`#delModelCancel`（取消）、`#delModelConfirm`（删除）；确认中按钮置灰显示「删除中…」；Esc / 点遮罩 / 取消都关闭。
3) **流程**：点「删」→ `POST /api/models/delete`（带令牌，`dryRun:true`）→ 失败直接 `showToast(error.message,'err',6000)`（后端已是人话）；成功打开弹窗填数据；确认 → `POST`（`dryRun:false`）→ 成功后：
   - toast：`已删除 N 个文件，释放 X（已移入回收站 / 已永久删除）`；
   - 关闭弹窗；若 `selectedModel === file` 清空 `selectedModel`；`refresh()` 刷新模型列表与顶栏按钮（列表空了会显示空态）；
   - 若后端 409（正在用），toast 显示后端原文，不要自己编。
4) 不要删除 `mmproj`（它不在模型列表里，别加进去）；不要给模型行加别的破坏性操作。
5) 不破坏既有断言：`#modelSel .modelRow` 的数量/`dataset.file`/点击加载行为保持不变（probe-model-add、probe-menu-stacking、probe-context-switch 都靠它）。
6) 窄窗/暗亮主题都正常；零依赖、无未捕获 JS 异常。

## 四、探针契约（probe-model-delete 实现）

新建 `server/probe-model-delete.mjs`（CDP + fetch；参数 `[cdp] [base]`），只操作 `probe-del-*` 前缀的假文件，**绝不碰真实模型**：

API（fetch）：
1. 没令牌 → 403；
2. `../evil.gguf` / `sub/x.gguf` → 400（路径穿越）；
3. 非 `.gguf`（`probe-del-x.txt`）→ 400；
4. 不存在 → 404；
5. 造 4KB 假文件 `probe-del-single.gguf` + 分片 `probe-del-shard-00001-of-00002.gguf`/`-00002-of-00002.gguf`；
6. dryRun 单文件 → `shardCount:1/totalBytes>0` 且**文件还在**；
7. dryRun 传第二片 → `shardCount:2` 且两片都在；
8. 真删单文件 → `ok/recycled` 是布尔、文件真的没了、`/api/state.models` 不再列出；
9. 真删分片组（传第二片）→ `shardCount:2`、两片都没了；
10. 已加载模型拒绝：若 `state.loaded` 非空，删它应 409 且文件仍在；没加载就记「跳过（未加载模型）」但断言数不变。

UI（CDP）：
11. 造 `probe-del-ui.gguf`（4KB 文本），等 `refresh()` 后点 `#modelBtn`，该行存在且行内有 `.modelDel`；
12. 点「删」→ 弹窗出现、`#delModelName` 含文件名、`#delModelMeta` 含文件数/大小、`#delModelCancel/#delModelConfirm` 可见，**此时文件还在**（dryRun）；
13. 点取消 → 弹窗消失、文件还在；
14. 再点「删」→ 确认 → 文件消失、弹窗消失、行不再存在、toast 含「已删除」；
15. 全程 0 未捕获 JS 异常；收尾把 `probe-del-*` 清干净、页面导航回主界面。

驱动：`server/docs/run-full.ps1` 在 `probe-model-add` 附近加 `probe-model-delete`（清单 54 → **55**），保持 BOM 与 PS5.1 Parser 0 错误。

## 五、验证

~~~powershell
node server\probe-model-delete.mjs http://127.0.0.1:9335 http://127.0.0.1:8099
node server\probe-model-add.mjs http://127.0.0.1:9333 http://127.0.0.1:8099   # 回归（模型行结构）
~~~

开发服务已在 8099 跑（源码 dev）；界面探针用 9333/9335 各自独立，别并行。

## 六、口径

- 版本号不升（仍 1.3.1）；新增探针后全量 **55 条**，断言口径跑完后记（预计 827 + ~20）。