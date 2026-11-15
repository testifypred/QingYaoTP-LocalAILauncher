# 视觉增强包拆分 —— 实现契约（v1.6.0）

> 2026-11-15 第二十一轮。目标：主包 **158.5MB → ~122MB**，把 `app\llama\`（101.1MB / 53 文件）拆成可选「视觉增强包」，
> 设置 → 视觉 里一键装 / 卸。**改完必须跑探针、日志只追加、同步 dist、交付用 zip。**

## 0. 硬约束（本项目既有约定，别踩）

- 零依赖：只用 Node 内置模块（`node:zlib` / `node:fs` …）。不引入 zip 库。
- 不写死盘符：一切由 `import.meta.url` 推导 + 环境变量覆盖。
- 破坏性接口（安装/卸载）必须校验 `x-local-token`（令牌从 `GET /api/state` 的 `localToken` 取），无令牌 **403**。
- `.ps1` 改动必须保留 **UTF-8 BOM**，改完用 PS5.1 Parser 复验。
- 界面探针共用一个页面，串行跑；跑前备份 `workspace\sessions`。
- 交付产物：`dist\QingYaoTP-AILauncher-v1.6.0.zip`（主包）+ `dist\QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（增强包）。
- 证据目录：`server\docs\feature-vision-pack-2026-11-15\`（各人只管自己那几个文件，别互相覆盖）。

## 1. 版本

三处同步到 **1.6.0**：`server\app.mjs` 的 `APP_VERSION`、`server\package.json` 的 `version`、`server\localai.mjs` 的 `VERSION`。
（`make-zip.ps1` / `make-vision-pack.ps1` 都从 `app.mjs` 解析，不手改。）

## 2. 布局

**主包**：不含 `app\llama\`。`app.mjs` 的 sidecar 查找顺序不变（环境变量 → `app\llama` → 开发目录 `tools\llama.cpp`）。

**视觉增强包 zip**（`QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`）：

```
QingYaoTP-AILauncher-v1.6.0-vision-pack/     <- 顶层目录（提取器要能剥）
  vision-pack.json                           <- 清单（见下）
  llama/<llama.cpp b12144 全部 53 个文件>    <- 原 app\llama 的内容
```

`vision-pack.json`：

```json
{ "format": 1, "name": "QingYaoTP AILauncher 视觉增强包", "version": "1.6.0",
  "sidecar": "b12144", "createdAt": "2026-11-15T…Z", "files": 53, "bytes": 106004121 }
```

**安装后**在 `app\llama\` 里额外写一个标记 `.vision-pack.json`（同上内容 + `installedAt` + `pack` 文件名 + `sha256`），
用来区分 `source`：有标记 = `pack`；只有文�� = `legacy`（从 ≤1.5.1 升上来的老包）；开发目录 `tools\llama.cpp` = `tools`；都没有 = `none`。

**required 文件**（缺一个就拒装，防半截包）：

`llama-server.exe`、`llama-server-impl.dll`、`llama.dll`、`llama-common.dll`、`ggml.dll`、`ggml-base.dll`、`mtmd.dll`、`libomp.dll`

## 3. 后端 API（本轮由 Lead 实现）

### GET /api/vision/pack （只读，不需要令牌）

```json
{ "ok": true, "installed": true, "dir": "…\\app\\llama", "target": "…\\app\\llama",
  "source": "pack|legacy|tools|none", "version": "1.6.0", "sidecar": "b12144",
  "files": 53, "bytes": 106004121, "installedAt": "…", "uninstallable": true, "running": false,
  "available": [ { "path": "…zip", "name": "…zip", "bytes": 41234567, "version": "1.6.0" } ],
  "note": "" }
```

- `installed` = `<dir>\llama-server.exe` 存在（dev 下 `dir` 是 `tools\llama.cpp`，也算 installed、source=`tools`）。
- `uninstallable` = `dir` 就是安装目标（`<app>\llama` 或 `LOCALAI_LLAMA_DIR`），开发目录的 `tools\llama.cpp` **不可卸**。
- `available` = 在搜索目录里找到的 `*vision-pack*.zip`（搜索目录：`LOCALAI_VISION_PACK_DIR`（;分隔）> 默认 `<app>\..`、`<app>\vision-pack`、`<app>\..\dist`）。名字里能解析出 `v1.2.3` 就带上 `version`。

### POST /api/vision/pack/install （令牌必需）

两种 body，按 `content-type` 区分：
- `application/json`：`{ "path": "<zip 路径>", "dryRun": false }`
- 其它（`application/zip` / `application/octet-stream`）：**原始 zip 字节流**，流式落盘到临时文件再装（不走 4MB 的 readBody 上限）。

行为：sidecar 在跑就先 `stopVision()`（Windows 文件锁）；解析 zip → 校验清单/required/路径穿越 → 解到临时目录 → 原子换目录 → 写标记。
成功 200：

```json
{ "ok": true, "installed": true, "dryRun": false, "stoppedSidecar": true,
  "install": { "version": "1.6.0", "files": 53, "bytes": 106004121, "sha256": "…", "tookMs": 1234, "skipped": 0 },
  "pack": { …同 GET /api/vision/pack 的字段… } }
