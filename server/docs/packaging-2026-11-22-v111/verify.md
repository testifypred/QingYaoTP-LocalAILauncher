# v1.11.0 打包验证（2026-11-22 22:40–22:46）

## 构建

- 脚本：`server\build-portable.ps1 -ModelDir 'D:\LocalModels' -AutoLoad 'qwen3-5-4B-Q4_K_M.gguf'` → exit 0
- 产物：**258.8 MB / 3,448 个文件**（不含 app\llama）
- 全量日志：`build.out.txt` / `zip.out.txt`

## 交付 zip

- `dist\QingYaoTP-AILauncher-v1.11.0.zip`
- **127,961,662 B / 122.0 MB / 3,948 条目**
- **SHA256 `18B83B2920DF2617CC6D72EE39F900095648D33568C14C10F42BEF63ECCA7932`**
- 压缩耗时 49.4s；`make-zip.ps1` 自检：无 `app/llama` 条目

## 包内自检（全过）

- 条目数 3948；无 `app/llama/*`；关键文件齐全：`app/app.mjs / app/package.json / app/localai.mjs / app/localai-tui.mjs / app/README.md / app/code-review-multi.mjs / app/vision-pack.mjs / QingYaoTP AILauncher.exe`
- 版本：包内 `app/app.mjs` APP_VERSION=**1.11.0**；`app/package.json` version=**1.11.0**；`app/localai-tui.mjs` VER=**2.0.0**（与主程序解耦）
- 包内 `config.ini` 已消毒：`modelDir=` / `autoLoad=`（不含本机绝对路径）
- `app/README.md` 与仓库根 `README.md` 哈希一致：`96821004F041CA4974B658529714BAB20766C01D9A950217080FC50E2097C644`
- 源码 ↔ dist 七份文件哈希一致：app.mjs / app.html / doc-extract.mjs / vision-pack.mjs / code-review-multi.mjs / localai-tui.mjs / package.json
- 本机 dist `config.ini`（仅本机运行用）：`modelDir=D:\LocalModels` / `autoLoad=qwen3-5-4B-Q4_K_M.gguf`
