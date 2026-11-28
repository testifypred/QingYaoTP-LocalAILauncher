# v1.11.2 首轮打包与 zip 自检（第一包，2026-11-28）

> **口径**：本目录记录的是 **v1.11.2 首轮（第一包）** 实测数字。Lead 回填 README 后需要**重新打包第二包**（zip 字节/条目/SHA 会变），本包**不作为最终发布包**。
> 本轮只执行 build-portable + make-zip + zip 自检；未跑冒烟、未做 git 写操作、未改源码/探针/文档。

## 一、版本（包内实测）

| 位置 | 值 |
|---|---|
| `app\app.mjs` `APP_VERSION` | **1.11.2** |
| `app\package.json` `version` | **1.11.2** |
| `app\localai-tui.mjs` `VER` | **2.0.0**（TUI 独立版本线，不变） |

## 二、构建（build-portable.ps1）

命令：`cd D:\LocalModels\server; powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1`

- 退出码 **0**；共 **8 步**（复制服务端/界面 → node-llama-cpp → TTS 依赖 → 视觉拆分 → Node 运行时 → 编译启动器 → 编译调试工具 → 写配置与说明）。
- 随包 node = `D:\Node.js\node.exe`（真 .exe，非垫片）；csc = `C:\WINDOWS\Microsoft.NET\Framework64\v4.0.30319\csc.exe`。
- 产物：**258.9 MB / 3,453 个文件**（不含 `data\`；app/ 144.9 MB）；另有 `data\` 137.7 MB（运行期缓存，build 时从 TEMP 保留还原）。
- 自检：**主包无 `app\llama`**（视觉已拆分；build 前 dist 里的 54 个视觉文件已被清除）。
- 启动器 `QingYaoTP AILauncher.exe` = **64,000 B**；`DebugTool.exe` = **42,496 B**（与 v1.11.1 一致）。
- 新增字体已入包：`app\vendor\fonts\noto-serif-sc\noto-serif-sc-subset.woff2`（**5,680 B**）、`OFL.txt`（**5,701 B**）。
- 源码↔dist **11/11 同哈希**：app.mjs / app.html / localai.mjs / localai-tui.mjs / package.json / vision-pack.mjs / doc-extract.mjs / code-review-multi.mjs / README.md / woff2 / OFL.txt。
- 本地 dist `config.ini` 被 build 重置（`modelDir=` / `autoLoad=`）——**预期**，本机如需运行 dist 实例要手填 modelDir。

## 三、交付 zip（make-zip.ps1）

命令：`cd D:\LocalModels\server; powershell -NoProfile -ExecutionPolicy Bypass -File .\make-zip.ps1`

- 版本（取自 app.mjs）：**1.11.2**
- 产物：`D:\LocalModels\dist\QingYaoTP-AILauncher-v1.11.2.zip`
- **127,986,742 B / 122.1 MB / 3,955 条目 / 98.2 s**
- **SHA256 `216BF9FF31345B390EC291EB234B1AEED50FED460312A4CEF028082A6BE0F88C`**
- 结构：3,453 文件 + 502 目录项 = 3,955；根目录 9 文件 + 6 目录（app/ data/ logs/ models/ plugins/ runtime/）；app/ 下 3,440 文件。
- 根目录 9 文件：config.ini、DebugTool.exe、localai.ico、Microsoft.Web.WebView2.Core.dll、Microsoft.Web.WebView2.WinForms.dll、QingYaoTP AILauncher.exe、vc_redist.x64.exe、WebView2Loader.dll、使用说明.txt。
- 脚本自检：**无 app/llama 条目**；无 data/cloud-review* 条目。

## 四、zip 手工自检（脚本只断言 2 条，其余本轮手工）

| 检查 | 判据 | 实测 |
|---|---|---|
| 条目数 | 约 3,955 | **3,955**（3453 文件 + 502 目录） |
| 前缀 | 全部以 `QingYaoTP AILauncher-v1.11.2/` 开头 | 无前缀条目 **0** |
| 反斜杠 | 0 | **0** |
| 临时前缀 | 无 `qytp-zip-` | **0** |
| 视觉 sidecar | 无 `app/llama/` | **0** |
| 云端配置 | 无 `data/cloud-review*` | **0** |
| data/ 文件 | 0（只允许空目录） | **0**；仅 `data/\` 目录项 |
| logs/ 文件 | 0（只允许空目录） | **0**；仅 `logs/\` 目录项 |
| models/ 运行数据 | 0（只允许空目录） | 根 `models/\` 空；`app/vendor/models/*.png` 4 个是品牌图标（既有资产，非运行数据） |
| `.pid` / `app\*.log` | 0 | **0** |
| 字体 | woff2 + OFL 两件在包内 | **两件均在**（5,680 B / 5,701 B，与源同哈希） |
| 许可 | `app/LICENSE`、`app/NOTICE`、`app/THIRD_PARTY_NOTICES.md` | **3/3 在** |
| config 消毒 | modelDir/autoLoad/vkDevices/visionModel/visionMmproj 空；无本机路径 | **全空**；无 `D:\LocalModels`、无 `LocalModels\mmproj` |
| config 云端三键 | cloudApiKey/cloudBaseURL/cloudModel 不出现或为空 | 模板里本就不含这三键（build 写出的 config 无 cloud 段） |
| 关键文件 | app.mjs/app.html/package.json/README.md/vision-pack/doc-extract/config-recommend/diag-zip/code-review-multi/localai*/debug*/runtime/node.exe | **全部在** |

