# 独立验证：QingYaoTP AILauncher v1.3.0（视觉 sidecar）发布包 + 交付 zip

- 验证员：verifier（独立；只读 dist / zip；按 Lead 指示独占 8099/8101 做视觉实测，未重启 8099）
- 时间：2026-11-07 21:55 → 22:05
- 依据：technique/05 12 项 + Lead 本轮附加项（视觉 sidecar）

## 0. 对象与基线

| 项 | 值 |
|---|---|
| 发布目录 | D:\LocalModels\dist\QingYaoTP AILauncher（4,162 文件 / 541,319,465 B；data\ 641 文件 / 156.6 MiB；载荷 3,496 文件 / 359.4 MiB） |
| 交付 zip | D:\LocalModels\dist\QingYaoTP-AILauncher-v1.3.0.zip — 166,189,978 B / 158.5 MiB / mtime 2026-11-07 21:53:42 |
| zip SHA256 | B592FBCC88D50357AB7397F15F09DF8BF9DEA902578558BB248AF97379BC82F0 |
| zip 条目 | 3,997（目录项 501 + 文件 3,496），根 QingYaoTP AILauncher-v1.3.0/ |
| 运行中服务 | 8099 pid 31404，version 1.3.0，21:54:05 用新包重启，包路径 dist\...\app |
| 视觉组件 | app\llama\ 53 文件 / 106,017,053 B（101.1 MiB） |

## 1. 结论摘要

- 包体/zip 结构、卫生、解压冒烟、视觉单条串行实测：**全绿**（视觉回答正确读出 QWEN 42 hello + 红色）。
- **需处理 2 项**：① 22:01 源码新增「视觉转发串行队列」后，dist/zip 里的 app.mjs、app.html 已落后于 server\（详见 §3-1）——若以当前源码为交付基线，必须重打 dist + zip；② 使用说明.txt 未更新（无看图/visionModel 说明、目录结构未列 app\llama\）。
- 另有 1 项运行目录脏值、1 项体验建议（思考型模型 content 为空），见 §5。

## 2. technique/05 12 项判定

