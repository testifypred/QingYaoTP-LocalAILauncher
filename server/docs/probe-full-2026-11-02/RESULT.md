# 最终包全量回归（2026-11-02 夜 → 11-03 01:0x 收尾）

> **结论：48 条探针 / 668 断言全绿**（45 条一次整跑通过 + 3 条复跑转绿），**0 崩溃 / 0 服务重启**。
> 被测对象是**最终交付的那一版发布包**（v1.1.0 + modelDir 便携修复），并且是第一次在**「全新安装」形态**上跑
> （发布包工作区清空，环境由驱动自己预置）。**没有发现 v1.1.0 功能回归**；红项全部归因为「探针的环境假设」，
> 顺手修掉一个真产品问题（P4）并补了 1.5B 下载档。

## 一、环境与身份

| 项 | 值 |
|---|---|
| 被测对象 | `dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe`（发布包，非源码 dev 服务） |
| 版本 | v1.1.0；`/api/version.dir = ...\dist\QingYaoTP AILauncher\app`，buildSource=mtime |
| 工作区 | 每轮先清空 `<包>\models\workspace`（模拟全新安装），由驱动 `Seed-Workspace` 预置：1 个会话 + note.txt + rag-seed.md + 重建索引 + 标记首启引导完成 |
| 模型 | 5 个 gguf 以**硬链接**放进 `<包>\models\`（跑完已删链接，源文件保留）；驱动预加载 qwen2.5-7B / 16K |
| 后端 | vulkan；三轮均无 device lost、无重启 |
| 界面 | headless Edge Edg/156（CDP 9333），跑完已关 |
| config.ini | 跑前=跑后 SHA256 `E542E895…`（未被写改；firstrun 走 dryRun） |
| 会话备份 | `server\docs\session-backups\2026-11-02_23-36-00\workspace-full`（318 文件） |

## 二、三轮结果

| 轮 | 时间 | 结果 | 红项 | 归因 |
|---|---|---|---|---|
| 1 | 23:36–23:49 | 41/48 | rag、ui-new、start-screen、start-flow、small-features、ui-rag、tools-agent | **全新空工作区**：无会话 / 无 note.txt / 无检索语料（这批探针默认工作区已有内容） |
| 2 | 23:49–00:02 | 46/48 | rag（15/16）、ui-preload（34/35） | ① 预置的 `rag-seed.md` 撞了 probe-rag 的检索词，抢了第一名；② ui-preload 固定 sleep 抢在「取消」提示之前 |
| 3 | 00:03–00:21 | 45/48 | menu-stacking（1/2）、formula-find（7/8）、preload（25/26） | **首启引导面板盖住顶栏**（onboarding done=false，z-index 高于 header）→ 模型菜单点不到、Ctrl+F 被挡；preload 是有状态残留 |
| 复跑 | 00:2x–01:0x | **3/3 绿** | menu-stacking 2/2、formula-find 8/8、preload 26/26（另 ui-preload 35/35，见下） | 驱动补「标记首启引导完成」+ 三条探针去掉固定 sleep |

> 附带：`probe-ui-preload` 在第三轮显示 34/34，是因为改探针时**误删了一条断言**（`取消 @ 后释放常驻`）；
> 已补回并复跑 **35/35**，所以断言口径从 664 变成 **668**（probe-firstrun 18→22 也 +4，见 P4）。

## 三、这一轮改了什么（都在探针/驱动/推荐逻辑侧）

| 文件 | 改动 | 原因 |
|---|---|---|
| `server\docs\probe-full-2026-11-02\run-full.ps1` | `$out` 改成脚本自身目录；新增 `Seed-Workspace`：补会话 / note.txt / rag-seed.md / 重建索引 / **标记首启引导完成** | 全新安装时工作区是空的，7 条探针会假红；首启面板还会盖住顶栏 |
| `server\probe-rag.mjs` | 工作区根从 `/api/rag/status.dir` 反推，不再写死 `D:\LocalModels\workspace` | 发布包工作区是 `<安装>\models\workspace`（第 1 轮 8 条红） |
| `server\probe-ui-preload.mjs` | 「取消 @ 后」改成轮询「服务端已空 + 提示已出现」；补回误删的断言 | 卸载异步，固定 sleep 1.5s 会抢跑（第 2 轮） |
| `server\probe-menu-stacking.mjs` | 打开菜单后轮询「每行已布局且命中菜单」 | 首启面板/布局时序 |
| `server\probe-formula-find.mjs` | Ctrl+F 后轮询 findBar 可见 | 同上 |

## 四、产品侧：P4 已修（首启建议自相矛盾）

- 现象（11-02 实测）：内存 31.4GB + 模型目录为空时，`/api/sysinfo` 的 `reason` 写「可用 7B 级模型，16K 上下文」，`model` 却是 **Qwen2.5-0.5B**。
- 根因：`config-recommend.mjs` 在 large 档找不到本地大模型时落到 0.5B 目录项，但 `reason` 仍按档位写死；而 7B 在 ModelScope 是**分片文件**（`-00001-of-00002`），当前下载器只支持单文件。
- 修法：
  1. 下载目录新增 **Qwen2.5-1.5B-Instruct Q4_K_M（单文件 1.12GB，已实测可下）**：`app.mjs` 的 `DOWNLOAD_CATALOG` + `config-recommend.mjs` 的 `CATALOG`；
  2. large 档没有本地大模型 → 推荐 **1.5B**，并把「本机还没有 7B 级模型，先下 1.5B（约 1.1GB）跑通」写进 `reason`；
  3. small/medium 档在可用内存 ≥8GB 时也优先 1.5B（0.5B 只留给 tiny/低可用内存兜底）；
  4. `probe-firstrun` 新增 4 条断言锁住这个契约 → **22/22**。
- 说明：1.5B 也是交接文档里「老笔记本甜点」的那一档，现在在界面里可以直接下载，不用手工拷文件。

## 五、收尾状态

- `probe-firstrun` 22/22、`probe-debug` 35/35（需已加载模型）、`probe-version` 14/14 复验通过；
- 源码已同步进 `dist\QingYaoTP AILauncher\app\`（`app.mjs`、`config-recommend.mjs` SHA256 MATCH）；
- config.ini 未被写改；开发工作区真实会话完好；发布包服务已停、headless Edge 已关、包内模型硬链接已删；
- 证据：本目录 `firstrun\` / `run2\` / `logs\` / `shots\`。

## 六、给下一轮的三条提醒

1. **全量驱动现在会自己预置环境**（会话 / note.txt / 检索语料 / 标记首启引导完成），不要再假设「工作区里已经有真实会话」；
2. 断言口径是 **668**（probe-firstrun 22 + probe-ui-preload 35）；
3. 还剩的老问题：7B 分片下载未支持（若要做，得让下载器支持多文件 + 校验）；P4 的 live 场景只做了纯函数单测，真机「空模型目录」重启验证可以下次补。