## 五、与 v1.11.1 对照

| 项 | v1.11.1 | v1.11.2 首轮 | 差 |
|---|---|---|---|
| 发布目录 | 258.8 MB / 3,451 文件 | **258.9 MB / 3,453 文件** | +0.1 MB / **+2**（woff2 + OFL.txt） |
| 主包 zip | 127,971,996 B / 122.0 MB / 3,951 条目 | **127,986,742 B / 122.1 MB / 3,955 条目** | **+14,746 B / +4 条目**（+2 文件 +2 目录） |
| zip SHA256 | `DECCBAE48D7CF23BF4879A60AC43EFA6F24790AF35AC198B5C1E356D0FFE213C` | `216BF9FF31345B390EC291EB234B1AEED50FED460312A4CEF028082A6BE0F88C` | 全变（内容变更） |
| app 内 app.mjs / package.json | 1.11.1 / 1.11.1 | **1.11.2 / 1.11.2** | 对齐 |
| TUI VER | 2.0.0 | **2.0.0** | 不变 |
| 许可条目 | 3（app/） | 3（app/） | 不变 |

## 六、过程与环境

- 构建前：`dist\QingYaoTP AILauncher` 无 launcher/node 进程占用；dist 内有 `app\llama` 54 文件与 `data\cloud-review.json`（build 会删 llama、保留 data；zip 两者都不收，已自检）。
- **未停 8099**（Lead 指示：runtime-env-auditor 的源码实例与本任务无关、不干预）；本次未在其上做任何操作。
- 构建与打包之间未启动 dist 实例（避免 `models\workspace` 运行数据进包）。
- 构建日志摘录见 `build.out.txt`；打包日志见 `make-zip.out.txt`；zip 自检明细见 `zip-check.txt`。

## 七、下一步（第二包，Lead 负责）

1. README 回填本轮实测数字（zip 名/字节/条目/解压文件数/断言口径）；
2. 重新 `build-portable.ps1` + `make-zip.ps1`（保证包内 `app\README.md` = 仓库 README）；
3. 第二包再跑发布包冒烟（7 项，工作区外，`PROBE_SKIP_SWITCH=1`）；
4. 第二包 SHA/字节以最终重打实测为准，更新本目录或新建 `RESULT.md` 记录。

---

## 八、终版（第二轮 build+zip，README 回填后 · 2026-11-28 00:4x）

Lead 已按本文件第七节回填 README（v1.11.2 / 122.1 MB / 3,955 条目 / 258.9 MB / 3,453 文件 / 1,523 断言 / 「删」→垃圾桶图标 / 顶栏「调试」），随后**原地重跑** `build-portable.ps1` → `make-zip.ps1`（证据 `build2.out.txt` / `make-zip2.out.txt`）。

| 项 | 首轮（作废） | **终版（对外）** |
|---|---|---|
| 构建 | 258.9 MB / 3,453 文件 | **258.9 MB / 3,453 文件**（8 步全过、自检无 app\llama） |
| zip | 127,986,742 B / 3,955 条目 | **127,986,879 B（122.1 MB）/ 3,955 条目** |
| SHA256 | `216BF9FF…F88C` | **`646E6B58D1A3681186A6F4424C89204CB5A732786A84DEEAFE9C3F9846948DB0`** |
| 包内 app/README.md | 旧 | **与仓库 README 同哈希：17,598 B / `B2BCD26D3AC16EF1E50513BE428F471D56186DD80BA770B1703D89D5F0A44BC5`** |
| 包内版本 | 1.11.2 / TUI 2.0.0 | 同（app.mjs=1.11.2、package.json=1.11.2、TUI VER=2.0.0） |
| build→zip 间隔 | 未跑 dist 实例 | 同（未跑 dist 实例，models\workspace 未进包） |

- 终版自检沿用首轮全项（无 app/llama、无 data/cloud-review、/data/ 与 /logs/ 无文件、fonts woff2+OFL 在包、许可 3/3、config 8 键消毒无 `D:\LocalModels`），本次只重算字节/条目/SHA 并核对包内 README 同哈希。
- 下一步：发布包冒烟（工作区外解压终版 zip，7 项 244 断言）→ 通过后写 `.github/RELEASE-v1.11.2.md` 与日志；commit/tag/push/Release 等用户批准。