| # | 检查 | 判定 | 关键值 |
|---|---|---|---|
| 1 | app\ 关键文件齐（含 app\llama） | 🟢 | app.mjs 289,073 / app.html 322,530 / doc-extract 10,750 / config-recommend 6,063 / debug.html 19,774 / localai-debug.mjs 8,365 / debug-icon-64.png 3,371 / debug.ico 33,273 等全在；llama-server.exe 9,728、mtmd.dll 2,531,840、ggml-vulkan.dll 41,999,360、llama-server-impl.dll 10,104,320、llama-common.dll 8,354,816、ggml-base.dll 833,024；vendor\katex、node-llama-cpp 齐 |
| 2 | 根目录文件齐 | 🟢 | 启动器 57,856 / DebugTool 42,496 / localai.ico 31,308 / config.ini 1,182 / 使用说明 4,939 / WebView2 三 DLL / vc_redist 25,635,768 / runtime\node.exe 92,825,416 / plugins *.mjs = 3 |
| 3 | 源码 SHA256（server vs dist） | 🔴 | **打包时（21:44/21:48）一致；验证中 22:01:26-29 源码被改**：app.mjs 289,073→296,010、app.html 322,530→325,890（新增视觉转发串行队列）。现在 server app.mjs=644D118AAD26EAE7、app.html=345CB2E5A78ED6D7，dist 为 CE5044954611357E / 4B7A179E51001893 → 不一致。doc-extract（9E08B87B…）、config-recommend（FD2BD978…）仍一致 |
| 4 | exe 尺寸/MZ/构建时间 | 🟢 | 57,856 与 42,496；头 4D 5A 90 00；mtime 2026-11-07 21:52:27 / 21:52:28 |
| 5a | dist 侧 config.ini | 🟡 | modelDir=D:\LocalModels（mtime 21:55:31，打包后被试跑/探针改写；build-portable.ps1 默认空）。visionModel=/visionMmproj= 两行已在 |
| 5b | zip 侧 config.ini | 🟢 | 1,165 B：port=8099 / modelDir=（空）/ autoLoad= / contextSize=16384 / kvReuse=1 / gpu=auto / vkDevices= / visionModel=（空）/ visionMmproj=（空）；无任何盘符路径 |
| 6 | node_modules 包数 / 随包 Node | 🟢 | app\node_modules 顶层 41；runtime\node.exe -v = v24.19.0 |
| 7 | zip 结构 | 🟢 | 3,997 条目（501 目录 + 3,496 文件）；根 QingYaoTP AILauncher-v1.3.0/；全部条目带前缀（缺 0）；反斜杠 0；盘符/绝对路径 0；含 .. 0；v1.1.0/v1.2.0 残留 0 |
| 8 | zip 内容抽查 | 🟢 | app/app.mjs 289,073、app/app.html 322,530、config.ini 1,165、启动器 57,856、DebugTool 42,496、app/llama/llama-server.exe 9,728、mtmd.dll 2,531,840、ggml-vulkan.dll 41,999,360、llama-server-impl.dll 10,104,320；zip 内 4 份源码 SHA256 与 dist 一致（注意 dist 即打包时源码） |
| 9 | zip 卫生 | 🟢 | data\、logs\ 实体文件 0（只有空目录项）；.pid/.log/.tmp 0；*.gguf 0；mmproj 路径 0；models/workspace 0；discovery.json 0；qytp-zip- 0；AppData/Temp/LocalModels 字样 0；app/llama 条目 53 |
| 10 | 中文文件名 | 🟢 | QingYaoTP AILauncher-v1.3.0/使用说明.txt 解码正确，SHA256 前16位 652DF809364A09D9（与 dist 一致） |
| 11 | 解压冒烟 | 🟢 | 解到 %TEMP%\qytp-verify-v130-20261107-220144：3,496 文件 / 500 子目录 / 376,829,832 B（359.4 MiB），26.7s；30 个关键文件 0 缺失（含 app\llama 6 个核心 DLL/EXE）；extracted runtime\node.exe --check 6/6 通过；解出的 app\llama\llama-server.exe --version 正常输出 `version: 0.9.0-dev (build 12144, commit 69ee2ecc0)`；启动器与 llama-server.exe 哈希与 dist 一致；data/logs/models 三目录空 |
| 12 | 与 v1.2.0 zip 差异 | 🟢 | 3,943 → 3,997 条目：删除 0；新增 54（1 个目录 + 53 个 app/llama 文件，全部在 app/llama/ 下）；修改 3（app.mjs 262,620→289,073、app.html 298,897→322,530、config.ini 963→1,165） |

## 3. 本轮附加项

