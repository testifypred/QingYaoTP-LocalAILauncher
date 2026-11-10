# Debugging Tool v2 · 结果（2026-11-10）

> 提交 `4c698c6`（13 文件 / +2128）；版本号**仍是 1.3.1**，**未重打 dist zip**。
> 契约见同目录 [CONTRACT.md](CONTRACT.md)；正文说明见 [technique\08-调试工具.md](../../../technique/08-调试工具.md)；时间流水见 DeveloperRealtimeLog 第五十三节。

## 一、改了什么

| 层 | 内容 | 文件 |
|---|---|---|
| 后端 | 6 个新检查项：`config` / `vision` / `backup`（修掉 `backupConfig` 未定义的老 bug）/ `ragfresh` / `logs` / `webview2`；`dist` 检查扩到 **6 份**文件 | `server\app.mjs` |
| 后端 | 诊断历史：`logs\diag-history.jsonl`，节流写入（启动后首次 / 任一 level 变化 / 距上次 ≥10 分钟），最多 500 行；进程内 `since/changedAt/streak`，启动时读尾部延续 | `server\app.mjs` |
| 后端 | 导出诊断包：`POST /api/diag/export`（令牌 → store zip）；**零依赖**模块 `zipStore` + `crc32` | `server\app.mjs`、`server\diag-zip.mjs`（新） |
| 后端 | 打开目录：`POST /api/diag/open-path`（令牌；白名单 5 个；非法 400） | `server\app.mjs` |
| 页面 | 3 个过滤 chip（带计数）/ 6 组分组 / 「已持续 N 分钟」徽标 / 2 分钟内变化高亮 / 每项复制键 / `#exportBtn` / 历史卡（sparkline + ≤6 条变更）/ 三个开目录键；5s–2s–30s 轮询只在可见标签页跑 | `server\debug.html` |
| CLI | `--export [目录]` / `--open <名字>` / `--history [小时]` / `--watch [秒] [--cycles N]`；原有文本 / `--json` / `--ui` / `--logs` 与退出码不变 | `server\localai-debug.mjs`、`server\localai-debug.cmd` |
| 打包 | `diag-zip.mjs` 补进依赖清单 + 复制清单**两处** | `server\build-portable.ps1`（L47 / L114） |
| 探针 | 接口 35 → **54** 条、界面 → **33** 条（含新契约断言、CLI 三条新命令、export/open-path 边界） | `server\probe-debug.mjs`、`server\probe-ui-debug.mjs` |

未动：`DebugTool.exe`（C# WebView2 宿主）、主界面 `app.html`、聊天主链路。dist 运行目录已同步，六份文件哈希 **6/6 MATCH**。

## 二、接口契约

| 方法 | 路径 | 契约 |
|---|---|---|
| GET | `/api/diag` | `checks[]` **23 项**（未加载模型；加载后 +kv/kvquant，按环境 24–25），每项 `{id,level,title,detail,fix,group,since,changedAt,streak}`；附 `history{points,since,changes}` 与 `vision/backup/config` 对象区 |
| GET | `/api/diag/history?hours=24&limit=200` | 只读、无需令牌 → `{file,exists,total,hours,points[{t,e,w,o,l}],changes[{t,id,title,from,to}]}` |
| POST | `/api/diag/export` | 需 `x-local-token`（无 → **403**）→ `application/zip` + `content-disposition: attachment; filename="qy-diagnostics-YYYYMMDD-HHMMSS.zip"`；**store（不压缩）**；条目 `README.txt / REPORT.txt / diag.json / manifest.json / logs/app.tail.txt`（有崩溃/视觉日志时加 `logs/crash.log` / `logs/vision.tail.txt`）`/ config.ini.sanitized` |
| POST | `/api/diag/open-path` | 需令牌（无 → 403）；body `{which}` ∈ `dir｜logs｜modelDir｜sessions｜workspace`，白名单外 → **400**；成功 → `{ok,which,path}`（`explorer.exe`） |
| — | `dist` 检查 | `app.mjs / app.html / doc-extract.mjs / debug.html / localai-debug.mjs / diag-zip.mjs` 六份哈希一致 → ok |

## 三、探针结果（数字来自实测输出，非估算）

| 探针 | dev（`node app.mjs`） | 发布包（exe，8099，未加载模型） | 证据（同目录） |
|---|---|---|---|
| `probe-debug` | **54/54** | **54/54** | `probe-debug.out.txt` / `release-probe-debug.out.txt` |
| `probe-ui-debug` | **33/33** | **33/33** | `probe-ui-debug.out.txt` / `release-probe-ui-debug.out.txt` |
| `probe-firstrun` | **22/22** | —（本轮只在 dev 跑） | `probe-firstrun.out.txt` |
| `probe-version` | **14/14** | —（本轮只在 dev 跑） | `probe-version.out.txt` |

**断言口径 763 → 792**（763 − 58 + 87：`probe-debug` 35→54、`probe-ui-debug` 按口径 23→33）。

关键现场数字：

- dev：`/api/diag` checks=**23**、summary `{e0,w2,o21}`、history points=8、export **38637 B**、open-path 非法 which **400**。
- 发布包：`/debug` HTTP 200、`debug.html` **39603 B**（探针报响应 36681 B），新 UI 在（`#filterErr`/`#exportBtn`/`#histCard`）；`/api/diag` **23 项**（e0；探针当刻 w2/o21，界面另有 w3/o20 的快照，warn 数随现场）、`dist` 检查「六份文件哈希一致」、history 200、export **20680 B**、open-path 非法 which **400**。
- 历史文件两份各自独立：dev `D:\LocalModels\logs\diag-history.jsonl`、发布包 `<安装目录>\logs\diag-history.jsonl`。