```

错误：无令牌 403；path 不存在 404；不是视觉增强包 / 缺 required / 非法条目 400；装不上（权限/被占用）409。
**dryRun 只校验不落盘、不停 sidecar。**

### POST /api/vision/pack/uninstall （令牌必需）

`{ "dryRun": false }`。sidecar 在跑先停；删 `<target>` 整个目录。不可卸（开发 tools 目录）→ **409** 并说明。
成功 200：`{ "ok": true, "installed": false, "stoppedSidecar": true, "removedBytes": 106004121, "pack": {…} }`

### GET /api/vision/state 新增字段

`pack: { installed, dir, source, version, files, bytes, uninstallable }`；未安装时 `note` 追加
「视觉增强包未安装：设置 → 视觉 → 安装视觉增强包（可选能力，不看图可忽略）」。
`POST /api/vision/start` 未安装时返回 **409**（不是 500），message 指到设置页。

## 4. 前端（app.html，设置 → 视觉 顶部新卡）

```html
<div class="field" id="vpCard" data-installed="1">
  <span class="lbl">视觉增强包 <i>可选 · 约 40MB</i></span>
  <em id="vpStatus">…</em>            <!-- 已安装 v1.6.0 · 53 个文件 / 101.1 MB  |  未安装 -->
  <em id="vpDetail">…</em>            <!-- 安装目录 / 来源（包安装 / 老版本自带 / 开发目录） -->
  <div class="exportRow">
    <button id="vpInstallBtn" class="ghost" type="button">安装视觉增强包…</button>
    <button id="vpUninstallBtn" class="ghost" type="button">卸载</button>
    <input id="vpFile" type="file" accept=".zip" hidden>
    <span id="vpHint" class="hintText">—</span>
  </div>
  <div id="vpDetected" hidden></div>   <!-- 「检测到本地增强包：<name>（40MB）[一键安装]」，可多个 -->
  <div id="vpProgress" hidden></div>   <!-- 上传/解压进度：47% · 解压中… -->
</div>
```

行为要求：
1. 打开「视觉」页时拉 `GET /api/vision/pack` 渲染；装/卸完立刻刷新，并同步 `visionStateCache`。
2. 未安装：`#setVisionStart` 禁用、组合下拉禁用、`#imgBtn` 点击只弹 toast「视觉增强包未安装：设置 → 视觉 → 安装视觉增强包」。
3. 安装两条路：`#vpFile` 选 zip → `XMLHttpRequest` POST 原始字节（带 `x-local-token`，`upload.onprogress` 更新 `#vpProgress`）；
   或点「一键安装」→ POST JSON `{path}`（来自 `available[0]`）。两者成功都 toast + 刷新。
4. 卸载：`confirm()` → POST → 刷新；卸载中按钮禁用。
5. 已安装时 `#vpCard` 的 `data-installed="1"`，否则 `"0"`（探针据此断言）。
6. 别动现有 id：`#setVisionPair/#setVisionState/#setVisionStart/#setVisionStop/#setVisionHint/#setVisionEdge/#setVisionParams/#setVisionLog`。

## 5. 打包脚本（server\*.ps1，BOM！）

