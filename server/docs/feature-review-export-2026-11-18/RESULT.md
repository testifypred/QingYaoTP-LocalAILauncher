# v1.9.0 证据：审查结论导出（.challenge.md / .review.md）+ 三方对照

- 日期：2026-11-19 凌晨（Asia/Shanghai）
- 契约：[CONTRACT.md](CONTRACT.md)
- 探针：`server/probe-code-review-export.mjs`（**66 条**，不需要加载模型；无 CDP 时 E 段 skip）
- 全量驱动：`server/docs/run-full.ps1` 63 → **64 条**，断言口径 1224 → **1290**
- 证据文件：`dev-8100.txt`（dev 8100 全跑）、`probe-export-compare3.png` / `probe-export-stored.png`（UI 截图）

## 结果

| 阶段 | 环境 | 结果 |
|---|---|---|
| dev 8100 隔离 | `node probe-code-review-export.mjs http://127.0.0.1:8100 http://127.0.0.1:9333` | **66/66**（A5 / B23 / C10 / D13 / E15） |
| 全量 r1 | 8099 dev + Edge 9333 | 64 条里 **60 PASS + 4 FAIL**：`probe-start-flow` 6/8、`probe-small-features` 1 fail（复制按钮 0）、`probe-start-screen` 11/12、`probe-menu-stacking` 1/2 |
| 定性 + 修探针 | e2e | 前三条**全是探针顺序污染**：新探针 E 段 `loadSession(临时会话)` 后删了会话，但 localStorage `localai.lastSession` 还指着已删 id → 后面依赖「上次对话」的探针假红。修：探针开跑前记旧指针、收尾写回并 reload（见 probe 内 `PREV_LAST_SESSION`）。`menu-stacking` 是 Edge 视口被前序探针缩小的**已知假红** |
| 隔离复跑 | 8099 dev + 新 Edge | `probe-code-review-export` **66/66**、`probe-start-flow` **8/8**、`probe-small-features` **6/6**、`probe-start-screen` **12/12**、`probe-menu-stacking` **2/2** |
| 全量 r2 | 8099 dev + 新 Edge | **62 绿 + 2 环境红 / 1290 断言（1285 通过）**：`probe-menu-stacking` 视口已知假红（已给探针钉 1408×800，隔离复跑 2/2）、`probe-web-tools` 百度反爬 0 条（同查询后段流式搜索正常，外网波动）；r2 目录 `server/docs/probe-full-2026-11-19-v190-r2/` |

## 断言分组（66）

- **A 令牌与参数（5）**：export / compare3 无令牌 403；kind 非法 400；compare3 全空 200 + rows=0 + consistent。
- **B compare3 口径（23）**：5 行夹具（3/4 归并成三源矛盾行、30 行两方一致、10/20/40 单源）→ rows=5 / all3=1 / two=1 / one=3 / conflict=1 / bySource 3-2-3 / pair lc1-lu1-cu2 / verdict=contradicts；4 条 stats 恒等式；行距 3 不归并；两方同严重度 majority/pair2；两方不同 contradicts/conflict2；仅一方 differs/single。
- **C .challenge.md（10）**：文件名格式、字节数、标题、原审查结论、2 轮、问答原文、sk- 脱敏、不含代码正文。
- **D .review.md（13）**：文件名、六节齐全、两栏四类标签、三方表头、矛盾行、判定文案、meta 里云端上游/模型、质询也进 review 文件、计数、缺失兜底、空问题兜底。
- **E UI（15）**：8 个新 id、面板初始隐藏、按钮可用、临时会话、快照注入、三方表渲染（2 行数据）、徽标文案、表头、导出 .review.md / .challenge.md 状态、存进会话状态、会话文件里真有 assistant 消息（含三方表 + 短 ctx）。

## 真实上游兼容性冒烟（收尾第 ③ 件，另一个探针）

`server/probe-cloud-upstream-real.mjs` **20/20**（真 DeepSeek `deepseek-flash`、1 次请求、attempts=1、端到端 4.0s；证明 v1.8.1 的 `thinking:disabled` + 重试阶梯在真实协议上成立）。证据在 `server/docs/feature-cloud-upstream-real-2026-11-18/`，**不进 run-full**（外网 + 付费 Key + 非确定性）。

## 备注

- 这两条接口是**纯函数**：不碰模型、不落盘、不写会话；「存进会话」是前端往 `/api/sessions/<id>` PUT 一条 assistant 消息（content=Markdown、ctx=短摘要）。
- 导出内容只做**密钥级脱敏**（`sk-…` → `<API_KEY>`），不含代码正文；三方聚合与 Markdown 生成都有确定性单测（探针 B/C/D 段）。
- 白名单 DOM id 见 CONTRACT §3.1；改 UI 时别动。
