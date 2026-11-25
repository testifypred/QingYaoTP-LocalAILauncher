# 交接：v1.11.1 打包进行中（2026-11-25 04:36 暂停；2026-11-25 深夜已继续，见下「最新状态」）

## 已完成（本地，未提交、未推送、未建 Release）

1. **版本号 1.11.1**：server/app.mjs:47、server/package.json:3、server/localai.mjs:19、server/localai-tui.mjs:1570、server/probe-tui-tools.mjs 3 处 —— 全部 1.11.1（TUI VER 仍 2.0.0）。
2. **打包产物**：
   - 构建 258.8 MB / 3,451 文件（比 v1.11.0 多 3 个许可文件；app\ 已含 LICENSE/NOTICE/THIRD_PARTY_NOTICES）
   - `dist\QingYaoTP-AILauncher-v1.11.1.zip` **127,971,996 B / 122.0 MB / 3,951 条目**
   - SHA256 `DECCBAE48D7CF23BF4879A60AC43EFA6F24790AF35AC198B5C1E356D0FFE213C`
   - zip 自检：无 app/llama、无 cloud-review 数据、config 已消毒（modelDir/autoLoad 空）、包内 APP_VERSION=1.11.1、app\README=仓库 README 同哈希
3. **dist 已换 v1.11.1 并运行**：8099 / health ok / v1.11.1 / 4B ctx=16384 / 视觉增强包 source=pack 53 文件；旧 dist 备份在 `dist\QingYaoTP AILauncher.v1.11.0.bak`。
4. **全量回归（源码实例）**：70 条跑完 **68 PASS + 2 环境红**（probe-ui-web 38/39、probe-web-tools 15/19）→ 隔离复跑 **ui-web 39/39、web-tools 19/19 全过 = 有效 70/70**；证据 `server\docs\probe-full-2026-11-24-v111\`（summary/logs/rerun）。
5. README.md / README-技术版.md 已更新到 v1.11.1（版本行、3,951 条目、3,451 文件、看门狗说明）；`.github\RELEASE-v1.11.1.md` 已起草（含下载表与 SHA）。
6. 发布脚本已备好：`server\docs\packaging-2026-11-24-v111\create-release.mjs`（TAG v1.11.1，两个附件）。

## 明天要做（按顺序）

1. **发布包冒烟**（dist 实例）：`server\docs\packaging-2026-11-24-v111\run-smoke.ps1`（version/debug/readme/window-ui/panel-v2/code-review-stream/watchdog）→ 结果填进 RELEASE-v1.11.1.md 两处「待填」。
2. **文档收口**：日志第八十六节、交接文档/新会话启动词加 v1.11.1、`.github\RELEASE-v1.11.1.md` 数字核对；确认 git diff 只含允许文件（勿提交 dist/tmp/bak/ui-new 等）。
3. **Git**：commit（7 个修改 + 证据目录 + RELEASE 文档）→ `git tag v1.11.1` → push main + tag（SSH over 443）。
4. **GitHub Release**：需要 **GH_TOKEN**（本会话没有；上次用环境变量）→ `$env:GH_TOKEN=...` 后跑 create-release.mjs；或用户网页手动创建并上传两个 zip。
5. **清理**：`dist\QingYaoTP AILauncher.v1.11.0.bak`（确认新版稳定后删）、`server\docs\ui-new\`（隔离复跑截图产物）、临时目录。

## 回滚

若 v1.11.1 dist 有问题：先 `--stop` + 杀常驻 launcher，把 `QingYaoTP AILauncher.v1.11.0.bak` 改回 `QingYaoTP AILauncher`，再双击启动（v1.11.0 launcher）。

## 机器状态

8099 正在跑 v1.11.1 dist 实例（launcher + node 各 1，4B/16K）；机器重启后双击 `dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe` 即可。
## 最新状态（2026-11-25 深夜）

- 全量 70 条已跑（有效 70/70，2 条环境红隔离复跑全过）。
- 发布包冒烟已跑：5 项全绿；readme/panel-v2 因本机 node 写 workspace EPERM 未过（环境限制，非包缺陷）。
- RELEASE-v1.11.1.md 已填好；RESULT.md 在 `server\docs\packaging-2026-11-24-v111\`；Git tag/push 与 GitHub Release 在本轮收口执行（Release 需 GH_TOKEN）。

