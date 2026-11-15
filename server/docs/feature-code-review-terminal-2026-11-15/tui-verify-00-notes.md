# TUI 升级自测与证据说明（server/localai-tui.mjs，2026-11-15 第二十二轮 v1.7.0）

> 负责人：teammate=tui（task-6）· 只改 server/localai-tui.mjs（+ 本目录证据/冒烟脚本）· 未跑 build-portable/make-zip、未动 dist、未 git commit。

## 0. 证据文件状态一览

| 文件 | 状态 | 内容 |
|---|---|---|
| tui-verify-01-check-selftest.txt | 有效（纯本地） | node --check、--selftest（29 项） |
| tui-verify-02-hint-test.txt | 有效（16:05 真服务） | --hint-test 各输入 / 服务不可达回退 |
| tui-verify-03-plain-tools.txt | 有效（16:05 真服务） | 管道 --plain：/tools、/tool 各分支 |
| tui-verify-04-snapshot.txt | 有效（16:05 真服务） | --snapshot 各版面（含真工具清单） |
| tui-verify-05-faketty-smoke.txt | 有效（16:06 真服务，12/12） | 伪终端交互冒烟 Phase A+B |
| tui-verify-06-probe-tui-tools.txt | 有效（16:06 重跑，23/23） | probes 的 probe-tui-tools.mjs 输出 |
| tui-verify-07-stub.txt | 有效（桩服务，不碰 8099） | 工具清单/提示条/plain 各分支/伪终端 12 条 |
| tui-verify-08-offline.txt | 有效（纯本地） | --check/--selftest/--hint-test/版面/窄窗/NO_COLOR |

> 02-06 已于 16:05/16:06 在 Lead 放行后统一重生成（窗口内 8099 健康，无超时）；02-04 的旧版曾在 15:49 撞上服务被压住而作废，已被覆盖。
> 07/08 是「桩服务 + 纯本地」的确定性版本，与真服务版互为交叉验证。

## 1. 本轮做了什么（契约 §3）

### 1.1 命令提示
- 输入以 / 开头时：
  - 行内灰字补全：光标贴尾且首词未写完时，在光标后以 dim 显示首个匹配命令的剩余部分（NO_COLOR 时 dim 为空，等价关闭显示）。
  - 提示条：输入框下方最多 6 行，每行「命令 + 一行说明 + 用法（· 分隔）」，当前候选用 ▸ + 高亮（NO_COLOR 也有 ▸ 标记）；候选超过 6 条时窗口跟随 Tab 高亮滚动（不会出现"高亮的那条在屏幕外"）。
  - 键位：Tab 补全到当前候选 / 连按 Tab 切换候选（**第一次 Tab 时把候选表固定下来**，之后在同一张表里循环——否则补全成 /new 后候选只剩 /new，无法"连按切换"）；→ 接受行内补全（没有可接受的补全时才右移光标）；Esc 收起提示条；半截命令 + Enter 会先补成首个候选再执行（/he + Enter = /help）。
  - /tool 之后（含尾空格）提示条列出可用工具名 + 说明；Tab 可直接补出 /tool <name> 并继续 Tab 选下一个工具。
- 命令集：/help /clear /new /model /state /tools /tool /run /web /think /exit；/quit 别名、/tools on|off、/web on|off、/think on|off、/model、/run 语义不变。

### 1.2 终端里调用软件工具
- /tools：GET /api/tools → 打印 工具名 + 参数（* = 必填）+ 说明，参数说明单独一行（长说明用 … 截断）。无参数调用打印清单；/tools on|off 仍切换工具调用开关（老语义保留）。
- /tool <name> [key=value …] [--json '<json>']：POST /api/tool，带 x-local-token（来自 GET /api/state.localToken；403 时自动刷新令牌重试一次）。
  - 值类型推断：整数/小数 → number，true/false → boolean，null → null，其余字符串；key="带 空格" 用引号。
  - --json 之后整段按 JSON 解析（优先，忽略前面的 key=value；--json={...} 也支持）。之所以按原始串解析而不是先切词：切词会吃掉 JSON 的引号（本轮实测踩到，已修 + selftest 覆盖）。
  - 结果：result JSON 美化打印（字符串 >2000 字 / 数组 >30 项 / 对象 >60 键 / 总长 >12000 字逐级截断）；result.error 红字单独一行。
- 非 TTY（--plain / 管道）同样能跑 /tools /tool；纯命令输入时不再先 ensureModel 白等模型加载。
- 所有 HTTP 调用加了超时（/api/state 15s、/api/tools 10s、/api/tool 120s、/api/run 60s）：服务被重活压住时 TUI 报「请求超时」而不是永久挂死（本轮 8099 卡死期间实测，伪终端冒烟 15s 内正常退出而不是挂住）。

### 1.3 自检
- 新增 --hint-test "<输入>"：不进交互，按「补全候选」逐行打印 cmd<TAB>说明（--hint-test "/tool " 会先拉 /api/tools 列工具名，服务不可达 4s 内回退成一行命令提示）；无需服务即可跑 /to、/、/xyz。
- --selftest 从 7 项扩到 **29 项**（宽度/CJK/折行/补白/截断/ANSI 零宽/stripAnsi/值推断/切词/--json/补全候选/行内 ghost/Tab 循环/工具清单归一化/JSON 截断）。
- --snapshot 保持可用，并新增 --input（自定义输入行）、--hint-idx（高亮第 N 个候选）便于看提示条版面；--snapshot 现在会在输入是 /tool 时顺手拉一次工具清单（服务不在就退化）。

