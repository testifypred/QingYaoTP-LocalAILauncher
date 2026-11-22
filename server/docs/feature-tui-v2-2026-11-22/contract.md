# 终端 TUI v2.0.0 契约（2026-11-22）

> 用户原话：「把 TUI 升级一下。你懂 Claude Code 那种吗？我们不需要完全做成那样。」随后给出 5 条硬需求 + 「如果有必要，直接重新开发一个专属于我们的终端工具」。
> **本轮明确不往 Git 推**；主程序版本保持 1.10.0，TUI 独立版本 1.2.0 → 2.0.0。

## 1. 需求 → 验收口径

| # | 需求 | 验收（可自动断言） |
|---|---|---|
| 1 | 终端更新自己的版本号，并附加主程序版本号 | 头部含 `tui 2.0.0` 与 `主程序 v<APP_VERSION>`；`/version` 与 `--version` 打印两者；`--version` 从 `/api/version` 取主版本（服务没起降级 `v?`） |
| 2 | 终端输出普遍比主程序快；流式 Markdown / LaTeX 可行性；不行就线性 + 颜色/高亮 | SSE 直连 + 16ms 合帧；Markdown 降级渲染（粗/斜/行内代码/代码块/标题/列表/引用/链接）；LaTeX→Unicode 近似并洋红；`--bench` 整帧 < 5ms；真实 4B 管道流式有输出 |
| 3 | 打 `/` 输出各能力指令，完成后恢复对话 UI | 空输入 `/` 打开能力面板（命令 + `/tool` 工具，≥ COMMANDS 条）；↑↓/Tab/Esc/Enter 状态机；执行后面板关闭、结果进正文、回到对话 |
| 4 | 输入区域线框 + 显示输入光标 | 框线 `╭ ╮ ╰ ╯`；光标为反显块（NO_COLOR 为 `▏`）；长输入多行且不超宽；每行显示宽度 == 终端宽度 |
| 5 | 等待时 `/ - \ |` 旋转 + 随机原创颜文字 | `SPIN_FRAMES` 顺序 `/ - \ |`；颜文字 ≥ 12 且唯一（实 22）；生成中底边框显示「帧 脸 生成中 X.Xs」 |

## 2. 不改的东西（非目标）

- 不改 `app.mjs` / `app.html` / 版本号 / 打包脚本 / `run-full.ps1`（探针条数仍 66）。
- 不引入依赖（仍是零依赖纯 ANSI）、不引入 pty、不改变 `--plain` 管道语义。
- 不重打包 zip、不提交 Git、不打 tag。

## 3. 交互状态机

```
空输入 ──/──▶ 能力面板 {idx} ──↑↓/Tab──▶ 选中 ──Enter──▶ 执行（命令）或填入 /tool 名字（工具缺必填参数）
                  │                                   │
                  └──Esc / 退格 / 打字──▶ 对话输入     └──执行完──▶ 面板关闭 + 结果进正文
```

- `Ctrl+C`：生成中→中断；面板开→收起；否则「再按一次退出」。
- 半截命令 + 回车：先补成首个候选（`/he` → `/help`）。

## 4. 文件

| 文件 | 改动 |
|---|---|
| `server\localai-tui.mjs` | v1.2.0 → v2.0.0：Markdown/LaTeX 渲染、能力面板、线框输入框+光标、旋转+颜文字、`--version/--faces/--bench/--snapshot --menu/--gen`、`handleKey` 抽取、selftest 61 项 |
| `server\probe-tui-tools.mjs` | 23 → 52 条（新增 E 段 29 条） |
| `server\docs\run-full.ps1` | 未改（仍 66 条） |
| `dist\QingYaoTP AILauncher\app\localai-tui.mjs` | 同步（顶栏「终端」生效） |
| 文档 | 交接文档 / 新会话启动词 / README / README-技术版 / technique 06+07 / DeveloperRealtimeLog 第七十四节 |

## 5. 证据

- `tui-selftest.txt`：SELFTEST 通过（61 项）
- `probe-tui-tools.log`：52 通过 / 0 失败
- `tui-bench.txt`：md 6600 字 1.30ms；frame 100x30 0.06ms
- `tui-version.txt` / `tui-faces.txt`（22 个原创颜文字）
- `tui-snapshot.txt`（Markdown + 公式 + 代码块 + 线框 + 光标）
- `tui-menu.txt` / `tui-menu-tools.txt`（能力面板，命令/工具两屏）
- `tui-spinner.txt`（`\ (∫_∫) 生成中 3.2s`）
- `localai-tui-v1.2.0.backup.mjs`（改前源码备份）

## 6. 已知限制

- LaTeX 只做 Unicode 近似，不做排版（终端能力边界）；使用说明里已写清。
- 交互式 TUI 的「真窗口截图」未纳入自动验证（Windows 无 pty）；以 `--snapshot`（同一份 `frame()`）作为版面证据，按键逻辑用 `--selftest` 模拟覆盖。
- 能力面板一次显示 9 项、滚动浏览；暂不支持输入过滤（后续可选）。
