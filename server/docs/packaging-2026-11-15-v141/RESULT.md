# v1.4.1 可移植性整改 · 验证记录（2026-11-15）

## 结论

打包 / 交付 zip / 服务端默认目录 / 开发脚本 / ASR / 图标脚本 / 7 个探针里写死的盘符与版本号，全部改成「由脚本位置推导 + 参数或环境变量覆盖」。
**异地构建已实证**：换工作目录、换输出目录、无绝对路径入参，产物与仓库内构建一致。

## 一、异地构建实证

| 项 | 仓库内构建 | 异地构建（本项证明） |
|---|---|---|
| 工作目录 | `D:\LocalModels\server` | **`C:\`** |
| 输出目录 | 默认（脚本推导） | **`%TEMP%\qytp-portable\dist\QingYaoTP AILauncher`** |
| 绝对路径入参 | 无 | **无** |
| 结果 | exit 0 / 359.5MB / 3498 文件 | **exit 0 / 12.0s / 359.5MB / 3498 文件** |
| 逐文件对照 | — | 文件名集合一致、大小一致（差异仅版本号与运行期文件 `server.pid`/`discovery.json`/`config.ini`） |
| `runtime\node.exe` | 92,825,416B | **92,825,416B** |

## 二、修复的真缺陷：包里的 node 曾是 120 字节

`Get-Command node` 在本机命中的是 DSH 的 **`node.cmd` 垫片（120 字节）**（内容里设 `ELECTRON_RUN_AS_NODE=1` 转去跑 DSH Desktop.exe）。
旧逻辑直接复制它的 `Source`，于是 `runtime\node.exe` 会是一个 120 字节的文本/批处理文件——**装到目标机双击必然起不来**。
新逻辑：候选列表 → 过滤「真 `.exe` 且 > 1MB」，本机落到 `D:\Node.js\node.exe`。

## 三、改动的文件

| 文件 | 改动要点 |
|---|---|
| `server\build-portable.ps1` | OutDir/Icon 空默认→脚本推导；csc 由 `$env:WINDIR` 推导；node 多候选发现（.exe + >1MB）；安全闸改为「目录名必须是 QingYaoTP AILauncher 且非盘根/用户目录」 |
| `server\make-zip.ps1` | 路径由脚本推导；**版本从 app.mjs 解析**（zip 名 + 根目录名） |
| `server\app.mjs` | `MODEL_DIR` 默认 `path.resolve(HERE,"..")`；嗅探候选改 `driveRoots()` 动态生成 |
| `server\app.html` | 首启文案去掉 `D:\LocalModels` |
| `server\run-server.cmd` / `server\启动本地AI.bat` | `%~dp0` 相对 + node/Edge 探测 |
| `asr\fetch-model.mjs` | 下载到脚本同级 `deps\`（`ASR_DIR` 可覆盖） |
| `server\make-icon.ps1` / `make-model-icons.py` | 输出目录脚本内相对；源图改命令行传入 |
| 探针 ×7 | `probe-version`/`probe-debug`/`probe-backup`/`probe-ui-backup`/`probe-rag`/`probe-discover`/`probe-ui-discover` 默认值改为脚本相对 / 系统临时目录 / `PROBE_FIXTURE_ROOT` |

## 四、冒烟与回归

| 项 | 结果 |
|---|---|
| 开发态默认目录（不设 MODEL_DIR，PORT=8098 裸跑） | `/api/state.modelDir = D:\LocalModels`，models=5 |
| 嗅探候选 | `common` 不再含硬编码 `D:\Models`/`D:\AI`（本机本就不存在） |
| 包内 `probe-version` | **14/14**（pkg=1.4.1） |
| 包内 `probe-debug` | **54/54** |
| `probe-backup`（默认目标改临时目录） | **38/38** |
| `probe-rag`（回退目录改临时目录） | **16/16** |
| 源码↔dist | `app.mjs` / `app.html` **SAME** |
| 发布包运行 | v1.4.1 / 5 模型 / 8 会话 / gpu=vulkan |

## 五、产物

- 交付 zip：`dist\QingYaoTP-AILauncher-v1.4.1.zip` = **166,235,868 B / 158.5MB / 3999 条目 / 69.0s**
- SHA256：`C3ED469F71484CC947F432B9A9931BD9F39EE1767C21D2E9B6C2E83D5467925C`
- v1.4.0 的 zip 保留作历史

## 六、已知残留（不影响产品）

`server\compare.mjs`、`probe.mjs`、`probe-metrics.mjs`、`probe-template.mjs`、`probe-thinking.mjs`、`probe-tools{,2,3}.mjs`、`server.mjs` 等早期草稿脚本里仍有 `D:\LocalModels\*.gguf` 字面量（其中几个引用的 qwen2.5-7b 已删除）；`server\backup\*.bak` 是 10-18 的旧备份。均不在 55 条全量驱动内。
