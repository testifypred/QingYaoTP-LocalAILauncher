# v1.2.0 重打包 + 交付 zip（2026-11-07 第十一轮）

> 结论：发布包与交付 zip 已升到 **v1.2.0**（代码工作区 + 模型审查）。构建 8 步全过；258.2MB / 3443 文件；zip **121.8MB / 3943 条目**；独立复核见 `verify.md`。

## 一、为什么重打

本轮新增代码工作区（改 `app.mjs` +175 行、`app.html` +605 行），`APP_VERSION` 1.1.0 → 1.2.0，交付物必须重打；顺带修掉 `使用说明.txt` 里「默认指向 D:\LocalModels」的 v1.0 旧文案（改的是 `build-portable.ps1` 的 readme 模板）。

## 二、产物

| 项 | 值 |
|---|---|
| 发布目录 | `dist\QingYaoTP AILauncher`：258.2 MB / 3443 文件（app\ 144.2 MB；data\ 156.5 MB 运行期缓存另算） |
| **交付 zip** | `dist\QingYaoTP-AILauncher-v1.2.0.zip`：**127,767,661 B（121.8MB）/ 3943 条目** |
| zip SHA256 | `7E6DC404FCAF4477CCE4B5ED4F61CF30F9A69C1F5C20B98546616C5BAC6E3D72` |
| 启动器 / 调试 | 57,856 B / 42,496 B（本次重编，2026-11-07 11:24 前后） |
| 便携配置 | 包内 `config.ini`：`modelDir=` / `autoLoad=` / `vkDevices=` 全空，全文无 `D:\LocalModels` |
| 运行期文件 | 无 `.pid` / `.log` / `.tmp`；无 `data\` / `logs\` 实际文件；无 `models\workspace` 泄漏 |
| 使用说明 | 已改新文案「默认用本目录的 models\（把 gguf 放进去即可）」，不再写死本机路径 |
| 打包脚本 | `make-zip.ps1` 默认值升到 v1.2.0（zip 名与根目录 `QingYaoTP AILauncher-v1.2.0/`）；BOM + 5.1 Parser 复验 0 错误 |

## 三、自检（Lead 执行）

| 项 | 结果 |
|---|---|
| 构建 | 8 步全过、退出 0；`app\` 144.2 MB；启动器 57,856 B / DebugTool 42,496 B |
| 源码一致性 | `app.mjs` 262,620 B、`app.html` 298,897 B，与 `server\` 同字节（verifier 复核 SHA256） |
| zip 结构 | 3943 条目；全部以 `QingYaoTP AILauncher-v1.2.0/` 开头；正斜杠；反斜杠 0；无 `qytp-zip-` 前缀 |
| zip 卫生 | `.pid/.log/.tmp` = 0；data/logs 实际文件 = 0；本机绝对路径 = 0 |
| 运行发布包 | `/api/version` = **1.2.0**，`dir=dist\QingYaoTP AILauncher\app`，node v24.19.0，健康 200 |
| 版本三处一致 | `app.mjs` 的 `APP_VERSION`、`server\package.json`、`/api/version` 都是 1.2.0 |
| 独立复核 | `verify.md`（verifier：12 项 + 解压冒烟 + zip 内 cw* id/接口存在性） |

## 四、口径

- 打包产物 258.2 MB / 3443 文件（logs 空）；起服务后多 2 个 log + `app\server.pid`。
- zip 条目数 3943（与 v1.1.0 最终包一致；文件集变化主要是 app.mjs / app.html 变大）。
- 本机运行目录的 `config.ini` 收尾时改回 `modelDir=D:\LocalModels`（界面可见 5 个模型）；**zip 里保持留空**，两者分工不变。

## 四·补、独立复核结论（verifier，详见 `verify.md`）

- **12 项：11 🟢 + 1 🟡**。唯一的 🟡 是「dist 运行目录的 `config.ini` 现在是 `modelDir=D:\LocalModels`」——这是**有意为之**：交付 zip 于 11:25:21 打出时该文件仍是空值（`build-portable.ps1` 默认 `ModelDir=''`），随后为「用本机 5 个模型试跑」改成本机路径并重启启动器。**交付物 zip 侧是 🟢**（`modelDir=` 空、无盘符路径）。这不是缺陷，也不建议还原：还原后本机界面看不到 D:\LocalModels 下的模型与会话。
- 与 v1.1.0 zip 差异：**0 增 0 删**，仅 3 个条目尺寸变化（app.mjs 254,041→262,620、app.html 275,430→298,897、使用说明 4,946→4,939）。
- 发布包上复测模型审查：**72.0s / 1547 字 / contextSize=8192**，原始响应 `feature-code-workspace-2026-11-07/logs/review-api-raw.json`。

## 五、遗留

- 老笔记本真机验证、7B 分片下载：不变（见交接文档「下一步」）。
- 审查流式化：功能层下一轮（`feature-code-workspace-2026-11-07/RESULT.md`）。

## 六、证据

| 文件 | 内容 |
|---|---|
| `build.out.txt` | 打包 transcript（8 步） |
| `verify.md` + `verify-files\` | 独立复核 |
| `dist\QingYaoTP-AILauncher-v1.2.0.zip` | 交付物 |