| # | 检查 | 判定 | 关键值 |
|---|---|---|---|
| A1 | app\llama 三件套 + 能跑 | 🟢 | llama-server.exe 9,728 / mtmd.dll 2,531,840 / ggml-vulkan.dll 41,999,360 / llama-server-impl.dll 10,104,320；`llama-server.exe --version` 退出正常，输出 version: 0.9.0-dev (build 12144, commit 69ee2ecc0)，Clang 20.1.8 x86_64 |
| A2 | 发布包 /api/version | 🟢 | 1.3.0（buildSource=mtime、builtAt=2026-11-07T13:44:26Z、node v24.19.0、dir=dist\...\app、pid 31404） |
| A3 | /api/vision/state | 🟢 | running=false / port=8101 / pairs 长度 1：Qwen3.5-9B-Q4_K_M.gguf + mmproj\Qwen3.5-9B-mmproj-F16.gguf（expect 9B）；selected 指向同一组；note 说明按文件名族配对 |
| A4 | /api/state.models 不含 mmproj | 🟢 | state 里 mmproj 字样 0，models 7 条（均为文本 gguf） |
| A5 | 视觉实测（单条串行） | 🟢 | start 12.0s（含先卸载预加载模型）→ chat 11.7s → 回答 `图中文字和数字为：QWEN 42 hello。图形颜色为：红色。`（finish_reason=stop）→ stop 0.1s → 8101 监听 0、llama-server 进程 0、空闲内存回到 18.1GB |
| A6 | 并发视觉请求（包内版本） | 🔴 | 两路同时带图请求 → vision.log：`ggml_vulkan: device lost on Vulkan0` → `mtmd_batch_encode: ErrorDeviceLost` → `failed to process mtmd chunk`；app.log：`视觉 sidecar 退出（code=3221226505）`。源码 22:01 版已加「视觉转发串行队列」（app.mjs 1919/2040 行），**但 dist/zip 是 21:44/21:48 的版本，不含该修复** |
| A7 | 视觉思考型模型的输出口径 | 🟡 | 该模型默认开思考：max_tokens=120 时 finish_reason=length、content 为空，答案全在 reasoning_content（QWEN/42/hello 都在）；改用 chat_template_kwargs.enable_thinking=false + max_tokens=512 后 content 正常。建议请求侧默认关思考或抬高 max_tokens，否则前端会显示空白 |
| A8 | 使用说明.txt | 🟡 | 4,939 B，与 v1.2.0 完全相同（hash 652DF809…）：未提「看图」按钮、未提 visionModel/visionMmproj、目录结构未列 app\llama\（101MB） |

## 4. 视觉实测记录（含 vision.log 证据）

### 4.1 干净串行（PASS）

```
22:00:52  app.log 视觉：启动 Qwen3.5-9B-Q4_K_M.gguf + Qwen3.5-9B-mmproj-F16.gguf（pid 568）
22:01:03  app.log 视觉 sidecar 就绪（11.9s，pid 568）
vision.log  0.11.269 load_model: model loaded ; 0.11.307 listening on http://127.0.0.1:8101
            0.21.726 prompt processing n_tokens=249 (7.27s) ; 0.26.050 eval 21 tokens 3.02s ; total 11.6s
answer      "图中文字和数字为：QWEN 42 hello。图形颜色为：红色。"（finish_reason=stop）
22:01:18  app.log 视觉：停止 sidecar（pid 568） ; 22:01:21 sidecar 退出（code=1）
8101 listeners after = 0 ; llama-server procs = 0 ; freeMB 18,131
```

### 4.2 并发碰撞（FAIL，包内版本）

```
13:57:32 vision.log ===== 启动视觉 sidecar（pid 8788）
0.26.946 E ggml_vulkan: device lost on Vulkan0
0.26.949 E mtmd_batch_encode: error: vk::Device::getFenceStatus: ErrorDeviceLost
0.26.949 E slot encode_mtmd_: failed to encode mtmd batch for chunk idx = 67
0.26.949 E srv send_error: task id = 0, error: failed to process mtmd chunk
21:58:00 app.log 视觉请求 1 张图 stream 200 8886ms
21:58:01 app.log 视觉 sidecar 退出（code=3221226505）
```
（另一次 13:56:14 的启动也在 0.46.6 出现同类 device lost；该次无我方请求参与，属并发/GPU 争用。）

### 4.3 时间口径

Lead 预期 start 约 6-7s：实测冷启 sidecar 本身约 6.1s（vision.log 0.06.2 就绪），但 /api/vision/start 接口在「有预加载模型」时先卸模型，实测 8.9s / 9.9s / 12.0s。

## 5. 异常与建议

