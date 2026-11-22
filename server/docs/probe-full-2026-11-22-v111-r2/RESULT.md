# v1.11.0 全量探针结果（2026-11-22 22:15–22:37）

- 目标：**源码实例** `node app.mjs`（v1.11.0，PORT=8099，4B 已加载）；headless Edge（9333，about:blank + CDP `PUT /json/new`）
- 驱动：`server\docs\run-full.ps1`（70 条 / 断言口径 1524）
- 整跑：**64 PASS + 6 FAIL**，耗时 **21.9 分钟**（22:15:21–22:37:19）
- 隔离复跑（fresh Edge，同一源码实例）：**6/6 全绿** → 有效 **70/70**

## 整跑 6 条红与隔离复跑结果

| 探针 | 整跑 | 隔离复跑 | 原因 |
|---|---|---|---|
| probe-start-screen | 11/12 | **12/12** | 会话/localStorage 状态级联（整跑前序探针切换/清理会话留下 lastSession 不一致） |
| probe-start-flow | 6/8 | **8/8** | 同上（「继续对话能打开历史」「开场白消失」连带） |
| probe-small-features | 失败 1 | **6/6** | 同上（回答复制按钮 count=0；会话无有效回答） |
| probe-web-tools | 15/19 | **19/19** | 外网波动：百度反爬返回 0 条（后段流式搜索正常）；隔离跑拿到 7 条 / 引擎 baidu |
| probe-vision-pack | 1/2 | **110/110** | **环境**：8199 端口被本机 DSH Desktop.exe 占用 → 探针改用 **8299** 后过 |
| probe-ui-vision-pack | 1/3 | **42/42** | 同上（8199 被占用导致临时实例起不来，连带共享页面导航失败） |

## 其它关注点

- `probe-code-panel-v2`：r1 出现 1 红（审查完成后状态行被结果标签文案覆盖，缺「审查完成」）→ 已在 app.html 修复（`cwReviewCode` 完成后补写「审查完成 · N 个问题 · Xs」），r2 **44/44**。
- `probe-cloud-upstream-stream`：r1 的 Z1 红是环境（整跑跑在 dist 实例上，探针写的是源码 `data\cloud-review.json`）；换源码实例后 **24/24**。
- 断言口径 **1524**（探针 91 个 / 全量 70 条）。

## 证据

- 整跑：`logs/`、`summary.txt`、`run-full.out.log`、`rerun.log`
- 隔离复跑：`logs/rerun-*.out.txt`、`shots/`
