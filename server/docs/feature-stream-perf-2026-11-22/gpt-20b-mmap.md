# GPT-OSS 20B 内存爆炸与加载速度（2026-11-22 修复）

> 用户反馈：加载 20B 把 31.4GB 内存吃满；卸载后仍有 ~20GB「诡异占用」。

## 结论

根因不是 Vulkan 本身，而是 **node-llama-cpp 的 `useMmap:auto` 在 Windows Vulkan 上走了 mmap**：
- 该后端 `gpuSupportsMmap=false`（GPU 不能直接访问 mmap 的文件页）；
- 但 `supportsMmap=true`，auto 仍给 CPU 侧开了 mmap；
- 结果：12.1GB 权重**同时**留在文件映射里 + 再拷一份到核显共享内存 → 实际占用 ~24GB + KV + 系统，31.4GB 直接见底。

修复：三处 `llama.loadModel` 显式传 **`useMmap: false`**（主模型 / 预加载常驻 / 草稿模型）。

## 实测对比（同一台机器，4B / 20B，Vulkan）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 20B 加载耗时 | **48.6s** | **14.0s**（ctx 16384）/ 8–11s（ctx 4096） |
| 20B 加载后可用内存 | **0.0GB**（开始换页） | **8.14GB** |
| 20B 生成速度 | 无法稳定测（内存见底） | **13.7 tok/s**（ttft 1.66s） |
| 20B 卸载后 | 可用 23.7GB，但备用缓存 11.8GB（看着像 20GB 没还） | 可用 20.3GB、GPU 共享 1.62GB（干净） |
| 4B 加载 | ~6–8s | **5.9s**，可用 16.25GB |
| 4B 生成 | — | **15.3 tok/s**（ttft 1.0s） |

独立基准（ctx 4096、32 tokens）进一步确认：

| 姿势 | 加载 | 生成 |
|---|---|---|
| 20B CPU+mmap | 4.4s | 3.51 tok/s |
| 20B 部分 offload 12 层 | 15.3s | 4.86 tok/s |
| 20B 部分 offload 20 层 | 9.6s | 9.76 tok/s |
| **20B 全 offload + useMmap:false** | **8.1s** | **15.69 tok/s** |
| 4B 全 offload + useMmap:false | ~2s | 17.5–18.3 tok/s |

## 试过但没用的“提速项”

- `batchSize` 512 / 1024 / 2048（~3300 字 prompt）：ttft 3940 / 3876 / 4113ms → **512 最好**，不动。
- `flashAttention` true / false：4B 同口径 17.5–18.3 vs 17.7 tok/s → 无显著差异（KV 量化路径本来就 auto）。
- 部分 offload 不如全 offload（20 层 9.76 vs 25 层 15.69）——核显上把层留在 CPU 反而拖慢。

## 文件

- `server\app.mjs`：`loadModel` / `preloadModel` / 草稿模型三处 `useMmap:false`；
- `dist\QingYaoTP AILauncher\app\app.mjs` 已同步，8099 已重启（4B 已加载）。

## 复跑

- `bench-20b-speed.mjs` / `bench-20b-full.mjs` / `bench-models.mjs` / `bench-4b-abba.mjs` / `bench-batch.mjs`（本目录）
- `bench-app-20b.mjs`：走真实 `/api/load` + `/v1/chat/completions` 的应用层验证