1. 🔴 **交付包落后于源码（本轮必看）**：22:01:26-29 源码 app.mjs/app.html 被改（新增视觉转发串行队列 + 相关前端），dist/zip 仍是 21:44/21:48 版本。按 technique/05「源码一致」和「包能解决并发崩溃」的要求，需要重跑 build-portable.ps1 + make-zip.ps1 后重新验证。package.json 源码已 1.3.0（打包时为 1.2.0，包内不含 package.json，不影响运行，但三处一致口径要重跑）。
2. 🟡 dist\config.ini modelDir=D:\LocalModels（mtime 21:55:31，打包后被试跑/探针写入；非打包输出，zip 内已消毒为空）。
3. 🟡 使用说明.txt 未更新：用户看不到「看图」入口、mmproj 放哪、visionModel/visionMmproj 怎么填、app\llama\ 是什么。建议本轮补一段（照 technique/05 同步目录结构）。
4. 🟡 视觉模型是思考型（Qwen3.5-9B）：默认参数下 content 可能为空（答案在 reasoning_content）。建议 sidecar 请求侧统一 enable_thinking=false，或前端同时渲染 reasoning_content，并给非流式请求 max_tokens 兜底 ≥512。
5. 🟡 崩溃可观测性：sidecar 异常退出码 3221226505 只进 app.log，/api/vision/state 只给 running=false + error 字符串；建议 error 带退出码与最近一次失败原因，前端可直接提示。
6. ⚪ 过程记录：21:56-21:58 我按 Lead 要求发带图请求时，prober 的 E2E 也在发图，构成并发碰撞（即 §4.2）；我已 stop，8101 已释放。此后按 Lead 指示独占串行重测，得到 §4.1 PASS。

## 6. 建议的修复判据（串行锁验收口径）

1. **并发 2 条带图请求**：两条都返回 200（或第二条 429 明确提示“视觉忙，请稍后”），其中至少一条回答含 QWEN/42；vision.log 不得出现 `device lost` / `mtmd_batch_encode` / `failed to process mtmd chunk`；sidecar pid 不变、8101 持续监听。
2. **串行范围**：代理层把整段 /v1 转发（含 stream）放进同一 async 队列；排队日志记 queue_wait_ms；客户端断开或超时时必须释放锁（用 AbortController 的 finally）。
3. **start/stop 与在途转发互斥**：转发在途时再点 start 应 409 或等待；stop 应等在途转发结束再 kill，避免 0xC0000409（本次 stop 恰在并发请求中被触发）。
4. **崩溃兜底**：sidecar 异常退出 → /api/vision/state.running 立即 false、error 带 exit code；前端提示“视觉模型崩溃，已停止”。
5. **重打交付包后复验**：dist/zip 的 app.mjs / app.html SHA256 与 server\ 相同（本次 server=644D118A… / 345CB2E5…）；package.json、APP_VERSION、/api/version 三处 1.3.0；zip 内 app/llama 仍 53 文件；解压冒烟 + runtime node --check 通过。
6. **探针补用例**：probe-vision-api 增加「并发 2 图不崩」「思考型模型 content 空 → reasoning_content 有内容」两条断言。

## 7. 证据文件（verify-files\）

| 文件 | 内容 |
|---|---|
| item-static.txt | dist/zip 静态检查全量原始输出（文件清单、哈希、config、vision 标记、zip 结构/内容/卫生） |
| hash.txt | 4 份源码 SHA256 全值（server vs dist，21:56 时点） |
| zip-entries.txt | zip 全 3,997 条目（名称/解压尺寸/压缩尺寸） |
| extract-and-diff.txt | 解压冒烟 + 与 v1.2.0 zip 差异原始输出 |
| zip-diff-v120-to-v130.txt | 差异明细（+54 / -0 / ~3） |
| vision-live-test.txt | 第一次实测（与 prober 并发碰撞，device lost + sidecar 退出） |
| vision-live-test-retry.txt | 两次串行重试（max_tokens=120 → content 空、reasoning_content 有答案） |
| vision-live-test-final.txt | 干净串行 PASS（enable_thinking=false，content 正常 + stop + 8101 释放） |
| vision-chat-raw-attempt1/2.json、vision-chat-raw-final.json | 三次带图请求原始响应 |
| vision-log-excerpt.txt | vision.log 关键片段（并发 device lost / 成功一次） |
| app-log-excerpt.txt | app.log 关键行（启动/就绪/停止/退出码） |
| llama-server-version.out/err.txt、extracted-llama-version.err.txt | 包内与解压后 llama-server.exe --version 输出 |
| api-state.json | /api/state 原始响应（7 个模型、无 mmproj） |
| extract-dir.txt | 解压临时目录（%TEMP%\qytp-verify-v130-20261107-220144，可删） |

