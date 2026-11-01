# Debugging Tool · 实时系统资源观测 —— 实现与验证结果

- 日期：2026-11-01
- 任务：共享任务板 task-3（debug-ui）
- 服务：发布包 `http://127.0.0.1:8099`（7B 模型、ctx 16384、vulkan、kvQuant=q8_0，未重启）
- 结论：**两条探针全绿** —— `probe-debug.mjs` **34/34**、`probe-ui-debug.mjs` **23/23**，退出码均为 0；页面实时资源卡实测有数、条形与 sparkline 正常。

## 1. 交付内容

### 1.1 `server\debug.html`（+ 同步 `dist\LocalAI\app\debug.html`）

右侧第一张卡（「运行环境」之前）新增 **实时资源** 卡：

| 内容 | 说明 |
| --- | --- |
| CPU 占用 | 百分比 + 条形；首次采样为 `null` 时显示「—」并注明「首次采样中，1 秒后补上」，1.1s 后自动补采 |
| 内存 | 已用 / 总量 + 百分比 + 条形 + 空闲 |
| 进程 | pid、RSS、heap、external |
| 磁盘 | 剩余 / 总量 + 路径（接口取不到时显示「—（取不到）」） |
| 模型 / 上下文 / 后端 / KV 量化 / 并发 / 近 10 分钟崩溃数 | 来自同一接口的 `model` 段 |
| 最后刷新时间 | 右上角「· 时间 · 每 2 秒刷新」 |
| sparkline | 60 点内联 `<canvas>`（无外部依赖），CPU%（青）+ 内存%（紫）两条折线 + 70% 黄虚线阈值；不足 60 点时按全宽铺开 |

- 轮询：`setInterval(..., 2000)`，仅在 `document.visibilityState === 'visible'` 时请求；原有 5s 的 `/api/diag` 轮询保持不变。
- 阈值配色：条形 `≥70%` 黄、`≥90%` 红（实测内存 80% → 黄条，与截图一致）。
- 「模型与推理」卡新增 **KV 量化** 行（`diag.model.kvQuant`，回退时附 `kvQuantFallback`）。
- 「复制报告」新增一行：`实时资源: CPU 13% · 内存 25.3 GB/31.4 GB (81%) · 进程 RSS 9738 MB · 磁盘剩余 303.5 GB`（未采过会先补采一次）。
- 保持原有全部功能（检查项、日志、修复动作、复制）与深色风格；纯原生 JS，无 CDN/外部依赖。
- 源文件与发布包已同步（SHA-256 一致）：`172EB7CBCC12D93B84D72CA615DE331A54C6F8C9A1975EC1A0629826FC2796AF`（381 行）。

### 1.2 `server\probe-debug.mjs`（25 → 34 条）

新增「实时资源」段（9 条，均为确定性断言）：

1. 资源接口可用（无令牌 GET 200）
2. 资源字段形状完整（含 ISO 时间）
3. 内存 已用 + 空闲 ≈ 总量（±0.1 GB）
4. 内存百分比与用量自洽（0–100，±2）
5. 进程 RSS > 0 且 heap 合理
6. 磁盘剩余可读（`disk` 为 null 或 `freeGB ≥ 0`、`totalGB > 0`）
7. 第二次采样 CPU 占用是 0–100 的数字（间隔 1.3s，避开首采 null）
8. 第二次采样 `now` 推进
9. 模型 KV 量化与 `/api/state` 一致（要求非空且相等）

原有 25 条断言未改动。

### 1.3 `server\probe-ui-debug.mjs`（20 → 23 条）

在「调试页面本身」段新增 3 条（保持原有 20 条不变）：

1. 调试页有实时资源卡与 sparkline（卡片存在、canvas 有尺寸且已绘出像素）
2. `2.6s` 后 CPU/内存有数值且条形有宽度（数值匹配 `\d+%`、条形 > 2px）
3. 调试页无未捕获 JS 异常（CDP `Runtime.exceptionThrown`；进 `/debug` 前重置计数）

### 1.4 `server\localai-debug.mjs`（可选项，已完成）

- 文本报告新增一行：`实时资源 CPU 13% · 内存 25.3/31.4 GB (81%) · RSS 9738 MB · 磁盘剩余 303.5 GB`。
- `--json` 输出新增 `resources` 字段（与 `/api/diag/resources` 同源，服务不可达时不添加，保持原行为）。
- 该文件若已拷进发布包，需要重新打包（`packager`）后发布包内的 CLI 才带新字段。

## 2. 验证命令与结果（工作目录 `D:\LocalModels\server`）

```
node probe-debug.mjs http://127.0.0.1:8099
→ RESULT 34/34（exit 0）

node probe-ui-debug.mjs http://127.0.0.1:9333 http://127.0.0.1:8099
→ RESULT 23/23（exit 0）
```