## 四、偏差与取舍

| 取舍 | 为什么 |
|---|---|
| **诊断包用 store（不压缩）** | 项目从第一天零依赖；store zip 只有「本地头 + 数据 + 中央目录 + EOCD」，CRC32 自己算。实测 dev 38 KB / 发布包 20 KB，够小；Windows 资源管理器 / 7-Zip / `Expand-Archive` 都能开。要更小得上压缩库，与零依赖冲突，暂不做 |
| **`DebugTool.exe` 本轮未改** | 它只是 WebView2 宿主，页面升级自动生效；v2 没有要动宿主的需求（导出现在走页面按钮 + CLI） |
| **发布包内没有历史** | 打包排除 `logs\`，所以交付包里没有历史文件；发布包的历史从首次启动才开始记。这是有意的（历史是本机运行数据，不入包） |
| **探针 UI 走的是品牌分支，不是回退分支** | 两轮都 **33/33**：本机 `loaded` 为空，但 headless Edge profile 的 localStorage 里 `selected` 有值（`DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf`），所以品牌图标断言拿到 `/vendor/models/deepseek.png` 并通过；只有「没加载也没选中」时才走回退标记 ∫，那一分支是 **31 条**，本轮两轮都没走到——别把 31 写成实测量。证据：release-probe-ui-debug.out.txt 的 `loaded=— · selected=DeepSeek-…` |
| **口径记账与源码 `ok()` 处数有历史差** | 交接文档长期把 `probe-ui-debug` 记成 23 条，源码实际有 25 处 `ok()`；本轮口径按 58 → 87 记账（`4c698c6` 的合同口径），**结论只认真实输出 33/33**。下次动这条探针时以源码处数为准重记一次 |
| **`builtAt` 会被 dist 同步刷新** | 发布包 `/api/version` 的 `builtAt` 显示 2026-11-10 15:18（dist 文件不被 git 跟踪 → 回退取文件时间），**不代表重打了包**；交付 zip 仍是 11-08 那份 |

## 五、证据清单

| 证据 | 位置 |
|---|---|
| 本轮契约 | `server\docs\feature-debugtool-v2-2026-11-10\CONTRACT.md` |
| dev 探针原始输出（4 份） | 同目录 `probe-debug.out.txt` / `probe-ui-debug.out.txt` / `probe-firstrun.out.txt` / `probe-version.out.txt` |
| 发布包探针原始输出（2 份） | 同目录 `release-probe-debug.out.txt` / `release-probe-ui-debug.out.txt`（23:23，目标 8099 起的是 `dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe`） |
| 截图（**本地证据，不入库**） | `debug-tool-v2-release.png`（发布包，1440×2200）/ `debug-tool-v2-dev-1440.png`（dev 1440px）/ `debug-tool-v2-narrow-900.png`（900px 单列不溢出）；`.gitignore` 第 28 行 `server/docs/**/*.png` 把截图排除在外，提交里没有它们 |
| 代码落点 | `server\app.mjs`、`server\diag-zip.mjs`、`server\debug.html`、`server\localai-debug.mjs`、`server\localai-debug.cmd`、`server\probe-debug.mjs`、`server\probe-ui-debug.mjs`、`server\build-portable.ps1` |
| 提交 | `4c698c6`（13 文件 / +2128） |
| 文档 | DeveloperRealtimeLog 第五十三节、`technique\08-调试工具.md`、`交接文档.md`、`新会话启动词.md` |

复跑命令：

```powershell
node server\probe-debug.mjs http://127.0.0.1:8099
node server\probe-ui-debug.mjs http://127.0.0.1:9333 http://127.0.0.1:8099
node server\probe-firstrun.mjs http://127.0.0.1:8099
node server\probe-version.mjs http://127.0.0.1:8099
```

## 六、下一轮建议

1. **打包 v1.4.0 + 重打交付 zip，并跑一遍全量 53 条**（第一件事）：现在交付 zip 里没有 v2；升三处版本号 → `build-portable.ps1` + `make-zip.ps1` → 包内自检 `diag-zip.mjs` 在不在、`/api/diag` 是否 23 项、`/debug` 是否新 UI；然后用 `server\docs\run-full.ps1` 整跑 **53 条**，确认本轮新增的 29 条断言没把别的探针挤红（口径应为 **792**）。
2. **历史视图再进一步**（~2h）：现在卡片只给 24 小时 + 最近 ≤6 条变更；可按项筛选、按天看，或在导出包里附 `history.csv`。
3. **新检查项候选**：TTS/语音依赖、下载器状态（4MB 上限与断点）、端口占用历史、`build-portable.ps1` 清单与实际包文件数对账。
4. **`dist` 检查扩面**：把 `localai.mjs` / `localai-tui.mjs` / `package.json` 也纳入哈希对账（本轮只覆盖 6 份）。
5. **`DebugTool.exe` 加「导出诊断包」按钮**（可选）：现在是页面按钮 + CLI；给不想开页面的人一个一键入口，但要重编译 exe。