## 8. 判定总表

| 组 | 结果 |
|---|---|
| technique/05 12 项 | 10 🟢 / 1 🟡（5a dist config）/ 1 🔴（3 源码一致，因 22:01 源码改动） |
| 本轮附加 A1-A8 | A1-A5 🟢 / A6 🔴（并发崩溃，包内未含修复）/ A7-A8 🟡 |
| 交付前动作 | 重打 dist + zip（含串行锁），然后复跑本表 3/8/A6 三项 + 解压冒烟 |

## 9. 收尾状态与后续修复方向（Lead 2026-11-07 22:0x 定，本轮不重测）

### 9.1 收尾时点状态（22:04:13 实测）

- /api/vision/state：running=false、starting=false、pid 空；8101 监听 0；llama-server 进程 0（本轮的视觉测试已全部 stop，未留进程）。
- 8099 保留且正常：/api/version = 1.3.0，pid 31404，/api/state 200；app\server.pid = 31404；空闲内存 18,847 MB。
- 全程未重启 8099、未改 dist/zip。

### 9.2 修复方向（Lead 已定，v1.3.0 重打包后另验）

1. sidecar 默认改用 CPU 后端（-ngl 0）——直接消除本次 §4.2 的 `ggml_vulkan: device lost on Vulkan0` 根因（Intel Arc iGPU 上 9B 模型 + Vulkan 编码图像的稳定性问题）。
2. 视觉转发串行锁（源码 22:01 版已有雏形，需进包）。
3. sidecar 崩溃自愈（异常退出后自动重启 / 状态复位，并把退出码暴露到 /api/vision/state）。

### 9.3 重打包后的复验要点（给下一轮）

- 交付包内 app.mjs / app.html 的 SHA256 必须等于 server\（当前 server=644D118A… / 345CB2E5…），且 /api/version、APP_VERSION、package.json 三处均 1.3.0。
- 视觉实测仍按「单条串行 → 含 QWEN/42；并发 2 条 → 不崩、vision.log 无 device lost」两组做；CPU 后端下耗时预期变长（本轮 Vulkan 单图：start 12.0s、prompt 253 tok / 8.6s、生成 21 tok / 3.0s、总 11.7s），判据改为「不报错 + 内容正确」，不要卡死秒数。
- 若仍保留 Vulkan 可选（配置项），需保留 -ngl 可配并默认 CPU，且在 Intel Arc 上复测并发。



---

## 10. 重打包后的补充（Lead，2026-11-07 22:10）

22:01 源码加入了「CPU 后端 + 串行队列 + 崩溃自愈」，第一版包（sha `B592FBCC…`）落后于源码，已在 22:08 重打：

| 项 | 第一版（verifier 验的） | 修复后重打 |
|---|---|---|
| zip | 166,189,978 B / sha `B592FBCC…` | **166,193,520 B / sha `103D6777…`** |
| app.mjs / app.html | 289,073 / 322,530 | **296,010 / 325,890** |

重打后 Lead 复核：zip 内 app.mjs/app.html 与 `server\` 同字节；3997 条目、前缀/正斜杠/卫生全过；`app/llama/llama-server.exe` + `mtmd.dll` 在；发布包（CPU sidecar）串行 3/3、并发 2/2、**device lost 0 次**、pid 不变。
verifier 的判据 §6 仍适用；如需第三方复验，请按 §6 验证新包（3/8/A6 + 解压冒烟）。
