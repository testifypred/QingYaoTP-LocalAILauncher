# v1.6.0 全量回归 r2（59 条）— 结果

- 时间：2026-11-15 13:12 → 13:30
- 环境：`node app.mjs`（dev，`D:\LocalModels\server`，MODEL_DIR=仓库根，v1.6.0）+ headless Edge 9333（**视口 1408×723**，`--window-size=1440,900`）+ 会话从 `server\docs\session-backups\20261115-123436\` 恢复（8 个真实会话）
- 驱动：`server\docs\run-full.ps1`（59 条，断言口径 1031）

## 结果

**58 绿 / 1 红**。

| 探针 | 结果 | 说明 |
|---|---|---|
| `probe-web-tools` | 15/19（1 红条目的 4 个断言） | `web_search` 抓回 **0 条结果**、`engine=undefined`（外部搜索引擎瞬时失败）；**同一探针后段流式 `web_search` 仍抓到结果**，且单独复跑 §2 抓到 **6 条 / 引擎 baidu** → 环境问题，非产品/本轮改动 |
| 其余 58 条 | 全绿 | 含视觉 4 条：`probe-vision-pack` 110/110、`probe-ui-vision-pack` 42/42、`probe-ui-vision` 19/19、`probe-vision-api` 27/27（真 9B 320×180 识图「QWEN 42」） |

## 前一轮（v160，12:38–12:59）的 4 条红 —— 全部定性为探针陈旧/环境，修探针后复跑绿

| 探针 | 首跑 | 根因 | 修复 | 复跑 |
|---|---|---|---|---|
| `probe-ui-new` | 29/30 | 陈旧断言 `saved.v === 2`，v1.5.1 起 `SETTINGS_VERSION = 3` | 改 `saved.v >= 2` | **30/30**（`rerun/`） |
| `probe-ui-backup` | 19/20 | 「同盘提醒」只在备份目录与会话同盘时出现，探针把备份目录放 `os.tmpdir()`（C:），仓库在 D: | 默认目录改到仓库所在盘 `tmp-probe-backup-ui-target` | **20/20**（`rerun/`） |
| `probe-menu-stacking` | 1/2 | **Edge 视口被缩成 500×320**（应 1408×723），最后一行落在视口外 → rect 高 0 | 重启 Edge（不改产品/探针） | **2/2**（`rerun/`） |
| `probe-ui-web` | 33/39 | 探针 E 段 `newChat()` 后没重新勾「调用工具」（v1.5.1 起默认关）→ 请求体 `tools=false web=false`，`web_search` 没注册 | E 段 newChat 后重勾 + dispatch change | **39/39**（`reprobe-ui-web.out.txt`） |

> 产品代码在这 4 条上**零改动**；改动只在探针。

## 插曲

- 12:44 左右服务端进程退出一次，驱动 `Ensure-Server` 自动拉起并重装模型（已知的 Vulkan 中途断开问题，非本轮引入）；`probe-ui-rag` 当时 6/6 绿。

## 证据

- 逐条日志：`logs\*.out.txt`；截图：`shots\`
- 复跑：`rerun\probe-ui-new.out.txt`、`rerun\probe-ui-backup.out.txt`、`rerun\probe-menu-stacking.out.txt`、`reprobe-ui-web.out.txt`、`rerun-web-tools.out.txt`
- 发布包冒烟（终版 dist）：`server\docs\feature-vision-pack-2026-11-15\release-smoke.txt`（26/26）