### 1.4 顺手修掉的两个老问题（与本轮契约相关，改动很小）
1. 宽度统计把 ANSI 转义算进显示宽度：strWidth/truncWidth/padWidth 以前逐字符计数，ESC[36m 被算成 4 列 → 彩色行被误截断/补白错位（老 snapshot 里标题行右侧边框就对不齐）。现在 ESC 序列按零宽跳过，只有真截断时才补 reset 防颜色外溢。修后 snapshot 边框全部对齐。
2. 多行 sys 日志会破坏版面：/help、/tools 这类多行输出以前作为一个 body 项塞进一屏行数组，内嵌换行会跳到 0 列、把下一行顶掉。现在按行铺开（error/tool 同理），整屏不再错位。

## 2. 验证矩阵

| # | 验证 | 结果 | 证据 |
|---|---|---|---|
| 1 | node --check localai-tui.mjs | exit 0 | 01 / 08 |
| 2 | --selftest | 通过（29 项） | 01 / 08 |
| 3 | --hint-test "/to" / "/" / "/xyz" | exit 0，格式 cmd<TAB>说明 | 08 |
| 4 | --hint-test "/tool "（桩服务，令牌校验有效） | 列出工具名+说明；/tool cal 前缀过滤 | 07 |
| 5 | 服务不可达回退（--url 8399 无人监听） | 4s 内回退一行提示 / 友好报错，exit 0 | 08 |
| 6 | 管道 --plain：/tools、/tool（无参/calculate/--json/result.error/未知工具 404） | 全部正常，exit 0 | 07（桩）；待 03（真服务） |
| 7 | --snapshot 默认 / /to / / + hint-idx / 窄窗 40x14 / NO_COLOR 60x16 | 版面正确 | 08 |
| 8 | --snapshot --input "/tool "（桩 3 工具） | 提示条列工具 | 07 |
| 9 | 伪终端交互冒烟 Phase A+B @桩 / @真服务 | **12/12 PASS**（各 3.5-4s） | 07 / 05 |
| 10 | probes 的 probe-tui-tools.mjs | **23/23 通过**（15:48 手跑 + 16:06 重跑） | 06 |

**伪终端冒烟（tui-faketty.cjs + tui-faketty-smoke.mjs）**：本会话没有控制台窗口（stdio 全是管道），用 --require 预载把管道 stdin/stdout 伪装成 TTY（isTTY/columns/rows/setRawMode），再按用户节奏喂真实按键并断言：
- Phase A（7 条）：进入全屏 → 提示条出现（▸）→ 底部按键说明 → Tab 补全后执行 /tool 用法 → /tool get_current_time 结果带 localTime → /help → Ctrl+C 正常退出。
- Phase B（5 条）：空输入 Tab 出 / 并显示提示条 → 连按 Tab 切换候选到 /run → Esc 收起提示条（末帧无 ▸、底部回到「Enter 发送」）→ /hel + → 接受行内补全 → Enter 执行 /help → Ctrl+C 正常退出。

**仍建议 Lead/用户在真实控制台（界面「终端」按钮或 localai tui）手点一遍**：逻辑（Tab 循环/→ 接受/Esc 收起/半截命令回车补全）已被 selftest + 伪终端 12 条覆盖，真终端差异只剩按键投递本身。

## 3. 遗留 / 风险
- localai.mjs 的参数白名单不接受 --hint-test（localai tui --hint-test "/to" 报「未知参数」）；Lead 决定本轮不改，探针按契约直接用 node localai-tui.mjs --hint-test。交互式 localai tui 不受影响。
- 提示条里的工具名依赖 GET /api/tools 缓存（进 TTY 时预拉一次、输入 /tool 时补拉）；服务被压住时退化成一行命令提示，不会卡住输入。
- result.error 目前"红字一行 + 完整 JSON 也照打"（便于复制排查）；若觉得重复可后续只留红字。
- localai-tui.mjs 与 dist\app\localai-tui.mjs 现在不同步（本轮按用户要求不重打发布包，下轮交付前要同步）。
- 未测 web_search/fetch_url 的真实外网调用（属工具自身行为，TUI 层只负责传参与打印；有参/无参/错误三类返回形状已用 calculate/get_current_time/stub_fail 覆盖）。
- /tools 无参语义从「打印用法」变成「列工具清单」（契约要求）；要切开关用 /tools on|off。

## 4. 同目录新增的辅助文件
- tui-faketty.cjs：伪 TTY 预载（仅冒烟用）。
- tui-faketty-smoke.mjs：伪 TTY 交互冒烟驱动（Phase A+B，12 条断言）。
- tui-stub-server.mjs：TUI 自检用桩服务（零依赖、令牌校验、404/result.error 分支、不碰 8099/模型/8199）。
- tui-verify-*.txt / 本文件：上面验证矩阵的原始输出与说明。
