# 图标仓库（含历史稿，别删）

| 文件 | 是什么 | 用在哪 |
|---|---|---|
| `original-white.ico` / `original-white.png` | **原始图标**：白底 + 深蓝 `∫` + `AI`（2026-10-18 那一版） | 留档/回退用，**不要删** |
| `current-black.ico` | 当前本体：黑底 + 白 `∫` + `AI` | 与 `server\localai.ico` 内容相同（那个是打包/编译用的） |
| `debug-partial.png` | 调试工具：黑底 + `∂` + `AI` + `?`（256px） | 运行时用 `server\debug-icon-64.png`（`GET /debug-icon.png`） |

## 约定

- 本体图标 = `∫ + AI`；调试工具 = `∂ + AI + ?`，两套不要混用；
- `server\localai.ico` 是**打包/编译**读的那一份，改图标要同时更新它并重编译启动器；
- 桌面快捷方式的 `IconLocation` 指向 `dist\LocalAI\localai.ico`（不是 exe 内嵌图标），换图标后不必重建快捷方式；
- 从 git 历史取二进制文件必须用 `cmd /c "git show <rev>:path > file"`——PowerShell 的 `>` 会写成 UTF-16，ico 会坏。
