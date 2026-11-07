# 功能契约：图片入口（视觉 sidecar）v1.3.0

> 2026-11-07 第十二轮。Lead 已验证 sidecar 链路（真图 OCR 成功），下面定死接口与 DOM，backend / frontend / prober 并行实现。

## 一、为什么走 sidecar

底层 llama.cpp 二进制有 `mtmd/mmproj/qwen2vl/qwen3vl` 支持，但 JS 绑定 **node-llama-cpp 3.22.x 没有视觉 API**（3.22.3 类型定义里 mmproj/image 零命中）。因此：

- 随包带官方 `llama-server.exe`（llama.cpp **b12144 / v0.9.0-dev** Vulkan 构建，已下载到 `D:\LocalModels\tools\llama.cpp`，101MB）；
- 视觉请求时启动 sidecar（独立进程、独立端口 8101），主服务把带图请求转发过去；
- **同一时间只允许一个重模型**：启动 sidecar 前卸载 nlc 文本模型；加载文本模型前停掉 sidecar。

### Lead 已验证的命令与参数（照抄，别改）

```powershell
llama-server.exe -m <model.gguf> --mmproj <mmproj.gguf> -c 8192 -ngl 99 --host 127.0.0.1 --port 8101 --jinja --no-webui -np 1
```

- 健康检查：`GET http://127.0.0.1:8101/health` → `{status:'ok'}`；模型加载约 16s（mmap）。
- 视觉请求走 OpenAI 格式：`content:[{type:'text',text:...},{type:'image_url',image_url:{url:'data:image/png;base64,...'}}]`
- **必须带 `chat_template_kwargs:{enable_thinking:false}`**（Lead 实测：不带时 Qwen3.5 会把 200 token 全烧在思考上、`content` 为空；带上后 13.3s 正确读出图中文字 `QWEN 42`）。后端转发时若请求没带，就补上。
- 可选 `--image-min-tokens 1024`（Qwen-VL 官方建议，提升 grounding）。

## 二、路径解析（backend）

```js
// 优先级：环境变量 → 发布包 → 开发目录
const LLAMA_DIR = process.env.LOCALAI_LLAMA_DIR
  || (existsSync(path.join(HERE, 'llama', 'llama-server.exe')) ? path.join(HERE, 'llama') : path.join(HERE, '..', 'tools', 'llama.cpp'));
const LLAMA_SERVER = path.join(LLAMA_DIR, 'llama-server.exe');
```

发布包里由 `build-portable.ps1` 把 `tools\llama.cpp` 拷到 `app\llama\`（Lead 收尾负责）。

## 三、后端接口（app.mjs）

### 3.1 `GET /api/vision/state`

返回：
```json
{
  "ok": true,
  "running": false,
  "port": 8101,
  "pid": null,
  "model": "", "mmproj": "",       // 正在跑的绝对路径
  "startedAt": 0,
  "logPath": "<安装目录>\\logs\\vision.log",
  "pairs": [                          // 扫描出来的「模型 + mmproj」组合
    {"model":"Qwen3.5-9B-Q4_K_M.gguf","mmproj":"mmproj\\Qwen3.5-9B-mmproj-F16.gguf","expect":"9B"}
  ],
  "selected": {"model":"...","mmproj":"..."} | null,
  "note": ""
}
```

- 扫描规则：模型 = `MODEL_DIR` 顶层的 `*.gguf`；mmproj = `MODEL_DIR\mmproj\*.gguf` 以及 `MODEL_DIR` 顶层文件名含 `mmproj` 的 `*.gguf`。
- 配对规则（按优先级）：
  1. `config.ini` 的 `visionModel=` / `visionMmproj=` 都存在且文件存在 → 用它们；
  2. 按文件名族匹配：mmproj 名字里含模型名的主体（去掉 `-Q4_K_M` 之类的量化后缀），如 `Qwen3.5-9B-mmproj-F16.gguf` ↔ `Qwen3.5-9B-Q4_K_M.gguf`；
  3. 都没有 → `pairs` 只给出候选，`selected=null`，`note` 说明「请在 config.ini 指定 visionModel / visionMmproj」。
- 不允许把 mmproj 本身当成「模型」出现在 `/api/state.models` 里（扫描时跳过文件名含 mmproj 的）。

### 3.2 `POST /api/vision/start` `{model?, mmproj?}`

- 未指定则用 `selected`；文件不存在 → 400；`llama-server.exe` 不存在 → 500 并给路径。
- 若 nlc 文本模型已加载：先 `await unloadModel()`（复用现有卸载逻辑），再 spawn。
- spawn 参数照第一节；stdout/stderr 重定向到 `logs/vision.log`。
- 轮询 `http://127.0.0.1:8101/health`（≤120s，每 500ms），成功返回 state；超时 → 杀掉进程 + 504。
- 已 running 且同一组合 → 直接返回 state；不同组合 → 先 stop 再 start。
- 返回 `{ok:true, ...state}`。

### 3.3 `POST /api/vision/stop`

- `taskkill /PID <pid> /T /F` 杀进程树；等待端口释放；返回 `{ok:true, running:false}`。

### 3.4 聊天路由：`POST /v1/chat/completions`