---

## 九、发布包冒烟（终版 zip，工作区外 · 2026-11-28 00:33–00:36）

**结论：7 项全绿 / 244 断言全过（0 FAIL），与 v1.11.1 同口径同结果。**

### 环境与步骤

1. 解压终版 zip 到**会话工作区之外**：`C:\Temp\qytp-v1112-smoke` → 安装目录 `C:\Temp\qytp-v1112-smoke\QingYaoTP AILauncher-v1.11.2`。实测 zip **127,986,879 B / 3,955 条目 / SHA256 `646E6B58D1A3681186A6F4424C89204CB5A732786A84DEEAFE9C3F9846948DB0`**（与交付一致），解压 **3,453 文件 / 6.6 s**。
2. 临时安装目录 `config.ini`：`modelDir=D:\LocalModels`（autoLoad 保持空）；其余为包内默认（port=8099、contextSize=16384、gpu=auto、vision 三项空）。
3. 默认方式启动 `QingYaoTP AILauncher.exe`（`Start-Process` 带 `-RedirectStandardOutput/-RedirectStandardError`，stdout/err 均为 0 B）；**/health 3.1 s 就绪**（`{"status":"ok","model":null,"context":0,"gpu":"vulkan"}`）。
4. 运行归属确认：launcher pid 26284 / node pid 20392，路径均在 `C:\Temp\...` 下（**不是** D:\LocalModels）。
5. `POST /api/load {"file":"qwen3-5-4B-Q4_K_M.gguf","contextSize":16384}` → **ok / context=16384 / layers=33 / 3.2 s**；随后 `/api/state` 确认 loaded=4B。
6. `PROBE_SKIP_SWITCH=1`，7 项顺序执行；probe-review-watchdog 自起的临时实例与 4B 硬链接自清理（源模型未动）。

### 结果（逐项）

| # | 探针 | 结果 | 断言 |
|---|---|---|---|
| 1 | probe-version（第 2 参数=包内 `app\app.mjs`） | RESULT 14/14 | 14 |
| 2 | probe-debug | RESULT 54/54 | 54 |
| 3 | probe-code-review-stream | 45 通过 / 0 失败（跳过 3：Phi 切换） | 45 |
| 4 | probe-readme | RESULT 21/21 | 21 |
| 5 | probe-code-window-ui | 10 通过 / 0 失败 | 10 |
| 6 | probe-code-panel-v2 | 44 通过 / 0 失败 | 44 |
| 7 | probe-review-watchdog | 56 通过 / 0 失败 | 56 |
| | **合计** | **244/244，0 FAIL** | **244** |

- probe-code-panel-v2 产出 2 张截图（`shots\probe-code-panel-v2-colors.png` / `-review.png`）。
- 包内版本对账：`app\app.mjs` = `const APP_VERSION = "1.11.2";`；`app\package.json` = `"version": "1.11.2",`；`app\vendor\fonts\noto-serif-sc\noto-serif-sc-subset.woff2` = 5,680 B（与源同值）。
- **EPERM 环境红未出现**（probe-readme / probe-code-panel-v2 均绿）——与「工作区外运行则绿」的既有判据一致。

### 与 v1.11.1 七项对照

| 探针 | v1.11.1 | v1.11.2 终版 |
|---|---|---|
| probe-version | 14/14 | 14/14 |
| probe-debug | 54/54 | 54/54 |
| probe-code-review-stream | 45/45（跳 3） | 45/45（跳 3） |
| probe-readme | 21/21 | 21/21 |
| probe-code-window-ui | 10/10 | 10/10 |
| probe-code-panel-v2 | 44/44 | 44/44 |
| probe-review-watchdog | 56/56 | 56/56 |
| **合计** | **244/244** | **244/244** |

### 证据 / 清理 / 判定

- 证据：`server\docs\packaging-2026-11-27-v1112\smoke\`（7 个 probe txt + `smoke-steps.txt` + `shots\` 2 张截图）。
- `smoke-steps.txt` 末尾附「corrected」汇总块：本机 harness 为 PS 5.1，脚本内 CJK 正则匹配不到日志里的「结果:」，原 SUMMARY 原样保留并附修正版本。
- 清理：`QingYaoTP AILauncher.exe --stop` exit=0 → 8099 **1.1 s 释放**；常驻 launcher 26284 随后强停；8099/9333 均 free；`C:\Temp\qytp-v1112-smoke` 与临时脚本已删；模型 `D:\LocalModels\qwen3-5-4B-Q4_K_M.gguf` **2,707,514,144 B 未变**；dist 未动、未重打包。
- 判定：**发布包冒烟通过**。v1.11.2 可进入 commit / tag v1.11.2 / push / GitHub Release（待用户批准）。