完整日志：`probe-debug.log`、`probe-ui-debug.log`（同目录）。

关键新增断言实测值：

```
ok 资源接口可用（无令牌 GET）  [HTTP 200]
ok 资源字段形状完整（含 ISO 时间）  [cpu/mem/proc/model/now]
ok 内存 已用+空闲 ≈ 总量（±0.1 GB）  [24.76 + 6.67 vs 31.43]
ok 内存百分比与用量自洽（0–100）  [79%]
ok 进程 RSS > 0 且 heap 合理  [RSS 9736 MB · heap 34 MB]
ok 磁盘剩余可读（disk 为 null 或 freeGB ≥ 0）  [303.5 / 551.6 GB]
ok 第二次采样 CPU 占用是 0–100 的数字  [usagePct=7]
ok 第二次采样 now 推进  [2026-11-01T08:21:22.550Z → 2026-11-01T08:21:23.882Z]
ok 模型 KV 量化与 /api/state 一致  [q8_0 vs q8_0]
ok 调试页有实时资源卡与 sparkline  [593x56 · painted 5294]
ok 2.6s 后 CPU/内存有数值且条形有宽度  [22% / 25.2 GB / 31.4 GB · 80% · bars 130/474px · · 2026-11-01 16:22:17 · 每 2 秒刷新]
ok 调试页无未捕获 JS 异常
```

## 3. 页面实测数字（滚动截图时刻，1440×900）

页面 DOM（`server\docs\debug-resources\page.png`，16:23:03）：

- CPU：**13%**（22 核 · Intel Core Ultra 7 155H），条形约卡片宽 13%
- 内存：**25.3 GB / 31.4 GB · 81%**（黄条；空闲 6.1 GB）
- 进程：pid 4644 · **RSS 9738 MB** · heap 34 MB · 外部 5 MB
- 磁盘：**剩余 303.5 GB / 551.6 GB**（D:\LocalModels）
- 模型：qwen2.5-7b-instruct-1m-q4_k_m.gguf · 16384 tok · Vulkan（核显）· **KV 量化 q8_0** · 并发 0 · 崩溃 0 条
- 刷新时间：2026-11-01 16:23:03，每 2 秒；sparkline 已有 6 个采样点（CPU 青线 / 内存 紫线，全宽铺开）

同一时刻 `/api/diag/resources` 独立采样（Node 侧）：`cpu.usagePct=27`、`mem 25.24/31.43 GB (80%)`、`proc.rssMB=9738`、`disk.freeGB=303.5`、`crash=0`（CPU 百分比随采样窗口波动属正常）。

CLI 实测：

```
模型 qwen2.5-7b-instruct-1m-q4_k_m.gguf · 上下文 16384 · 29 层 · KV 38 token
实时资源 CPU 23% · 内存 25.56/31.43 GB (81%) · RSS 9738 MB · 磁盘剩余 303.5 GB
--json: resources present: True · cpu=23 · mem=81 · rssMB=9738 · diskFree=303.5
```

## 4. 证据文件

- `page.png` —— 调试页 1440×900 截图（实时资源卡在右上第一张，含 81% 黄条、sparkline、KV 量化 q8_0）
- `probe-debug.log` —— 34/34 全绿日志
- `probe-ui-debug.log` —— 23/23 全绿日志

## 5. 注意事项 / 坑

1. **改完必须同步发布包**：`/debug` 读的是 `dist\LocalAI\app\debug.html`，本次已同步且哈希一致；以后再改 `server\debug.html` 要重复这一步（否则页面还是旧的）。
2. **CPU 首采为 null 是设计内的**：`/api/diag/resources` 用两次 `os.cpus()` 的 delta 计算，服务刚起第一次调用没有基准。页面会显示「—」并在 1.1s 后自动补采，2s 轮询随后接管；探针只断言第二次采样，不会抖。
3. **`disk` 可能为 null**：`statfs(MODEL_DIR)` 失败时接口返回 `disk: null`，页面显示「—（取不到）」，探针按「null 或合法数值」判定。
4. **UI 探针依赖 9333 上自起的 headless Edge**：`node probe-ui-debug.mjs http://127.0.0.1:9333 http://127.0.0.1:8099`；本次测试用的 profile 是独立临时目录，测完已关闭，未触碰用户正在用的 WebView2 窗口。
5. **未改 `app.mjs` / 未重启服务 / 未 commit**：`/api/diag/resources` 与 `/api/diag` 均为 Lead 已就绪的接口，本次只是在页面上消费；`git status` 里 `server\app.mjs` 的改动属于 Lead。
6. `localai-debug.mjs` 的发布包副本由打包流程覆盖，若只跑当前发布包里的旧副本，CLI 不会显示实时资源行（页面与接口不受影响）。
