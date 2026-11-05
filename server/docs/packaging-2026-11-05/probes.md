# 发布包目标探针组（packaging-2026-11-05）

- 被测对象：`D:\LocalModels\dist\QingYaoTP AILauncher` 发布包，由启动器拉起
- 地址：http://127.0.0.1:8099 （health=200）
- /api/version：`1.1.0` · builtAt=2026-11-04T15:35:20.046Z · buildSource=mtime · dir=`D:\LocalModels\dist\QingYaoTP AILauncher\app` · node=v24.19.0 · port=8099 · pid=23368
- 跑法依据：`technique\06-探针与验证.md`；全程串行，服务未停/未重启（pid 23368 自 23:52:23 起未变），未重打发布包，未改 app.mjs/app.html
- 日志：`server\docs\packaging-2026-11-05\logs\<probe>.out.txt / .err.txt`（UTF-8 无 BOM；12 个 .err 均为 0 字节）

## 结果表

| 探针 | 命令 | 结果 | 断言数 | 耗时 | 备注 |
|---|---|---|---|---|---|
| probe-debug（首跑） | `node probe-debug.mjs http://127.0.0.1:8099` | 33/35（红 2） | 35 | 2.9s | 红项：「模型 KV 量化与 /api/state 一致」「KV 量化实际生效类型…」—— 当时 loaded=null、kvQuant 为空，属「未加载模型」前置条件 |
| probe-debug（复跑） | 同上（先 `POST /api/load` 装 qwen2.5-0.5b） | 35/35 全绿 | 35 | 2.7s | 装模型后 KV 两项通过（q8_0 vs q8_0）；检查项 19 项全 ok；跑完 `POST /api/unload` 复原 |
| probe-rag | `node probe-rag.mjs http://127.0.0.1:8099` | 16/16 全绿 | 16 | 0.8s | 中文 bigram / 英文 / docx / PDF（含中文）召回全过；跑完测试目录删除、索引复位 files=3 |
| probe-gpu | `node probe-gpu.mjs http://127.0.0.1:8099` | 14/14 全绿 | 14 | 0.6s | 本机 1 个 Vulkan 设备（Intel Arc）；保存 0 → 写盘 → 读回 → 恢复「自动」，config.ini 复原为空 |
| probe-firstrun | `node probe-firstrun.mjs` | 22/22 全绿 | 22 | 0.5s | 纯推荐逻辑 + /api/sysinfo（8 检查项）+ /api/firstrun/apply；firstRunDone=false（新包首启形态），apply 为 dry-run（applied=null，不写配置不加载） |
| probe-ui-gpu | `node probe-ui-gpu.mjs http://127.0.0.1:9333 http://127.0.0.1:8099` | 8/8 全绿 | 8 | 8.2s | headless Edge（9333，`--user-data-dir=%TEMP%\edge-probe`，window 1440×900）；页签/设备列表/「自动」/保存/重启提示/无 JS 异常全过；config 复原为空 |

合计：**6 次运行，断言 35+16+14+22+8 = 95 条；首跑 93 通过 / 2 红，复跑后目标组全绿。**

## 红项定性（重要）

- probe-debug 首跑 2 红**不是产品/打包回归**：该探针的 KV 量化断言比较 `/api/state.kvQuant`、`/api/diag/resources.model.kvQuant` 与 `kvQuantActual`，而本次启动器拉起后没有加载模型（`GET /api/state.loaded=null`、`kvQuant=""`、diag 只有 17 项检查；加载模型后 diag 变 19 项）。按 technique/06「有一批探针默认模型已加载」的口径，装模型后同机复跑 **35/35** 全绿。
- 复跑后已 `POST /api/unload` 复原：`loaded=[]`、`kvQuant=[]`、`kvQuantActual={key:null,...}`，health=200、pid 23368 不变。
- 本次**没有出现忙时超时**：5 条探针均一次通过（唯一 2 红是上述前置条件，不是超时），故不涉及「忙时阈值 vs 真失败」的判定。

## 与任务预期的口径差异

- 任务里写 probe-debug「期望 25/25」，**实际是 35 条断言**（probe-debug.mjs 在 11-01 扩过：调试页实时资源 +9、模型品牌图标相关等；35 = 老口径 25 + 10，本次输出 RESULT 行即 35）。其余 4 条与任务预期一致：rag 16、gpu 14、firstrun 22、ui-gpu 8。
- probe-firstrun 输出 22 条，符合「22 条左右」；其中 firstRunDone=false 与新打包后首启形态一致（P4 首启建议的目标场景），不是红。

## 环境与自复位

- 服务：未停/未重启；`/health` 前后均 200；pid 23368 未变；期间无 Vulkan 崩溃（probe-debug 崩溃记录接口为空，无需还原）。
- headless Edge：自建 user-data-dir=%TEMP%\edge-probe，主进程 pid 41948 + 子进程共 9 个，跑完按命令行匹配 `*-edge-probe*` 全部结束；9333 已释放；用户自己的 9 个常规 Edge 进程未动。
- config.ini：probe-gpu / probe-ui-gpu 临时写 `vkDevices=0` 后均恢复；跑完 `/api/gpus` → current=""、config=""。
- 工作区：未清 `workspace\sessions`（Lead 已备份至 `server\docs\session-backups\2026-11-05_2352\`）；probe-rag 的 rag-probe 测试文件已删除、索引复位（files=3）。
- 模型：首跑时无加载模型；诊断时临时装 0.5B，跑完卸载，恢复为「无加载模型」。

## 证据文件

`server\docs\packaging-2026-11-05\logs\`：

- probe-debug.out.txt（首跑，33/35）· probe-debug.err.txt
- probe-debug.rerun.out.txt（复跑，35/35）· probe-debug.rerun.err.txt
- probe-rag.out.txt · probe-rag.err.txt
- probe-gpu.out.txt · probe-gpu.err.txt
- probe-firstrun.out.txt · probe-firstrun.err.txt
- probe-ui-gpu.out.txt · probe-ui-gpu.err.txt
- run-log.txt（命令 / 退出码 / 断言数 / 耗时 原始记录）

## 结论

发布包（1.1.0，buildSource=mtime，dir=dist\...\app）上目标探针组**全绿**：接口类 3 条 + 首启推荐 22/22 + 显卡 UI 8/8；probe-debug 首跑的 2 条 KV 量化红经装载模型复跑确认为**前置条件（无已加载模型）**，非回归、非忙时超时。可以随 zip 发布。