请求体新增可选字段（应用级扩展，不破坏 OpenAI 兼容）：
```json
{"messages":[...], "stream":true, "images":["data:image/png;base64,..."]}
```

- `images` 非空 或 messages 的 content 数组里有 `type:'image_url'` → 走视觉：
  1. 确保 sidecar running（用 `selected`；没有 selected → 409 `{error:{message:'没有可用的视觉模型：请把 mmproj 放到模型目录 mmproj\\ 下或在 config.ini 指定'}}`）；
  2. 把 `images` 数组转成最后一条 user 消息的 `content` 数组（text 在前、image_url 在后）；
  3. 补 `chat_template_kwargs.enable_thinking=false`（若调用方没显式指定）；
  4. `POST http://127.0.0.1:8101/v1/chat/completions`，**stream 原样透传**（SSE 逐块写回），非流式直接回 JSON；
  5. `log('视觉请求 ...')` 一行。
- 无图片 → 现有 nlc 路径不变。
- `/api/load`（加载文本模型）前：若 sidecar running → 先 stop（内存互斥）。

### 3.5 版本

`APP_VERSION` → `1.3.0`；`server/package.json` Lead 同步。

## 四、前端（app.html）

### 4.1 DOM

输入区（footer 里 `#q` 旁边或上方）：
```html
<div id="imgPreview" class="imgPreview" hidden></div>   <!-- 缩略图条：每张 .imgThumb 内含 <img> + <button class="imgDel">×</button> -->
<button id="imgBtn" class="ghost" title="添加图片（也支持粘贴 / 拖拽）">🖼</button>
<input type="file" id="imgInput" accept="image/*" multiple hidden>
```
- 最多 3 张；单张自动缩放到最长边 ≤1024px、JPEG q0.85 的 dataURL；单张 ≤ 4MB 原图。
- 事件：点 `#imgBtn` → 触发 `#imgInput`；`paste`（clipboardData.files 含图片）；`drop` 到 footer；每张缩略图可删。
- 发送时若 `imgs.length` → 请求体带 `images:[dataURL...]`；用户消息气泡里显示缩略图（`.msgImgs img`）。
- 视觉回复：名字旁边显示 `视觉` 小徽标；sidecar 首次启动时状态栏显示「正在启动视觉模型…」（后端 start 可能 10–20s）。
- 设置 → 新增「视觉」页签（或生成页里一段）：`GET /api/vision/state` 展示 pairs 下拉 + 当前 running 状态 + 「启动/停止」按钮；选择存 `localai.visionPair`（`{model, mmproj}`），发送时作为 `POST /api/vision/start` 的入参（若与 selected 不同）。
- 无可用 pair 时点 `#imgBtn` → toast「没有可用的视觉模型（需要 mmproj 文件）」。

## 五、探针

### 5.1 `probe-vision-api.mjs`（纯 API）
1. `GET /api/vision/state` 200 且含 `pairs` 数组；
2. 若 `pairs.length > 0`：`POST /api/vision/start` → `running:true`、`port:8101`、`/health` ok；
3. 用内置的 320×180 PNG（红底白字 `QWEN 42`，base64 常量）发一帧：`POST /v1/chat/completions` `{stream:false, images:[dataURL], messages:[{role:'user',content:'图里的文字是什么？'}]}` → 200 且 content 含 `QWEN`（宽松：含 `42` 或非空也算过，但优先严格）；
4. `POST /api/vision/stop` → `running:false`、8101 无监听；
5. 没有 pair 时：`POST /api/vision/start` → 400/409 且错误信息含「视觉模型」；跳过 2–4 并打印 skip。
- 自复位：结束一定 stop sidecar；不加载文本模型。

### 5.2 `probe-ui-vision.mjs`（UI）
1. `#imgBtn`、`#imgInput`、`#imgPreview` 存在；
2. 用 DataTransfer 注入一张 64×64 PNG 到 `#imgInput`（或直接触发 change）→ `#imgPreview` 出现 1 个 `.imgThumb`；
3. 点 `.imgDel` → 预览消失；
4. 无 pair 时点 `#imgBtn` 出 toast（按 `/api/vision/state.pairs` 条件）；
5. 设置 → 视觉页签存在，含 pairs 下拉/状态文案（按有 pair 条件）；
6. 不发真实视觉请求（太慢），发送路径由 API 探针覆盖；
7. 自复位：清 localStorage `localai.visionPair`、清预览。

## 六、硬约束

- backend 只改 `server/app.mjs`；frontend 只改 `server/app.html`；prober 只加两个探针 + 驱动条目 + docs。**不要动 dist / zip**（Lead 收尾，含 llama.cpp 拷贝与打包）。
- 改完 `node --check`；前端抽内联脚本检查。
- **不要同时加载文本模型和 sidecar**（内存互斥是功能要求，不是建议）。
- 不要动用户的 `workspace/sessions`；测试生成的图片不要留在 workspace。
- 大输出别贴，证据落 `server\docs\feature-vision-sidecar-2026-11-07\`。
- 完成共享任务：`team_task_get` → `claim` → 做完 `complete`。

## 七、报告要求

1. 改动函数/行段；2. 自查结果（node --check / curl / 截图路径）；3. 与契约不一致处及原因；4. 风险与未覆盖项。不要贴大段代码。