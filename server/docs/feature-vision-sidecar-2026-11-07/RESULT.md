# 图片入口：视觉 sidecar（v1.3.0，2026-11-07 第十二轮）

> 用户需求：能不能加图片入口？找几个视觉模型。
> 结论：**能，已落地并实测**——界面可直接传图/粘贴/拖拽；独立 `llama-server`（带 `--mmproj`）看图；**默认 CPU 后端稳定**，串行队列 + 崩溃自愈。

## 一、为什么走 sidecar

底层 llama.cpp 二进制支持 `mtmd/mmproj/qwen2vl/qwen3vl`，但 **node-llama-cpp 3.22.x 没有视觉 API**（3.22.3 类型定义里 `mmproj/image/vision` 零命中）。所以：随包带官方 `llama-server.exe`（llama.cpp b12144 / v0.9.0-dev，101 MB），视觉请求时按需启动，主服务把带图请求转发过去；**同一时间只允许一个重模型**。

## 二、实现

| 层 | 内容 |
|---|---|
| 打包 | `build-portable.ps1` 把 `tools\llama.cpp` 拷到 `app\llama\`（+101 MB）；config 模板加 `visionModel=` / `visionMmproj=`；使用说明加「九、看图」 |
| 后端（app.mjs +795） | `GET /api/vision/state`（pairs/selected/running/starting/error）、`POST /api/vision/start|stop`、带图请求转发（拼 content、补 `enable_thinking=false`、SSE 透传）、`/api/load` 前停 sidecar、mmproj 不进模型列表、退出杀 sidecar 进程树；版本 1.3.0 |
| **稳定性（第二轮修复）** | ① sidecar **默认 CPU 后端 `-ngl 0`**（`VISION_NGL=99` 才上 GPU）；② **串行锁**：FIFO 队列，同一时刻一个视觉请求进 sidecar（排队上限 180s，超时 503；排队期间 `/api/load` 409）；③ **崩溃自愈**：转发前查进程+/health，已退出自动重启；转发失败最多重启重试 1 次，仍失败 502 并带 vision.log 路径 |
| 前端（app.html +548→+800） | 🖼 按钮 + 隐藏 file input + 缩略图条（×删除）、粘贴/拖拽、≤1024px JPEG、最多 3 张、原图上限 20MB（自适应压缩，3 张 dataURL ≈2.1MB）、用户气泡缩略图、助手「视觉」徽标、设置→视觉页签、首屏 hero 也可发图 |
| 探针 | `probe-vision-api`（25 条）、`probe-ui-vision`（19 条）；全量驱动 51 → 53 条 |

## 三、验证（都是真跑）

| 场景 | 结果 |
|---|---|
| 发布包（CPU 后端） | start **9.8s**；串行 3 条 **13.1s / 2.6s / 2.6s**（第 2、3 条 KV 复用），内容均 `QWEN 42 hello`；并发 2 条都 200（13.4s / 15.7s，串行队列）；**sidecar pid 不变、device lost 0 次**；stop 后 8101 释放 |
| 源码模式（第二轮修复前，Vulkan） | 曾出现 `ggml_vulkan: device lost` → `mtmd_batch_encode ErrorDeviceLost` → sidecar 退出 0xC0000005；**已用 CPU 后端消除**（GPU 保留 `VISION_NGL=99` 开关） |
| `probe-vision-api` | **25/25**（state/start/stop、内存互斥、内置 PNG 严格含 `QWEN 42`） |
| `probe-ui-vision` | **19/19**（按钮/预览/删除/设置页/无 pair toast/自复位） |
| UI 端到端 | 注入真图 → 发送 → 气泡缩略图 + 「视觉」徽标 + 正确回答（截图 `logs/ui-vision-e2e.png`） |
| 后端自测（8102 + CPU sidecar） | 串行 3/3、并发 2/2、外部杀进程后自动重启（200）、stop 释放；**28/28 PASS** |

## 四、性能基线（这台机器：Core Ultra 7 155H / 32GB LPDDR5x）

- sidecar 冷启动 **9.8–15.3s**（CPU；解除文本模型/预加载模型后更慢一点）
- 首张图 **13–34s**（图像编码 + 生成；取决于图大小/上下文）
- 相同图文重复请求 **2.6–2.9s**（KV 复用）
- 生成速度 ~2.6 tok/s（CPU 9B）；GPU 会快得多但**这台核显 Vulkan 编码会 device lost**，所以默认 CPU

## 五、改动清单

| 文件 | 改动 |
|---|---|
| `server\app.mjs` | L37 版本；L44–70 sidecar 路径/参数（VISION_NGL）；L1234 mmproj 跳过；L1475–2032 视觉实现；L1920–1993 串行队列；L1978/2049–2200 崩溃自愈；L5545–5572 路由；L5627–5637 `/api/load` 互斥；L6445–6448 带图分流；L6805–6813 退出清理 |
| `server\app.html` | CSS 568–589；footer 1024–1027；设置页签 1358；视觉设置 1423–1443；图片模块 1696–1929（20MB 上限/单次解码/自适应压缩/像素守卫）；发送/气泡 5452–5580；视觉页 JS 5894–6042；hero 4169–4218 |
| `server\build-portable.ps1` | 新增「复制视觉 sidecar」步骤 + config 两键 + 使用说明「九、看图」 |
| `server\make-zip.ps1` | 默认值升 v1.3.0；config 消毒增加 visionModel/visionMmproj |
| `server\probe-vision-api.mjs` / `probe-ui-vision.mjs` | 新增（后者修了 input.files 取数时机） |
| `server\docs\probe-full-2026-11-02\run-full.ps1` | 51 → 53 条 |
| `technique\02-接口.md` / `technique\05-打包与部署.md` | 视觉接口段 / app\llama 与 zip 口径 |

## 六、已知限制（下一轮）

1. **CPU 后端慢**：首张图 10–35s，生成 ~2.6 tok/s；GPU 在部分核显（这台）会 device lost，所以默认 CPU 保稳定。
2. **一次只能一个重模型**：看图会卸载文本模型，看完要重新选模型；sidecar 不自动闲置退出（手动停或加载文本模型时自动停）。
3. 请求体上限仍 4 MB（前端自适应压缩后 3 张约 2.1MB，通常安全）；HEIC 浏览器解不了；>80MP 图要求先缩小。
4. 只实测 Qwen3.5-9B + 其 mmproj；其它模型/mmproj 组合未实测。
5. 排队 180s 超时、启动 504、`/api/extras/preload` 与视觉的内存互斥未覆盖。
6. 发布包因此 +101 MB（zip 121.8 → 158.5 MB）。

## 七、证据

| 路径 | 内容 |
|---|---|
| `server\docs\feature-vision-sidecar-2026-11-07\` | CONTRACT、backend-selftest（含并发/崩溃自愈 28 条）、frontend-selftest、prober-notes、截图 |
| `server\docs\vision-sidecar-2026-11-07\logs\` | Lead 集成日志：probe-vision-api / probe-ui-vision / e2e-ui-vision / ui-vision-e2e.png |
| `server\docs\packaging-2026-11-07-v13\` | 打包 transcript、verify.md（含崩溃链留证） |
