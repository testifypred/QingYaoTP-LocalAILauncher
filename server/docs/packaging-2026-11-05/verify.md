# 发布包与交付 zip 独立验证（2026-11-05 → 11-06）

- 执行：**verifier**（item 1–10、12；原始输出见 `verify-files/`）+ **Lead**（item 11 解压冒烟，`verify-files/item11-extract.txt`）
- 对象：`D:\LocalModels\dist\QingYaoTP AILauncher` + `D:\LocalModels\dist\QingYaoTP-AILauncher-v1.1.0.zip`
- 最终 zip：**127,758,927 B（121.8MB）/ 3943 条目 / mtime 2026-11-06 00:01:27 / SHA256 `7F49A8DC322B741FE31F979DF5466CE8C2D2A29A1CD789B98FF147A043AA1A4E`**（verifier 轮询到条目数/size 稳定，确认不是打到一半的包）
- 结论：**12/12 通过**。两处需要说明但不构成失败：dist 的 `config.ini` 带本机 `modelDir` 属本机运行设置（交付 zip 已消毒）；dist `app\` 有 `server.pid` 是服务正在跑（zip 已排除）。

| # | 检查 | 结果 | 判据 / 关键值 |
|---|---|---|---|
| 1 | app\ 关键文件齐 | 🟢 | app.mjs 254,041 / app.html 275,430 / doc-extract.mjs 10,750 / config-recommend.mjs 6,063 / debug.html / localai-debug.* / debug.ico / vendor\katex / node_modules\node-llama-cpp 全在 |
| 2 | 根目录文件齐 | 🟢 | 启动器 57,856 / DebugTool 42,496 / localai.ico 31,308 / 使用说明.txt 4,946 / 3 个 WebView2 DLL / vc_redist 25,635,768 / runtime\node.exe 92,825,416；plugins 3 个 .mjs |
| 3 | 4 份源码 SHA256 | 🟢 | 4/4 与 `server\` 相同（app.mjs 41BC8F75…、app.html D5A51C24…、doc-extract 9E08B87B…、config-recommend FD2BD978…） |
| 4 | exe 真实重编 | 🟢 | 57,856 B / 42,496 B，MF 头 `4D 5A 90 00`，mtime 2026-11-05 23:48:37（本次构建） |
| 5 | dist config.ini | 🟢（说明见备注 1） | `vkDevices=` 行在；`modelDir=D:\LocalModels` 是**本机**开发设置，交付 zip 里为空（见 item 8） |
| 6 | 依赖与运行时 | 🟢 | node_modules 41 包；runtime\node.exe **v24.19.0** |
| 7 | zip 结构 | 🟢 | 3943 条目；唯一根 `QingYaoTP AILauncher-v1.1.0`；目录项 500 / 文件项 3443；反斜杠 0；盘符/绝对路径 0；`..` 0；缺前缀 0 |
| 8 | zip 内容 | 🟢 | config：`modelDir=` / `autoLoad=` / `vkDevices=` 全空、无 `D:\` / `C:\` / 盘符路径；app.mjs 254,041、app.html 275,430、exe 57,856、DebugTool 42,496、使用说明 4,946；node-llama-cpp 3155 条目 / katex 69 条目 |
| 9 | zip 卫生 | 🟢 | data/logs 实际文件 0；`server.pid` 0；`qytp-zip-` 0；AppData/Temp 0；`discovery.json` 0；`models\workspace` 0（3 条 sessions 命中是 node_modules 文件名，见备注 2） |
| 10 | 中文文件名 | 🟢 | `使用说明.txt` zip 内 sha256 与 dist 一致（B24F1F59…），可正确解出 |
| 11 | 解压冒烟（Lead） | 🟢 | 解到空目录 57.1s；3443 文件；关键文件 0 缺失；`runtime\node.exe --check` 三个脚本 exit 0；app.mjs 哈希与源码一致；exe 57,856；无 server.pid；config `modelDir=` 空；data/logs/models 为空目录 |
| 12 | 与旧包差异 | 🟢 | 旧 3947 → 新 3943：**removed 4** = `app/server.pid`(5B) + `models/workspace/`、`discovery.json`(95B)、`sessions/`；**added 0**；**size-changed 5** = app.html 271,389→275,430、app.mjs 247,886→254,041、config-recommend 5,316→6,063、config.ini 840→963、exe 57,344→57,856 —— 全部对应 P4 + 显卡两轮改动 |

## 备注（不构成失败）

1. **dist 的 `config.ini` 为什么有 `modelDir=D:\LocalModels`**：本机开发/运行要看到 `D:\LocalModels` 下的 5 个模型。交付 zip 的 config 由 `make-zip.ps1` 消毒成 `modelDir=` 空，两项是不同场合的两份文件。
2. **item 9 的 3 条 sessions 命中**：`app/node_modules/axios/lib/helpers/Http2Sessions.js`、`.../lowdb/.../SessionStorage.js|d.ts`，是依赖库文件名，不是运行期会话泄漏。
3. **dist `app\` 有 `server.pid`**：服务正在跑（pid 23368，8099 health=200），pid 文件是运行期产物；zip 已排除（item 9/12 均验证）。

## 证据

| 文件 | 内容 |
|---|---|
| `verify-files/item1-6.txt` | dist 侧 1–6 项原始输出 |
| `verify-files/hash.txt` | 4 份源码完整 SHA256（dist vs server） |
| `verify-files/item7-12.txt` | zip 侧 7–10、12 项原始输出（含最终 zip 稳定性轮询） |
| `verify-files/item11-extract.txt` | Lead 解压冒烟原始输出 |
| `verify-files/zip-entries.txt` / `zip-entries-old-1101.txt` | 新/旧 zip 条目清单（各 3943 / 3947 行） |