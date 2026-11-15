# v1.5.1 · 修「主页面回答很慢 / 终端很快」（2026-11-15）

## 现象与结论

同一台机器、同一个模型：主页面输完问题要等很久才出字；终端 `localai tui` 很快。
**不是两条推理路径**，而是**主页面默认走了工具分支**（开场白自动套用 Agent 模式），而终端默认 `tools=false` 且流式。

## 实测（9B Q4_K_M / Vulkan / 16K）

| 场景 | 修前首字 | 修后首字 | 总时长（修前→修后） |
|---|---|---|---|
| 关工具 · 三句话 | 1.5–2.0s | 1.5–2.0s | 8s → 8s |
| 关工具 · 300 字 | 2.0s | 2.0s | 27s → 27s |
| 开工具 · 三句话 | **19.1s**（一次性） | **~8s**，之后逐字 | 19.1s → 16.1s |
| 开工具 · 300 字 | **35.2s**（一次性） | ~8–9s 起逐字 | 35.2s → 流式 |
| 开工具 · 真调工具 | **30.1s** | 首字后推工具卡再续答 | 30.1s → 26s |

指标：工具模式 `promptTokens` **717 → 548**（`describe()` 不再列参数说明、规则 6 条压 4 行）。

## 三处改动

1. **工具分支流式**（`server/app.mjs`）：新增 `createToolCallScrubber()`，正文按 token 累积、遇到 `<tool_call>` 整块扣住（含跨 token 半标记），只放行安全片段；思考段走 `reasoning_content`；轮末 `finish()` 放尾巴、未闭合调用块丢弃。改用 `promptWithMeta` + `onResponseChunk`，与普通分支共用 `createThoughtSplitter`。
2. **工具说明瘦身**（`server/app.mjs`）：`describe()` 只列参数名；`buildToolInstructions` 压缩到 4 行规则。
3. **默认不再替用户打开工具**（`server/app.html`）：`SETTINGS_VERSION 2→3`（老配置迁移到关）、`toolEnabled = s.v>=3 ? s.tools===true : false`、删掉 `showHero()` 里的 `applyHeroMode('agent', true)` 自动调用；开关 tooltip 写明代价。

## 验证

| 项 | 结果 |
|---|---|
| `probe-tool-stream`（新增，9 条） | **9/9** |
| `probe-tools-agent` | 24/24 |
| `probe-chat-plain` | 11/11 |
| `probe-ui-tools` | 12/12 |
| `probe-hero-modes` | 11/11 |
| `probe-start-screen` | 12/12 |
| `probe-version`（pkg=1.5.1） | 14/14 |
| 迁移 | 写入 `{v:2,tools:true}` → 刷新后 `toolChk.checked=false` |
| 全量驱动 | 56 → **57 条**；断言口径 868 → **877** |

## 产物

- 发布包：359.5MB / 3499 文件
- 交付 zip：`dist\QingYaoTP-AILauncher-v1.5.1.zip` = 166,242,758 B / 158.5MB / 4000 条目 / 59.6s
- SHA256：`7BAAE5E2732C437EAA41D0D84EE99F627539715EA6506AD34636474163C6D569`
