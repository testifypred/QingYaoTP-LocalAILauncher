# 完整打包 + technique/05 自检结果（2026-11-01 轮）

- 执行人：packager（team task-2）
- 时间：2026-11-01 11:04:11 → 11:06:03（打包 19.7s；起服务+等模型 29.7s；自检约 1.5 分钟）
- 结论：**打包成功，12/12 自检项全绿，两条探针全绿（probe-debug 25/25、probe-rag 16/16），发布包保持运行。**
- 证据目录：`D:\LocalModels\server\docs\packaging-2026-11-01\`

## 一、环境

| 项 | 值 |
|---|---|
| 系统 | Microsoft Windows NT 10.0.26200.0 |
| 打包 shell | Windows PowerShell 5.1.26100.9711（独立 `powershell.exe` 子进程，PID 4208） |
| 打包脚本 | `D:\LocalModels\server\build-portable.ps1`（未改动；BOM `EF BB BF` 在；5.1 Parser 复验 0 错误） |
| 源码 | git HEAD `d3d79c2`，工作区干净（`git status --porcelain` 0 行） |
| 随包 Node | `runtime\node.exe` = v24.19.0 |
| 机器 | 22 核 / 31.4 GB 内存；D: 空闲 303.5 GB |
| 打包前状态 | 8099、9333 无监听；无 启动本地AI / msedgewebview2 / DebugTool / node（`*LocalAI*`）进程；`dist\LocalAI\data` 实测可写（见 `prebuild.txt`） |

> 执行方式说明：为让 `Write-Host`（信息流）也落盘，用独立 5.1 子进程包了一层 `Start-Transcript`：
> `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Transcript …; & 'build-portable.ps1'; exit $LASTEXITCODE"`。
> 脚本本体在全新 5.1 进程中执行（非当前会话复用），输出与 `-File` 等价，完整日志见 `build.out.txt`。

## 二、产物

| 指标 | 值 |
|---|---|
| 体积（不含 data\） | **258.1 MB**（app\ 144.1 MB）——与基线 258.1 MB 一致 |
| 文件数（刚打完、logs 空、无 pid） | **3442** |
| 文件数（起服务后） | **3445** = 3442 + `logs\app.log` + `logs\launcher.log` + `app\server.pid`（运行期文件 3 个，见下方说明） |
| data\（运行期缓存，打包时被备份/还原） | 165.7 MB，保留 `webview2`、`webview2-debug` |

口径说明（**不是缺文件**）：
- 任务书基线 3444 = 上一版 dist「新包 3442 + logs 2 个运行期日志」（当时服务已停，故无 `app\server.pid`）。
- 文档里的 3439 = 3444 − 5 个调试工具文件（`debug.html`、`localai-debug.mjs`、`localai-debug.cmd`、`debug-icon-64.png`、`debug.ico`），即调试工具进打包清单之前的旧基线。
- 本次新包 3442（logs 空）+ 起服务后 3 个运行期文件 = 3445；与旧 dist 逐文件对照结果一致（旧 dist `app\` 无 server 之外的多余文件）。

## 三、逐项自检（12/12 绿）

| # | 检查项 | 结果 | 判据/关键证据 | 证据文件 |
|---|---|---|---|---|
| 1 | 打包执行与退出码 | 🟢 | `BUILD_EXIT=0`；8 个步骤全部执行，含 `==> 编译调试工具（独立窗口 + 自己的 ico）`（build.out.txt L28）；无 `!!`/`调试工具编译失败`；耗时 **19.7s**；末行 `完成：D:\LocalModels\dist\LocalAI` | `build.out.txt`（39 行） |
| 2 | 打包前应用全停 | 🟢 | 8099/9333 无监听；`*LocalAI*` 相关进程数 0；`data\` 可写；旧产物基线 258.1MB/3444 | `prebuild.txt` |
| 3 | 产物体积/文件数 | 🟢 | 258.1 MB / 3442（新包）；起服务后 3445；app\ 144.1 MB | `verify.txt` |
| 4 | app\ 关键文件齐 | 🟢 | app.mjs、app.html、doc-extract.mjs、debug.html、localai-debug.mjs、localai-debug.cmd、debug-icon-64.png、debug.ico 全在；根 localai.ico、DebugTool.exe、启动本地AI.exe、runtime\node.exe、config.ini、使用说明.txt、3 个 WebView2 DLL、vc_redist.x64.exe 全在；plugins\*.mjs=3；vendor\katex 与 app\node_modules\node-llama-cpp 在（node_modules 41 包） | `verify.txt` |
| 5 | 三份源码 SHA256 一致 | 🟢 | 3/3 一致：app.mjs `0B658397E640DC96…`、app.html `2755FCD549E26155…`、doc-extract.mjs `9E08B87B04751950…`（dist 与 server 相同） | `verify.txt` |
| 6 | DebugTool.exe 真编译过 | 🟢 | 42,496 B，修改时间 **2026-11-01 11:04:29**（本次打包），MZ 头 `4D 5A`；启动器 57,344 B 同一时刻重编；build.out.txt 有该步骤行 | `verify.txt` + `build.out.txt` |
| 7 | 启动发布包 + /api/state | 🟢 | `Start-Process dist\LocalAI\启动本地AI.exe` 后 29.7s 就绪；GET /api/state **HTTP 200**；`loaded=qwen2.5-7b-instruct-1m-q4_k_m.gguf`、context=16384、gpu=vulkan、layers=29、loading=false、error 空 | `state.json` + `logs\app.log` |
| 8 | 跑的是发布包而非源码 | 🟢 | /api/version `dir=D:\LocalModels\dist\LocalAI\app`、pid=20084、port=8099、node=v24.19.0、version=1.0.0 | `state.json` |
| 9 | 调试工具三条接口 + 令牌 | 🟢 | GET /debug → 200（text/html，12456 B，含 “Debugging Tool”）；GET /debug-icon.png → 200（image/png，3371 B）；GET /debug-icon.ico → 200（image/x-icon，33273 B）；无令牌 POST /api/debug/open → **403** | `http.txt` |
| 10 | probe-debug | 🟢 | `node probe-debug.mjs http://127.0.0.1:8099` → **RESULT 25/25**，exit 0 | `probe-debug.out.txt` |
| 11 | probe-rag | 🟢 | `node probe-rag.mjs http://127.0.0.1:8099` → **16 通过 / 0 失败**，exit 0，0.9s；自复位确认：`workspace\rag-probe` 已删、RAG `files=2`（与跑前相同） | `probe-rag.out.txt` |
| 12 | 包内 CLI 冒烟（加验） | 🟢 | `dist\LocalAI\app\localai-debug.cmd` exit 0（走包内 `..\runtime\node.exe`，17 项检查全 ok，含「发布包与源码 — 三份文件哈希一致」）；`localai.cmd models` exit 0（5 个模型，当前 qwen2.5-7b） | `cli-smoke.txt` |

