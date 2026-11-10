# Debugging Tool v2 · 升级契约（2026-11-10）

> 目标：把调试工具从「一次性体检快照」升级为**可交付的诊断工具**：
> 一眼看出哪一层坏了、问题从什么时候开始、怎么把现场交出去。
> 本轮**不改**主界面 app.html / 主程序聊天逻辑；只动调试工具这一条线。

## 一、背景事实（已实测，动手前先看）

- 当前 `/api/diag` 实际只有 **17 项**检查（加载模型时 19 项），文档写 18 项。
  **真 bug**：`app.mjs:349` 调用了不存在的 `backupConfig()` → ReferenceError 被空 `catch` 吞掉，
  「会话备份」检查项**从来没出现过**。本轮必须修掉，并由探针守住。
- 视觉 sidecar（v1.3.0/1.3.1 的主打能力）**完全没有**诊断项；发图 500 时只能翻日志。
- 没有历史：页面只有「此刻」，答不了「20 分钟前为什么变慢」。
- 没有导出：用户要交现场只能截图 + 口头描述。
- 开发服务：`node app.mjs`（已在跑，8099，v1.3.1）。真实工作区 8 个会话，**探针别清会话**。

## 二、文件所有权（只改自己那份，别越界）

| 谁 | 可写文件 |
|---|---|
| Lead | `server/app.mjs`、`server/diag-zip.mjs`（新建）、`server/build-portable.ps1`、本契约 |
| ui-debug | `server/debug.html` |
| cli-debug | `server/localai-debug.mjs`、`server/localai-debug.cmd` |
| probe-debug | `server/probe-debug.mjs`、`server/probe-ui-debug.mjs` |
| docs-debug | `technique/08-调试工具.md`、`DeveloperRealtimeLog.md`、`交接文档.md`、`新会话启动词.md` |

硬约束：零依赖（不装 npm 包）、日志只追加、协议面不动（`localai*` 命令名 / `LOCALAI_*` 环境变量 / `localai.*` localStorage）、
页面不许出现未捕获 JS 异常、中文文案 + 失败要归因到人话（每条检查都要有可照做的 `fix`）。

## 三、后端契约（Lead 实现）

### 1) `GET /api/diag` 返回体新增

```jsonc
{
  // …原有字段全部保留（now/version/server/model/system/paths/checks/summary）
  "checks": [{ "id": "vision", "level": "ok|warn|error", "title": "...", "detail": "...", "fix": "...",
               "group": "服务|系统|推理|数据|扩展|发布",
               "since": "2026-11-10T14:00:00.000Z",   // 处于当前 level 的起始时刻
               "changedAt": "2026-11-10T14:00:00.000Z", // 最近一次 level 变化时刻
               "streak": 12 }],                        // 连续同 level 的观测次数
  "history": { "points": 42, "since": "2026-11-09T22:00:00.000Z",
               "changes": [{ "t": "...", "id": "vision", "title": "视觉 sidecar", "from": "ok", "to": "warn" }] },
  "vision":  { /* = /api/vision/state 的公开字段子集：running/port/pairs/selected/note/context/idleExitSec/autoRestoreSec/error */ },
  "backup":  { "enabled": false, "dir": "", "lastRunAt": 0, "lastOk": null, "error": "" },
  "config":  { "file": "D:\\LocalModels\\config.ini", "exists": false, "modelDir": "", "port": "", "gpu": "",
               "vkDevices": "", "visionModel": "", "visionMmproj": "" }
}
```

新增检查项（id 固定，探针按 id 断言）：

| id | 组 | level 规则 | detail 要点 | fix 要点 |
|---|---|---|---|---|
| `config` | 系统 | 文件不存在 → ok（开发目录）；`visionModel/visionMmproj` 指定但文件不存在 → error；`port` 与实际端口不一致 → warn；`vkDevices` 序号 ≥ 设备数 → warn | config.ini 路径、modelDir（空=便携默认 → 实际 MODEL_DIR）、port/gpu/vkDevices | 一条一句 |
| `vision` | 推理 | 缺 `llama-server.exe` → error；没有可配对 mmproj → warn；运行中 → ok；未运行 → ok（+上次 error 升级 warn） | 8101 端口、运行/未运行、配对、上下文、闲置秒数、上次错误 | 缺组件 → 解压/重装；缺 mmproj → 放 `modelDir\mmproj`；500 → 看日志尾部 |
| `backup` | 数据 | 未开启 → warn；开启但上次失败 → warn；正常 → ok | 目录、最近成功时间（多久前）、间隔 | 设置 → 工具 → 会话备份 |
| `ragfresh` | 数据 | 无索引文件 → 不产出该检查项（rag 已覆盖）；索引存在但有更新文档 → warn | 索引构建时间、最新文档 mtime、差多少小时 | 点「重建文档索引」 |
| `logs` | 系统 | app.log > 50MB → warn，> 200MB → error；无日志文件 → ok（还没写过） | 路径/大小/最后写入 | 轮转/清理（可删旧内容，服务重启会新建） |
| `webview2` | 系统 | 探测不到 WebView2 运行时 → warn | 版本号或「未找到」 | 装 Evergreen WebView2 Runtime（主界面与调试窗口都要） |

