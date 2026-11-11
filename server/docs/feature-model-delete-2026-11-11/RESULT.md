# 删除模型 · 交付记录（2026-11-12）

> 需求：模型菜单里直接删掉模型文件。破坏性操作：先确认、默认进回收站、正在使用的不许删。

## 一、接口契约（新增）

`POST /api/models/delete`（需 `x-local-token`，否则 403）

~~~jsonc
{ "file": "Qwen3.5-9B-Q4_K_M.gguf", "dryRun": true }   // dryRun 可省略（默认 false）
~~~

- `dryRun:true` → 只校验、不删文件，返回 `{ok,dryRun:true,file,files:[{name,bytes,mb}],shardCount,totalBytes,totalMB,totalGB}`；
- 真删 → 同结构 + `dryRun:false` + `recycled:true|false`（true=已移入回收站；false=回收站不可用、已永久删除）；
- 分片 `xxx-00001-of-00002.gguf`：传任意一片，整组一起删；
- 错误：400（缺参/带路径/非 .gguf/越界）、404（不存在）、409（已加载 / 视觉 sidecar 在用 / 正在下载）、500（删不掉）。message 都是给人看的中文。

## 二、页面行为

- 模型菜单每行右侧「删」（`.modelDel`）：click/Enter 都 `stopPropagation`，不触发选中/加载；
- 点击先 dryRun → 弹窗 `#delModelModal`（文件名、`N 个文件 · 共 X`、分片提示、回收站警告），**此时文件一个都没动**；
- 取消/Esc/遮罩/✕ 关闭；确认中按钮「删除中…」置灰；
- 成功 toast「已删除 N 个文件，释放 X（已移入回收站 / 已永久删除）」→ 清空选中 → 刷新列表；409 等直接显示后端原文。

## 三、验证

| 探针 | dev | 发布包 |
|---|---|---|
| `probe-model-delete`（新，20 条） | **20/20** | **20/20** |
| `probe-model-add`（回归） | 4/4 | 4/4 |
| `probe-menu-stacking`（回归） | 2/2 | — |
| `probe-start-screen` / `probe-ui-new` | 12/12 / 30/30 | 12/12 / 30/30 |

- 断言口径 **827 → 847**（+20）；全量驱动 **55 条**（BOM `EF BB BF`、PS5.1 Parser 0 错误）。
- 真实文件实测（4KB 假文件）：dryRun 不删；真删 `recycled:true`、文件消失、`/api/state.models` 不再列出；分片两片一起消失；
  加载 4B 后删它返回 409、文件完好（随后卸载）。
- dist 同步：`app.mjs`/`app.html` 哈希 MATCH；发布包首页含 `#delModelModal`。

## 四、取舍与偏差

1. **默认回收站**：Windows 上用 `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(..., SendToRecycleBin)`，路径经环境变量传 JSON 数组（防引号注入）；回收站不可用（网络盘等）才永久删除，前端 toast 会写清。
2. **已加载/视觉在用/下载中一律拒绝**：让用户先卸载/停视觉/取消下载；不做「自动卸载再删」，避免把正在聊天的上下文一起丢掉。
3. **分片整组删除**：只删一片会留下模型库列着但加载必失败的残骸。
4. **不做**：删除确认时输入文件名、回收站浏览/还原入口（Windows 回收站自带）、删除 mmproj（不在模型列表里）。

## 五、证据

- `CONTRACT.md`（需求/接口/页面/探针契约）
- `release-probe-model-delete.out.txt` / `release-probe-model-add.out.txt` / `release-probe-start-screen.out.txt`
- `model-delete-dark.png` / `model-delete-light.png`（菜单里的「删」/确认弹窗；`server/docs/**/*.png` 被 .gitignore 忽略，属本地证据）

## 六、下一轮

1. **打包 v1.4.0 + 重打交付 zip**：源码已领先交付包三个功能（Debugging Tool v2、下载进度条、删除模型），随后跑一次干净全量 55 条。
2. 可选：删除前「输入文件名确认」强校验（高风险用户群）、回收站路径提示。