- **新建 `server\make-vision-pack.ps1`**：`tools\llama.cpp` → `<dist>\QingYaoTP-AILauncher-v<ver>-vision-pack.zip`（顶层目录 + `vision-pack.json` + `llama\`）。
  自检：required 8 件齐、条目数 = 53+1、打印 MB/条目/SHA256；源缺文件直接 `exit 1`。
- **`build-portable.ps1`**：删掉「复制视觉 sidecar（llama-server.exe）」那一步，改成**确保 `$AppDir\llama` 不存在**（删旧），
  打印「视觉已拆分：主包不带 app\llama；用 make-vision-pack.ps1 生成增强包」；加 `-BundleVision` 开关（默认关，开了恢复旧行为）。
  同步更新脚本头上/`config.ini` 模板里提到 `app\llama` 的说明文字；打包后自检里加「app\llama 不存在（除非 -BundleVision）」。
- **`make-zip.ps1`**：robocopy 排除 `app\llama` 作兜底；打完断言 zip 里**没有** `app/llama/` 条目；输出里报大小/条目。
- 目标：主包 ~122MB / 视觉包 ~40MB（ggml-vulkan.dll 42MB 压缩率高）。

## 6. 探针

- **新建 `server\probe-vision-pack.mjs`**（纯 API，自己起一个临时服务实例）：
  `PORT=8199`、`MODEL_DIR=<临时目录>`、`LOCALAI_LLAMA_DIR=<临时目录>\llama`、`LOCALAI_VISION_PACK_DIR=<临时目录>\packs`，
  `spawn(process.execPath, ['app.mjs'], {cwd: server, env})`，轮询 `/api/state` 就绪。覆盖：
  ① state 初始未安装；② 无令牌 403；③ 假 zip（不是包）400；④ 缺 required 400；⑤ 路径穿越条目被拒/不落地；
  ⑥ store-zip 小包（`diag-zip.mjs` 的 `zipStore`）path 安装成功 → installed/files/version/source=pack；
  ⑦ dryRun 不落盘；⑧ 覆盖安装幂等；⑨ uninstall → 目录消失、installed=false；⑩ 开发目录不可卸（把 LOCALAI_LLAMA_DIR 指到 `tools\llama.cpp` 的实例？——**在 8199 实例里不放**，改为对 8099 只读断言 `uninstallable===false` 不行；
  改成：第二次 spawn 一个实例把 target 指到 `<temp>\toolslike` 且…（实现时按实际能力取舍，最少要覆盖 ①-⑨ + available 检测 + 上传流安装）。
  ⑪ 原始字节流上传安装（fetch body=zip Buffer）。
  收尾：`finally` 杀掉临时服务 + 删临时目录。
- **新建 `server\probe-ui-vision-pack.mjs`**（CDP + 临时服务）：把共享页面导航到 8199 → 视觉页显示未安装
  （`#vpCard[data-installed="0"]`、启动键禁用、`#vpDetected` 里有本地包）→ 点「一键安装」→ 已安装 + 启动键可用
  → 点「卸载」→ 未安装；**finally 必须导航回 `APP`（8099）并等待就绪**，否则后续界面探针全红。
- `probe-vision-api.mjs`：加 2 条 —— `state.pack` 对象存在、`state.pack.installed === true`（25 → 27）。
- `run-full.ps1`：在 `probe-ui-vision` 之前插 `probe-ui-vision-pack`、在 `probe-vision-api` 之前插 `probe-vision-pack`，
  驱动 **57 → 59 条**（`$probes.Count` 自算，别手写数）。**改完必须 PS5.1 Parser 复验 + BOM。**

## 7. 文档（README / 交接 / 日志 / 启动词）

- `README.md`：新增「视觉增强包（可选）」小节：主包 122MB、增强包 40MB、怎么装（设置 → 视觉 → 安装）、卸载、不看图可忽略。
  `build-portable.ps1` 会把 README 拷进 `app\README.md`。
- `交接文档.md`、`DeveloperRealtimeLog.md`（**只追加**，新一节）、`新会话启动词.md`（现状快照 + 下一步）、
  `technique\05-打包.md`（两个 zip）、`technique\07-坑与约定.md`（拆分后的约定）。

## 8. 验收

1. `probe-vision-pack` 全绿（dev）。
2. `probe-ui-vision-pack` 全绿；回归 `probe-ui-vision` 19/19、`probe-vision-api` 27/27。
3. 全量 `run-full.ps1` **59 条**全绿。
4. `build-portable.ps1` → 主包目录无 `app\llama`；`make-vision-pack.ps1` → 增强包 zip；`make-zip.ps1` → 主包 zip。
5. 发布包冒烟：起 dist → `POST /api/vision/pack/install {path: dist\…vision-pack.zip}` → `/api/vision/state` 的 `pairs >= 1` 且 `pack.installed === true` →
   `probe-version` 14/14、`probe-debug` 54/54；再 `probe-vision-api`（真 9B 视觉，最硬的一条）。
6. 证据落 `server\docs\feature-vision-pack-2026-11-15\`；`git commit`；日志追加。