`dist` 检查扩到 6 个文件：`app.mjs / app.html / doc-extract.mjs / debug.html / localai-debug.mjs / diag-zip.mjs`。

### 2) 诊断历史

- 文件：`<程序目录的上一级>\logs\diag-history.jsonl`（开发目录 = `D:\LocalModels\logs\`；发布包 = `<安装目录>\logs\`，make-zip 本就把 logs 内容排除，不入包）。
- 每行一条压缩记录：`{"t":"ISO","e":0,"w":2,"o":15,"l":{"vision":"warn","backup":"ok"}}`（`l` = id → level 首字母 o/w/e）。
- 写入节流：**启动后首次 / 任一检查项 level 变化 / 距上次 ≥ 10 分钟** 三者之一才写；文件超 500 行时只保留最后 500 行。
- 进程内维护 `id → {level, since, count}`（启动时读历史尾部用于延续 `since`），供 `/api/diag` 的 `since/changedAt/streak` 用。
- `GET /api/diag/history?hours=24&limit=200` → `{ "file": "...", "exists": true, "total": 42, "points": [ {t,e,w,o,l}… ], "changes": [ {t,id,title,from,to} … ] }`；只读、不需令牌。

### 3) `POST /api/diag/export`（需 `x-local-token`）

- 返回 `application/zip`，头 `content-disposition: attachment; filename="qy-diagnostics-YYYYMMDD-HHMMSS.zip"`。
- zip 用 **store（不压缩）**，零依赖：目录项 + 中央目录 + CRC32。条目：
  `README.txt`、`REPORT.txt`（人话报告：版本/系统/服务/模型/资源快照 + 逐项 [正常|警告|错误] title — detail → fix）、
  `diag.json`（/api/diag + resources）、`manifest.json`（生成时间、各文件字节数与 sha256）、
  `logs/app.tail.txt`（尾 500 行）、`logs/crash.log`（有才放）、`logs/vision.log`（有才放）、
  `config.ini.sanitized`（`modelDir` 值替换成 `<MODEL_DIR>`，其余保留；无 config.ini 时写说明）。
- 没令牌 → 403；生成失败 → 500 + 人话错误。
- 共享模块 `server/diag-zip.mjs`：`export function zipStore(entries)`（`entries = [{name, data: Buffer}]`）→ Buffer；
  另导出 `crc32(buf)`。**不要**引第三方库。

### 4) `POST /api/diag/open-path`（需令牌）

- body `{ "which": "dir" | "logs" | "modelDir" | "sessions" | "workspace" }`；白名单外 → 400。
- 用 `spawn("explorer.exe", [absPath], {detached:true})`；返回 `{ "ok": true, "which": "...", "path": "..." }`。

## 四、页面契约（ui-debug 实现，只改 debug.html）

保留现有全部 id 与功能（`refresh/copy/pills/ver/checkedAt/checks/logApp/logCrash/logRefresh/logBox/logInfo/clearCrash/ragRebuild/unload/actionInfo/resCard/resCpu/resCpuBar/resCpuNote/resMem/resMemBar/resMemNote/resKv/resSpark/resUpdated/env/model/data`），新增：

| 元素 | 行为 |
|---|---|
| `#filters` 里 3 个 chip：`#filterAll/#filterErr/#filterWarn` | 切换过滤；选中加 `.sel`；chip 文案带计数「全部 17 / 错误 0 / 警告 2」；过滤只影响 `#checks` 渲染 |
| `#checks li[data-id][data-level][data-group]` | 每项带 `data-*`；**组头**用 `<li class="grp">推理</li>`（组顺序：服务、系统、推理、数据、扩展、发布） |
| 每项徽标 | warn/error 项在标题行右侧显示「已持续 12 分钟」（由 `since` 算）；`changedAt` 在 2 分钟内 → 加 `.chg` 高亮（CSS 呼吸/描边） |
| 每项复制键 `.cp` | 复制「title — detail → fix」，点击短暂变成「已复制」 |
| `#exportBtn`（顶栏，复制报告旁） | `POST /api/diag/export`（带 token）→ blob → `a[download]` 触发下载；反馈写 `#actionInfo`；失败给人话 |
| `#histCard` 新卡 | h2「诊断历史」+ `#histSpark` canvas（双线：错误红、警告黄，x = 时间）+ `#histList` 最近 ≤6 条变更（「09:12 ok→warn 视觉 sidecar」）+ `#histNote`（采样点/时间窗）；无历史 → 「还没有历史（首次体检后开始记录）」 |
| 修复动作新增 3 键 | `#openDir`（程序目录）、`#openLogs`（日志目录）、`#openModels`（模型目录）→ `POST /api/diag/open-path` |

