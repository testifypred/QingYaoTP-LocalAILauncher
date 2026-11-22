# 主页面输出优化（2026-11-22）契约

> 背景：用户长期反馈「终端输出始终比主页面快」。实测确认两条链路打的是**同一个** `/v1/chat/completions`，差距来自 ① 请求参数（工具/思考默认税）② 浏览器每帧整段重绘 + 全量 KaTeX。
> 版本：主程序保持 **v1.10.0**（未发版、未提交 Git，用户要求）；TUI 独立 2.0.0 不动。

## 1. 六项优化 → 验收

| # | 优化 | 实现 | 验收 |
|---|---|---|---|
| 1 | 首字税可见 + 一次性模式 | 输入区上方 `#genModeChip` 显示「工具开/思考开 → 正文首字约 Xs」；Agent/推理模式改为**一次性**（`modeOneShot`，发完恢复持久设置，不再 `saveSettings`） | chip 随勾选显示/收起；probe-stream-render 4 条；probe-hero-modes 11/11 |
| 2 | 流式增量渲染（O(n)） | `createStreamView()`：按空行/代码围栏/独立公式块切分，已闭合块只渲染一次；未闭合尾巴只做行内 Markdown；`finish()` 整体渲染一次 | 6000 字 200 帧：新 0.37–0.48ms/帧 vs 旧 14.3–16.8ms/帧（**约 30–40 倍**）；最终 KaTeX/Markdown 正确 |
| 3 | 流式期间不跑全量 KaTeX | 块完成时对该块 `renderAssistant` 一次（含公式），尾巴不跑 KaTeX；`finish()` 再整体排版一次 | 6000 字最终 katex=100；单帧 < 2ms |
| 4 | rAF 合帧 + 滚动合并 | 80ms `setTimeout` → `requestAnimationFrame`；`scroll()` 也合并到下一帧，最多一帧一次 | 端到端首字 1.4–1.6s；61 次增长/83 帧、无 JS 异常 |
| 5 | 工具说明瘦身 | 10 个工具描述从 858 字压到约 400 字 + 静态说明书压缩 | tools=true 首字 **6.4–7.1s → 5.3–5.9s**；工具探针/回归通过 |
| 6 | 「极简流式」开关 | 设置 → 生成 → 流式渲染：勾选后生成中只 `textContent = 全文`，结束后套 Markdown | 生成中 `midMarkup=false`、结束后 `finalMarkup=true`；probe 覆盖 |

## 2. 不改的东西

- 不动 `/v1/chat/completions` 协议与会话/KV 逻辑；不动 `renderMarkdown` 本身；不改颜色/样式。
- 不做自动重打包、不提交 Git、不改版本号（dist 已同步源码，8099 实跑新代码）。

## 3. 数据（本机 4B / Arc 核显）

| 场景 | 优化前 | 优化后 |
|---|---|---|
| 正文首字（工具关/思考关） | 1.5–1.8s | 1.4–1.8s（不变） |
| 正文首字（工具开） | 6.4–7.1s | **5.3–5.9s** |
| 正文首字（深度思考开） | 14.8–15.5s | 15.3–16.5s（思考本身的成本，未动） |
| 流式单帧（6000 字，200 帧） | 14.3–16.8ms | **0.37–0.48ms** |
| 端到端首字（页面发问） | — | 1.4–1.6s |

## 4. 文件

| 文件 | 改动 |
|---|---|
| `server\app.html` | 新增 `createStreamView` / `#genModeChip` / `#setStreamLite` / `modeOneShot` / `updateModeChip`；替换 80ms 全量重绘为块级增量 + rAF |
| `server\app.mjs` | 10 个工具 description 瘦身 + `buildToolInstructions` 静态段压缩 |
| `server\probe-stream-render.mjs` | 新增 15 条（渲染器/块切分/KaTeX/性能/chip/极简流式/无异常） |
| `server\docs\run-full.ps1` | 注册 probe-stream-render（66 → 67 条） |
| `dist\QingYaoTP AILauncher\app\` | app.mjs / app.html / localai-tui.mjs 已同步（8099 已重启） |

## 5. 证据

- `server-ttft.txt`：三种参数的首字/总耗时（优化后）
- `render-bench.txt`：新增量 vs 旧全量单帧耗时
- `ui-stream.txt`：页面真实发问的首字/增长次数/chip 状态
- `lite.txt`：极简流式（生成中纯文本、结束回 Markdown）
- `probe-stream-render.log`：15/15
- 回归：`probe-ui-new` 30/30、`probe-formula-panel` 7/7、`probe-hero-modes` 11/11、`probe-settings-tools` 9/9、`probe-chat-plain` 11/11、`probe-tui-tools` 52/52

## 6. 已知限制

- 块级增量渲染会在长回答里产生较多小块 DOM（6000 字约 250 块）；实测单帧仍 < 0.5ms，但极端 3 万字可考虑合并小块。
- 工具说明瘦身后仍占 ~400 字（约 2.5–3s 预填充），不可能为零：模型需要知道工具名与用途。
- 深度思考的 15s 是模型先想后答的固有成本；本次只让它「更早知道要等多久」（chip），没有也不能消除。
