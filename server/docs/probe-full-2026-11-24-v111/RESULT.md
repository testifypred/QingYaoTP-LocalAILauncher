# 全量回归结果（v1.11.1 源码实例，2026-11-25）

- 驱动：server/docs/run-full.ps1（70 条 / 1,524 断言），源码实例 node server/app.mjs，4B ctx=16384，headless Edge 9333，约 23 分钟。
- 整跑：**68 PASS + 2 环境红**；隔离复跑：probe-ui-web **39/39**、probe-web-tools **19/19** → **有效 70/70**。
- 两条红的性质：probe-ui-web 的「刷新后联网卡片被恢复」= 全量会话状态级联/时序；probe-web-tools = 百度反爬波动（隔离跑 19/19）。
- 复跑记录：rerun/probe-ui-web.out.txt、rerun/probe-web-tools.out.txt（被 .gitignore 忽略；本文件保留结论）。

## 70 条结果（整跑）

| # | 探针 | 结果 |
|---|---|---|
| 1 | probe-sessions | PASS              0.6s fails=0 == �~�g: 33 �Ǐ / 0 1Y%� == |
| 2 | probe-workspace-api | PASS              0.6s fails=0 RESULT 9/9 |
| 3 | probe-code-run | PASS             17.4s fails=0 RESULT 13/13 |
| 4 | probe-code-workspace | PASS              0.6s fails=0 RESULT 21/21��Ǐ 1 ag	� |
| 5 | probe-code-review-stream | PASS               49s fails=0 == �~�g: 45 �Ǐ / 0 1Y%���Ǐ 3 y�	� == |
| 6 | probe-review-watchdog | PASS             46.5s fails=0 == �~�g: 56 �Ǐ / 0 1Y%� == |
| 7 | probe-code-panel-v2 | PASS             52.7s fails=0 == �~�g: 44 �Ǐ / 0 1Y%� == |
| 8 | probe-tui-tools | PASS              2.3s fails=0 == �~�g: 52 �Ǐ / 0 1Y%� == |
| 9 | probe-code-review-verify | PASS            103.9s fails=0 == �~�g: 87/87 �Ǐ == |
| 10 | probe-code-review-export | PASS              7.6s fails=0 RESULT 66/66 |
| 11 | probe-code-review-multi | PASS            156.6s fails=0 RESULT 86/86 |
| 12 | probe-cloud-upstream-stream | PASS              1.6s fails=0 RESULT 24/24 |
| 13 | probe-gpu | PASS                1s fails=0 == �~�g: 14 �Ǐ / 0 1Y%� == |
| 14 | probe-ui-gpu | PASS              7.8s fails=0 == �~�g: 7 �Ǐ / 0 1Y%� == |
| 15 | probe-ui-metric | PASS             10.8s fails=0 |
| 16 | probe-backup | PASS             17.1s fails=0 == �~�g: 38 �Ǐ / 0 1Y%� == |
| 17 | probe-rag | PASS              0.7s fails=0 == �~�g: 16 �Ǐ / 0 1Y%� == |
| 18 | probe-plugins | PASS              0.5s fails=0 == �~�g: 11 �Ǐ / 0 1Y%� == |
| 19 | probe-version | PASS              0.4s fails=0 RESULT 14/14 |
| 20 | probe-firstrun | PASS              0.4s fails=0 RESULT 22/22 |
| 21 | probe-debug | PASS              4.3s fails=0 RESULT 54/54 |
| 22 | probe-func | PASS             29.4s fails=0 |
| 23 | probe-ui-new | PASS              8.1s fails=0 == �~�g: 30 �Ǐ / 0 1Y%� == |
| 24 | probe-readme | PASS             10.1s fails=0 RESULT 21/21 |
| 25 | probe-start-screen | PASS              4.5s fails=0 RESULT 12/12 |
| 26 | probe-start-flow | PASS                8s fails=0 RESULT 8/8 |
| 27 | probe-model-add | PASS              8.3s fails=0 RESULT 4/4 |
| 28 | probe-model-delete | PASS             11.2s fails=0 RESULT 20/20 |
| 29 | probe-menu-stacking | PASS              3.8s fails=0 RESULT 2/2 |
| 30 | probe-status | PASS              3.7s fails=0 RESULT 6/6 |
| 31 | probe-code-panel | PASS              6.4s fails=0 RESULT 17/17��Ǐ 1 ag	� |
| 32 | probe-settings-tools | PASS              5.4s fails=0 RESULT 9/9 |
| 33 | probe-workspace-ui | PASS                8s fails=0 RESULT 7/7 |
| 34 | probe-hero-modes | PASS              9.8s fails=0 RESULT 11/11 |
| 35 | probe-input-extras | PASS              8.2s fails=0 RESULT 8/8 |
| 36 | probe-formula-panel | PASS              7.6s fails=0 RESULT 7/7 |
| 37 | probe-stream-render | PASS              2.7s fails=0 == �~�g: 15 �Ǐ / 0 1Y%� == |
| 38 | probe-review-scroll | PASS              0.6s fails=0 == �~�g: 10 �Ǐ / 0 1Y%� == |
| 39 | probe-code-window-ui | PASS              0.5s fails=0 == �~�g: 10 �Ǐ / 0 1Y%� == |
| 40 | probe-formula-find | PASS              7.1s fails=0 RESULT 8/8 |
| 41 | probe-timestamps | PASS              5.8s fails=0 RESULT 4/4 |
| 42 | probe-small-features | PASS              9.1s fails=0 RESULT 6/6 |
| 43 | probe-title-ui | PASS              6.9s fails=0 RESULT 13/13 |
| 44 | probe-session-jump | PASS                8s fails=0 RESULT 4/4 |
| 45 | probe-session-race | PASS              5.5s fails=0 RESULT 3/3 |
| 46 | probe-ctx-panel | PASS             13.7s fails=0 RESULT 25/25 passed |
| 47 | probe-code-run-ui | PASS              4.3s fails=0 RESULT 9/9 |
| 48 | probe-ui-tools | PASS               27s fails=0 == �~�g: 12 �Ǐ / 0 1Y%� == |
| 49 | probe-ui-web | FAIL(exit 1)       36s fails=1 == �~�g: 38 �Ǐ / 1 1Y%� == |
| 50 | probe-ui-rag | PASS                5s fails=0 == �~�g: 6 �Ǐ / 0 1Y%� == |
| 51 | probe-ui-version | PASS                5s fails=0 RESULT 9/9 |
| 52 | probe-ui-debug | PASS             16.3s fails=0 RESULT 33/33 |
| 53 | probe-download-ui | PASS               13s fails=0 RESULT 35/35 |
| 54 | probe-ui-backup | PASS             10.9s fails=0 == �~�g: 20 �Ǐ / 0 1Y%� == |
| 55 | probe-sidebar-search | PASS             11.2s fails=0 == �~�g: 11 �Ǐ / 0 1Y%� == |
| 56 | probe-auto-title | PASS             24.4s fails=0 RESULT 5/5 |
| 57 | probe-ui-sessions | PASS             13.8s fails=0 == �~�g: 28 �Ǐ / 0 1Y%� == |
| 58 | probe-chat-plain | PASS              6.9s fails=0 == �~�g: 11 �Ǐ / 0 1Y%� == |
| 59 | probe-tool-stream | PASS             29.4s fails=0 RESULT 9/9 |
| 60 | probe-tools-agent | PASS             99.8s fails=0 == �~�g: 24 �Ǐ / 0 1Y%� == |
| 61 | probe-web-tools | FAIL(exit 1)    108.6s fails=4 == �~�g: 15 �Ǐ / 4 1Y%� == |
| 62 | probe-kv-long | PASS             46.7s fails=0 |
| 63 | probe-context-switch | PASS             25.4s fails=0 RESULT 3/3 |
| 64 | probe-ui-preload | PASS             28.7s fails=0 == �~�g: 35 �Ǐ / 0 1Y%� == |
| 65 | probe-preload | PASS             28.7s fails=0 == �~�g: 26 �Ǐ / 0 1Y%� == |
| 66 | probe-second-opinion | PASS             38.2s fails=0 == �~�g: 11 �Ǐ / 0 1Y%� == |
| 67 | probe-ui-vision-pack | PASS             23.8s fails=0 == �~�g: 42 �Ǐ / 0 1Y%� == |
| 68 | probe-ui-vision | PASS                6s fails=0 == �~�g: 19 �Ǐ / 0 1Y%� == |
| 69 | probe-vision-pack | PASS             43.8s fails=0 == �~�g: 110 �Ǐ / 0 1Y%� == |
| 70 | probe-vision-api | PASS             30.7s fails=0 == �~�g: 27 �Ǐ / 0 1Y%� == |

> 原始 summary.txt 为混合编码（Tee-Object 默认 Unicode + Out-File utf8），已按 UTF-8 解码去 NUL 整理；原始文件被 .gitignore 忽略。
