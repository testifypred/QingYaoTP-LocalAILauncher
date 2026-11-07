# v1.3.0 重打包 + 交付 zip（2026-11-07 第十二轮）

> 结论：发布包升到 **v1.3.0**（图片入口 / 视觉 sidecar），**359.4 MB / 3496 文件**；交付 zip **166,193,520 B（158.5 MB）/ 3997 条目 / sha256 `103D67778AEF6911FB4EB2851DB0E9221AD29158A9A72ADA7B487C441A8E644E`**，含 `app\llama\`（llama-server + mtmd，101 MB）。
> 22:08 重打的原因：22:01 的源码加了「视觉请求串行队列 + CPU 后端 + 崩溃自愈」，第一版包（sha `B592FBCC…`）落后于源码；本包与源码一致。

## 一、为什么重打

本轮加了图片入口（`app.mjs` 累计 +795、`app.html` +800），并把官方 llama.cpp 的 `llama-server` 打进包；版本 1.2.0 → 1.3.0。

## 二、产物

| 项 | 值 |
|---|---|
| 发布目录 | `dist\QingYaoTP AILauncher`：**359.4 MB / 3496 文件**（app\ 245.4 MB，其中 `app\llama\` 101.1 MB；data\ 162.3 MB 运行期缓存另算） |
| **交付 zip** | `dist\QingYaoTP-AILauncher-v1.3.0.zip`：**166,193,520 B（158.5 MB）/ 3997 条目** |
| zip SHA256 | `103D67778AEF6911FB4EB2851DB0E9221AD29158A9A72ADA7B487C441A8E644E`（22:08 重打） |
| 启动器 / 调试 | 57,856 B / 42,496 B |
| 视觉 sidecar | `app\llama\llama-server.exe`（9,728 B，b12144/v0.9.0-dev）+ `mtmd.dll` + `ggml-vulkan.dll` + `llama-server-impl.dll` |
| 便携配置 | zip 内 `config.ini`：`modelDir=` 空、`visionModel=` / `visionMmproj=` 空行、无本机路径 |
| 使用说明 | 新增「九、看图（视觉 sidecar）」，含 mmproj 放置、首次等待、内存互斥、VISION_NGL 说明 |
| 版本 | `APP_VERSION` / `package.json` / `/api/version` = 1.3.0 |

## 三、自检

| 项 | 结果 |
|---|---|
| 构建 | 8+1 步全过（新增「复制视觉 sidecar」101.1 MB）；退出 0 |
| zip 结构 | 3997 条目；全 `QingYaoTP AILauncher-v1.3.0/` 前缀；正斜杠；反斜杠 0；`.pid/.log/.tmp` 0 |
| 源码一致 | zip 内 app.mjs **296,010** / app.html **325,890**，与 `server\` 同字节 |
| zip 卫生 | 无 `*.gguf`、无 mmproj、无 data/logs 实体；`app/llama/llama-server.exe` + `mtmd.dll` 在 |
| 运行发布包 | `/api/version` 1.3.0、dir=dist\...\app；模型 7 个且不含 mmproj；`/api/vision/state` pairs=1 |
| 发布包视觉实测（CPU 后端） | start **9.8s**；串行 3 条 **13.1/2.6/2.6s**（内容均 `QWEN 42 hello`）；并发 2 条都 200（13.4/15.7s）；**pid 不变、device lost 0 次**；stop 后 8101 释放 |
| 探针复跑 | probe-vision-api 25/25、probe-ui-vision 19/19、probe-version 14/14、probe-debug 35/35、probe-func 9/9、probe-start-flow 8/8、probe-status 6/6、probe-code-panel 17/17+跳过 1 |
| 独立复核 | verifier 已验第一版（12 项 10🟢/1🟡/1🔴，🔴 = 包落后源码）；本包按同一判据由 Lead 复验哈希/zip/视觉，verifier 复验待叫（3/8/A6） |

## 四、与 v1.2.0 的差异

| 项 | v1.2.0 | v1.3.0 |
|---|---|---|
| 发布包载荷 | 258.2 MB / 3443 | **359.4 MB / 3496**（+101 MB llama-server，+53 文件） |
| 交付 zip | 121.8 MB / 3943 | **158.5 MB / 3997** |
| app.mjs / app.html | 262,620 / 298,897 | **296,010 / 325,890** |
| config.ini | 963 B | +`visionModel` / `visionMmproj` 两行及注释（1,165 B） |

## 五、遗留

- sidecar 无闲置自动退出；CPU 首张图 10–35s；GPU（`VISION_NGL=99`）在这台核显会 device lost，仅作开关保留。
- 交付包变大 101 MB：可选「视觉增强包」拆分分发（下一轮）。

## 六、证据

| 文件 | 内容 |
|---|---|
| `build.out.txt` / `build-final.out.txt` | 打包 transcript（含 llama-server 复制；final = 修复后重打） |
| `verify.md` + `verify-files\` | verifier 复核（第一版）+ 崩溃链留证 |
| `server\docs\feature-vision-sidecar-2026-11-07\` | 功能层证据（含 28/28 并发/自愈自测） |