## 四、观察与备注（均非失败）

1. **`/api/version` 的 `source=mtime`、`builtAt=2026-11-01T02:26:06Z`（= 本地 10:26:06）**：发布包 `app\` 不在 git 跟踪内，按约定构建标识回落为文件 mtime；且 `Copy-Item` 保留了源文件时间，故 builtAt 是 `server\app.mjs` 的修改时间而不是本次打包时间（11:04）。属既定行为，不影响功能；若需要「打包时间」可后续另议（本轮不改代码）。
2. **文件数 3442 / 3445 与基线 3444 的口径**：见「二、产物」说明，三个运行期文件（2 个 log + server.pid）导致起服务后 +3；没有任何清单内文件缺失。
3. **`localai.cmd models` 输出末行在 PowerShell 里显示为 `NativeCommandError`**：`2>&1` 合并时 PowerShell 对 cmd 的 stderr 行的呈现方式，`$LASTEXITCODE=0`，内容正常（5 个模型 + 当前已加载），不是失败。
4. **未实际弹出 DebugTool.exe 窗口**：自检只验证 exe 与三条接口（避免多开窗口）；包内 `localai-debug.cmd` 已验证可跑，`POST /api/debug/open` 的令牌校验已验 403。
5. **probe-rag 会重建 RAG 索引**（探针自带自复位）：跑完索引仍是 2 个文件 / 8 段，与跑前一致；`workspace\sessions` 未被触碰（1 个会话，10842 B）。
6. 打包时脚本按设计把 `data\` 备份到 TEMP 再还原，`webview2`、`webview2-debug` 均保留，界面 localStorage 不丢。

## 五、最终状态（收尾）

| 项 | 值 |
|---|---|
| 发布包 | **保持运行**（启动器方式） |
| 启动器 | PID 7560 `启动本地AI.exe` + 6 个 msedgewebview2（内嵌窗口正常打开） |
| 服务 | PID 20084 `node.exe`，127.0.0.1:8099，`/api/state` **200** |
| 模型 | `loaded=qwen2.5-7b-instruct-1m-q4_k_m.gguf`，context 16384，gpu=vulkan，loading=false，error 空 |
| /api/version | `dir=D:\LocalModels\dist\LocalAI\app`，version=1.0.0，node=v24.19.0 |
| 桌面快捷方式 | `C:\Users\lenovo\Desktop\本地 AI.lnk` → `D:\LocalModels\dist\LocalAI\启动本地AI.exe`，icon=`localai.ico,0`（双击即可用） |

## 六、证据文件

| 文件 | 内容 |
|---|---|
| `build.out.txt` | 打包完整 transcript（39 行，UTF-8 BOM），含 8 个步骤与合计 |
| `prebuild.txt` | 打包前：端口/进程/data 可写/旧基线/git HEAD |
| `verify.txt` | 产物体积文件数、关键文件清单、三份 SHA256、DebugTool.exe 元数据、config.ini、runtime 版本 |
| `state.json` | 起服务后 /api/state 精简 + 完整 /api/version |
| `http.txt` | /debug、/debug-icon.png、/debug-icon.ico、无令牌 /api/debug/open 状态码与 content-type |
| `probe-debug.out.txt` / `probe-rag.out.txt` | 两条探针完整输出与 RESULT 行 |
| `cli-smoke.txt` | 包内 localai-debug.cmd / localai.cmd 冒烟 |

## 七、约束遵守

- 未改源码、未改 `build-portable.ps1`、未手改 dist 产物（dist 只由脚本生成）；未 git commit（由 Lead 统一提交）。
- 只写了 `dist\LocalAI\`（脚本产物）与 `server\docs\packaging-2026-11-01\`。
- 未触碰 `workspace\`（probe-rag 自带临时目录与自复位除外）；未停/未重启用户之外的进程。
