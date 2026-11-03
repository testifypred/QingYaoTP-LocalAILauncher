# P4 改动后的全量复验（2026-11-03 23:52 → 11-04 00:20）

> 结论：**P4 改动（首启建议 + 1.5B 下载档）没有破坏任何东西**。
> - **P4 live 验证通过**：把 `modelDir` 指到一个空目录、真机重启 → `tier=large`、推荐 `qwen2.5-1.5b-instruct-q4_k_m.gguf`、文案「本机还没有 7B 级模型，先下 1.5B」，不再自相矛盾。
> - **全量 48 条 / 668 断言全绿**：一次整跑 47 条通过；`probe-preload` 首跑 24/26（两条阈值在忙时太紧）→ 放宽后复跑 **26/26**。

## 一、环境

| 项 | 值 |
|---|---|
| 被测对象 | `dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe`（已含 P4 代码：app.mjs / config-recommend.mjs） |
| 版本 | v1.1.0，`/api/version.dir = ...\dist\QingYaoTP AILauncher\app` |
| 工作区 | 清空 `<包>\models\workspace` → 驱动预置（会话 1 + note.txt + rag-seed.md + 重建索引 + **标记首启引导完成**） |
| 模型 | 5 个 gguf 硬链接进 `<包>\models\`（跑完已删链接）；驱动预加载 7B/16K |
| 后端 | vulkan，0 崩溃 / 0 重启 |
| 驱动 | `server\docs\probe-full-2026-11-03\run-full.ps1`（与 11-02 版相同，含 Seed-Workspace） |

## 二、P4 live 验证（先做，再跑全量）

`config.ini` 临时改 `modelDir=D:\LocalModels\tmp-empty-models`（空目录）→ 重启：

```
models=0
tier=large
model={ id: qwen25-15b-q4km, label: Qwen2.5-1.5B-Instruct · Q4_K_M, sizeGB: 1.12, catalog: true, existing: false }
reason=内存 31.4GB：可用 7B 级模型，16K 上下文；本机还没有 7B 级模型，先下 1.5B（约 1.1GB）跑通，之后可在模型菜单换 7B
检查项 models = warn（已有模型：空）
```

→ 推荐与文案一致，空模型目录下启动正常。验证完把 `modelDir` 改回空（便携默认）跑全量。

## 三、全量结果

| 项 | 值 |
|---|---|
| 一次整跑 | **47/48 通过**，0 崩溃/0 重启，约 17 分钟（机器忙：tools-agent 227s、web-tools 216s） |
| 唯一红项 | `probe-preload` 24/26：①「余量 = 可用 − 占用」四舍五入边界（13.9−3.47 vs 10.48，差 0.05）；②「全程耗时 <25s」实测 29.4s |
| 处置 | 两处都是**探针阈值**：容差 0.05→0.15（服务端 freeGB 只保留 1 位小数）；耗时 25s→45s（语义已由 `swapped=false` 保证，机器忙时 preloaded 也会到 30s）→ 复跑 **26/26** |
| 合计 | **48 条 / 668 断言全绿**（47 条整跑 + 1 条复跑） |

## 四、证据

- `summary.txt`（整跑逐条）、`logs\probe-*.out.txt`、`logs\rerun-probe-preload.out.txt`（复跑 26/26）
- `dist\QingYaoTP AILauncher\logs\app.log`（无 crash、无重启）

## 五、留给下一轮

- **交付 zip 还是 P4 之前打的**（`dist\QingYaoTP-AILauncher-v1.1.0.zip`，11-01 21:52）：dist 运行目录已含 P4 代码，但 zip 没有。要么下次重打 zip，要么明确「P4 只在源码/运行目录」。
- 7B 分片下载仍未支持。
