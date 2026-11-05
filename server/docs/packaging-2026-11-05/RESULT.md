# 重打发布包 + 交付 zip（2026-11-05 第十轮，紧急接手）

> 结论：**发布包与交付 zip 已同步到最新源码（P4 + 显卡选择）**。构建 8 步全过；HTTP 7 项、包内 CLI、目标探针 95 断言、12 项自检全绿；交付 zip 121.8MB / 3943 条目，便携化（modelDir 空、无本机绝对路径、无 .pid/.log/.tmp、无 data/logs 载荷）。

## 一、为什么这一轮

11-04 显卡选择收尾时，dist 运行目录已是新代码，但对外交付的 `dist\QingYaoTP-AILauncher-v1.1.0.zip` 还是 **11-01 21:52** 打的（包内 app.mjs 247,886 B，缺 P4 与显卡两轮）。11-03、11-04 两份 RESULT 都留了「下次交付必须重打 zip」。本轮清账，并补上「zip 由谁打」的脚本入口。

## 二、产物

| 项 | 值 |
|---|---|
| 发布目录 | `dist\QingYaoTP AILauncher`：258.2 MB / 3443 文件（`data\` 156.5 MB 运行期缓存另算） |
| **交付 zip** | `dist\QingYaoTP-AILauncher-v1.1.0.zip`：**127,758,927 B（121.8MB）/ 3943 条目 / SHA256 `7F49A8DC…A1A4E`** |
| 旧 zip | 改名 `*.zip.old-1101` 留证（122.0MB / 3947 条目） |
| 启动器 / 调试 | 57,856 B / 42,496 B（mtime 2026-11-05 23:48:37，本次重编） |
| 便携配置 | 包内 `config.ini`：`modelDir=` / `autoLoad=` / `vkDevices=` 全空，全文无 `D:\LocalModels` |
| 新增脚本 | `server\make-zip.ps1`——打交付 zip 的唯一入口（前缀、正斜杠、config 消毒、运行期文件排除都在这） |

## 三、验证

### 3.1 构建（build-portable.ps1）
8 步全过（清空→复制→node-llama-cpp→TTS 依赖→Node 运行时→编译启动器→编译调试工具→写配置），退出 0；日志 `build.out.txt`。

### 3.2 HTTP + 包内 CLI
| 项 | 结果 |
|---|---|
| `/health` / `/api/state` / `/debug` / `/debug-icon.png` / `/debug-icon.ico` / `/api/gpus` | 全部 **200** |
| 无令牌 `POST /api/debug/open` | **403**（令牌校验生效） |
| `/api/state` | version 1.1.0、5 个模型、gpu=vulkan、modelDir 正常 |
| `localai-debug.cmd --json` / `localai.cmd models` | exit **0** / exit **0**（5 个模型） |

### 3.3 目标探针组（发布包上跑，`probes.md`）
| 探针 | 结果 | 断言 | 备注 |
|---|---|---|---|
| probe-debug（首跑） | 33/35 | 35 | 2 红 = 未加载模型时的两条 KV 量化断言（前置条件） |
| probe-debug（复跑） | **35/35** | 35 | 装 qwen2.5-0.5b 后全绿，跑完 unload 复原 |
| probe-rag | **16/16** | 16 | 中英/docx/PDF 召回，索引复位 |
| probe-gpu | **14/14** | 14 | 1 块 Intel Arc，config 复原 |
| probe-firstrun | **22/22** | 22 | 新包首启形态 `firstRunDone=false` 属正常 |
| probe-ui-gpu | **8/8** | 8 | headless Edge 9333，无 JS 异常 |
| 合计 | **6 次运行 / 95 断言全绿**，0 崩溃、服务 pid 全程未变 | | |

> 为什么不是全量 50 条：本轮只重打包、未改应用代码；同一份源码 11-04 已全量 50/690 全绿。按 technique/05 对「打包产物」的口径跑 12 项自检 + 目标探针组。

### 3.4 12 项自检
见 `verify.md`（verifier 独立执行 item 1–10/12，Lead 做 item 11 解压冒烟）：**12/12 通过**。

### 3.5 收尾运行态
本机 `config.ini` 恢复 `modelDir=D:\LocalModels` 并重启启动器：8099 health=200、pid 23368、界面可见 5 个模型；**zip 保持便携形态**（modelDir 空）。

## 四、与上一版 zip 的差异（verifier item 12）

| 类别 | 内容 |
|---|---|
| 移除 4 条 | `app/server.pid`（本机 pid，必须排除）、`models/workspace/`、`discovery.json`、`sessions/`（本机运行期泄漏） |
| 新增 0 条 | — |
| 内容变化 5 条 | app.html 271,389→275,430、app.mjs 247,886→254,041、config-recommend 5,316→6,063、config.ini 840→963、exe 57,344→57,856 |

## 五、遗留（下一轮）

1. **`使用说明.txt` 旧文案**：「默认指向 D:\LocalModels」与便携默认矛盾；在 `build-portable.ps1` 的 readme 模板里，改它要连带重打包。
2. **老笔记本真机验证**：设置 → 显卡 看有没有 RX640；有就选它、重启、`app.log` 应出现「只可见 1」；没有就升 AMD 驱动（22.6.1 / 30.0.15021.11005）。
3. **7B 分片下载 + 校验**：下载器只吃单文件，large 档推不了 7B。
4. `probe-start-flow` 偶发 `ECONNRESET`（11-04 遗留）本轮未撞到。

## 六、证据文件

| 文件 | 内容 |
|---|---|
| `build.out.txt` | 打包完整 transcript（8 步） |
| `http.txt` | 7 项 HTTP + state/gpus/version 原文 |
| `cli-smoke.txt` | 包内 CLI 两条命令输出与退出码 |
| `probes.md` + `logs\probe-*.out.txt` / `.err.txt` / `run-log.txt` | 目标探针组（6 次运行 / 95 断言） |
| `verify.md` + `verify-files\*` | 12 项自检、哈希、条目清单、解压冒烟 |
| `dist\QingYaoTP-AILauncher-v1.1.0.zip.old-1101` | 旧包留证 |

## 七、环境

| 项 | 值 |
|---|---|
| 机器 | 22 核 / 31.4 GB；D: 空闲约 300 GB |
| 源码 | git HEAD `ef3fac6` + 本轮新增 `make-zip.ps1` 与文档 |
| 打包 shell | Windows PowerShell 5.1 子进程（build-portable.ps1 / make-zip.ps1） |
| 服务 | 127.0.0.1:8099（发布包），pid 23368 |
| 数据备份 | `server\docs\session-backups\2026-11-05_2352\`（3 会话 + 342 文件） |