页面轮询保持：`/api/diag` 5s、`/api/diag/resources` 2s、`/api/diag/history` 30s（不可见时都暂停）。
新增 CSS 沿用现有变量（--cyan/--ok/--warn/--err/--panel/--line），暗色一致；**不引外部字体/图标/库**。

## 五、CLI 契约（cli-debug 实现）

`node localai-debug.mjs` 继续支持 `--json / --ui / --logs`，新增：

| 参数 | 行为 |
|---|---|
| `--export [dir]` | 服务在跑：取 `/api/state.localToken` → `POST /api/diag/export` → 存 `<dir>/qy-diagnostics-<时间戳>.zip`，打印路径/大小。服务没跑：用 `localChecks()` + 本机日志生成 `<dir>/qy-diagnostics-<时间戳>/REPORT.txt`（含「服务未运行」说明）；两种都 exit 0，失败 exit 1 |
| `--open <dir\|logs\|modelDir\|sessions\|workspace>` | 有服务走 `/api/diag/open-path`；没服务直接 `explorer.exe` 打开本地目录；白名单外 exit 2 |
| `--history [hours]` | 打印历史变更表（最近 N 条 ok→warn/error 变化 + 采样点数）；无服务 exit 2 |
| `--watch [秒=5] [--cycles N]` | 轮询 /api/diag，只在「出现变化」时打印一行（新检查项 / level 变化）；`--cycles` 便于探针自测（跑 N 轮退出） |

离线导出也走 `diag-zip.mjs`（Lead 提供）；服务端不可用时不阻塞、不抛栈。

## 六、探针要求（probe-debug 实现）

- `probe-debug.mjs`：现有 35 条全保留；新增：检查项 ≥ 20、每项有 `group`、6 个新 id 都在（`config/vision/backup/ragfresh/logs/webview2`）、
  `backup` 检查项存在（守住老 bug）、`since/changedAt/streak` 形状、`/api/diag/history` 形状与 200、`POST /api/diag/export` 无令牌 403、
  带令牌返回 zip（`PK\x03\x04` 魔数、content-disposition、字节数 > 2000、包内出现 `REPORT.txt` 字样）、`POST /api/diag/open-path` 无令牌 403 / 非法 which 400（**不要真的开窗口**：合法 which 用探针跳过，避免弹窗口）、
  CLI `--history`、`--export <临时目录>`（跑完删产物）、`--watch 1 --cycles 2`。
- `probe-ui-debug.mjs`：现有 23 条全保留；新增：3 个过滤 chip 存在且点击「错误」后只剩 error 项、组头存在（≥4 个）、`#exportBtn` 存在、
  `#histCard/#histSpark/#histList` 存在且有内容或明确空态、每项有 `data-id`、复制键存在。
- 界面探针别并行跑（共用页面）；跑前确认 8099 有服务；Edge 用 9333（probe 专用）。

## 七、验证命令（谁都能跑）

```powershell
node server\probe-debug.mjs http://127.0.0.1:8099
node server\probe-ui-debug.mjs http://127.0.0.1:9333 http://127.0.0.1:8099
# 已有检查项不能退化（回归）
node server\probe-firstrun.mjs http://127.0.0.1:8099
```

## 八、口径备忘

- 版本号**不升**（仍 1.3.1；下一轮打包时再升 1.4.0 并重打 zip）。
- 断言口径：`probe-debug` 35 → 目标 ~48；`probe-ui-debug` 23 → 目标 ~29；总口径 763 → 实际跑完再定。
- 完成后 Lead 负责：源码同步进 `dist\QingYaoTP AILauncher\app\`（含 diag-zip.mjs）、`git commit`、日志第五十三节（docs-debug 写）。
