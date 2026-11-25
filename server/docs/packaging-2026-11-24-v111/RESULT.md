# v1.11.1 打包与验证证据（2026-11-25）

## 版本
- 1.11.1：server/app.mjs:47、server/package.json:3、server/localai.mjs:19、server/localai-tui.mjs:1570（--main-ver 兜底）、server/probe-tui-tools.mjs 3 处夹具；TUI VER 仍 2.0.0。

## 构建
- build-portable.ps1 → **258.8 MB / 3,451 文件**（比 v1.11.0 多 3 个许可文件；app\ 含 LICENSE / NOTICE / THIRD_PARTY_NOTICES.md；无 app\llama）。
- 构建产物先落在 `D:\LocalModels\tmp-build\QingYaoTP AILauncher`（当时 dist 被探测实例占用），验证后整体换入 dist；旧 dist 备份 `dist\QingYaoTP AILauncher.v1.11.0.bak`（确认稳定后可删）。
- 关键源码↔构建一致：app.mjs / app.html / localai.mjs / package.json / localai-tui.mjs / vision-pack.mjs / doc-extract.mjs / code-review-multi.mjs **8/8 同哈希**；app\README.md 与仓库根 README 同哈希。

## 交付 zip
- `dist\QingYaoTP-AILauncher-v1.11.1.zip`：**127,971,996 B / 122.0 MB / 3,951 条目** / SHA256 `DECCBAE48D7CF23BF4879A60AC43EFA6F24790AF35AC198B5C1E356D0FFE213C`（make-zip.out.txt）。
- zip 自检：根目录 `QingYaoTP AILauncher-v1.11.1/`；app 下 3 个许可条目齐全；无 app/llama；无 cloud-review 运行数据；config.ini 已消毒（modelDir= / autoLoad=）；包内 package.json/app.mjs = 1.11.1、TUI VER=2.0.0。
- 视觉增强包沿用 `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`：38,408,198 B / SHA256 `D7924534B30143F3791D26C143B95656306AE1FFA08D52557EE25D56699A11D3`（与 v1.11.0 附件同文件）。

## 全量回归（源码实例 node server\app.mjs，4B/16K）
- 70 条 / 1,524 断言整跑 23 分钟：**68 PASS + 2 环境红**（probe-ui-web 38/39、probe-web-tools 15/19）。
- 隔离复跑：probe-ui-web **39/39**、probe-web-tools **19/19** 全过 → **有效 70/70**。
- 证据：`server\docs\probe-full-2026-11-24-v111\`（summary.txt 被 .gitignore 忽略，日志见 logs/ 与 rerun/）。

## 发布包冒烟（dist 实例）
- 全绿：probe-version 14/14、probe-debug 54/54、probe-code-review-stream 45/45（跳 3：Phi 切换）、probe-code-window-ui 10/10、probe-review-watchdog 56/56。
- 环境红（非包缺陷）：probe-readme 16/21、probe-code-panel-v2 38/44 —— 本机 `node.exe` 写 `D:\LocalModels\workspace` 报 EPERM（PowerShell 写同路径正常；WMI/Start-Process/计划任务启动都一样；换 MODEL_DIR 也不影响）→ 该环境无法完成 onboarding.json / 代码工作区落盘类断言。同代码在源码实例全量已过 readme 21/21、panel-v2 44/44；包内 app 文件与源码同哈希。
- 证据：`server\docs\packaging-2026-11-24-v111\smoke\`。

## 换装步骤（已执行）
1. 停源码/旧 dist 服务（`--stop` + 杀常驻 launcher + node，否则 dist\runtime\node.exe 被锁）。
2. 旧 dist 改名 `.v1.11.0.bak`，新构建移入 `dist\QingYaoTP AILauncher`，`data\` 保留。
3. 启动 exe → /health 2s 就绪；`POST /api/vision/pack/install` 装回视觉增强包（source=pack / 53 文件）。

## 发布状态
- zip + 视觉包已就绪；Git tag v1.11.1 / GitHub Release 资产待推（**需要 GH_TOKEN**，本会话无 token）。脚本：`create-release.mjs`。