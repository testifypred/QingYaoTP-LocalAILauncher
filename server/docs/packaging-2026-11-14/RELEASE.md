# v1.4.0 打包与冒烟（2026-11-14 / 15）

> 本轮把 11-10 / 11-11 / 11-12 三个已进源码的功能（Debugging Tool v2 / 下载进度条 / 删除模型）第一次做进交付包。产品代码只改版本号。

## 版本

| 位置 | 值 |
|---|---|
| `server\app.mjs` `APP_VERSION` | 1.4.0 |
| `server\package.json` `version` | 1.4.0 |
| `server\localai.mjs` `VERSION` | 1.4.0 |
| `server\make-zip.ps1`（`$Zip` / `$RootName`） | v1.4.0 |

## 构建

| 项 | 值 |
|---|---|
| 命令 | `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1` |
| 耗时 / 退出码 | **23.7s / exit 0**（8 步全过，含编译 DebugTool.exe） |
| 发布包 | **359.5MB / 3498 文件**（`app\` 245.5MB；`app\llama\` 101MB；`data\` 168.8MB 运行期缓存不计载荷） |
| 交付 zip | `dist\QingYaoTP-AILauncher-v1.4.0.zip` = **166,235,420 B / 158.5MB / 3999 条目 / 101.2s** |
| SHA256 | `35D6B656C66506740F7C4C1D658D33B3BE371B82C124DA9EF931585CF4BA0194` |

## 自检（`verify.txt`）

- 六份源码↔dist 哈希一致：app.mjs / app.html / doc-extract.mjs / debug.html / localai-debug.mjs / diag-zip.mjs
- `app\` 关键文件齐（含 doc-extract.mjs、config-recommend.mjs、debug-icon-64.png、package.json）
- 根目录：`QingYaoTP AILauncher.exe` 57,856B、`DebugTool.exe` 42,496B、`localai.ico`、`config.ini`、`使用说明.txt`
- `app\llama\` 54 个文件（llama-server.exe 壳 + llama-server-impl.dll + ggml-vulkan.dll + mtmd.dll ≈101MB）
- zip 条目：全部带 `QingYaoTP AILauncher-v1.4.0/` 前缀；反斜杠 0；`.pid/.log/.tmp` 0；gguf/mmproj 0；`data`/`logs` 无实际文件
- zip 内 `config.ini`：`modelDir=`/`autoLoad=`/`vkDevices=`/`visionModel=`/`visionMmproj=` 全空，全文无 `D:\LocalModels`
- zip 内 `app/app.html`(363,045B) / `app/debug.html`(39,603B) / `app/app.mjs`(339,143B) / `app/package.json`(304B) 与 dist **哈希相同**
- 解压到空目录：3498 文件、关键文件齐、`runtime\node.exe --check app\app.mjs` **exit 0**
- 三功能标志物：`id="delModelModal"`、`id="dlWrap"`、`id="filterErr"`、`id="exportBtn"` 均在包内

## 发布包冒烟（`release-*.txt`）

| 项 | 结果 |
|---|---|
| `probe-version`（指向包内 app.mjs） | **14/14**（pkg=1.4.0） |
| `probe-debug`（发布包） | **54/54**，含 CLI `--history` / `--export`（19,142B zip）/ `--watch` 两轮 |
| `/api/diag` | `checks` **23 项**，error 0 / warn 0 |
| HTTP | `/` 200 363045B · `/debug` 200 39603B · `/api/version` · `/api/state` · `/api/gpus` · `/api/plugins` · `/api/download/state` · `/debug-icon.png`（3371B） 全 200 |
| 无令牌 `POST /api/debug/open` | **403** |

## 运行态

- 本机 dist 运行目录的 `config.ini` 被打包脚本重置成默认，已改回 `modelDir=D:\LocalModels`，重启后 v1.4.0 / 5 模型 / 8 会话 / gpu=vulkan / 未加载模型。
- 55 条回归见 `server\docs\probe-full-2026-11-14-r2\RESULT.md`。
