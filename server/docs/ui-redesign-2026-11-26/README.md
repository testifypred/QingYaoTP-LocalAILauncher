# v1.11.2 UI 重做（2026-11-26）

> 用户反馈「UI 太丑」；方向：**暗色 = Fluent 深色（B），亮色 = 暖纸白（C）**，问候语用思源宋体，图标重做。

## 一、改了什么

1. **主题令牌重设**：`app.html` 末尾追加 v1.11.2 设计层（覆盖式，不删旧规则）——暗色 Fluent 中性灰 + 系统蓝；亮色暖纸白；统一圆角 8/10/14、阴影两级、字号 12–15。
2. **去掉 HUD 装饰**：背景网格与径向光、视口四角定位框（`body::after`）、顶栏扫光（`header::before`）、Logo 呼吸辉光、tab 角括号、青紫渐变文字、扫描光、消息气泡彩色侧条。
3. **思源宋体问候**：`早上/中午/下午/晚上好` 用 **Noto Serif SC（思源宋体）700** 46px；`今天做点什么？` 同字体 400 18px。字体为 **20 余字形子集 woff2（5.7KB）**，随包在 `vendor/fonts/noto-serif-sc/`，附 `OFL.txt`。
4. **图标重做**：设置 ⚙ 字符 → **线性齿轮 SVG**；看图 Σ → **自绘「相框 + Σ 折线 + 山」SVG**（`#imgBtn` / `#heroImgBtn`）；发送 → **纸飞机 SVG + 扁平描边主题色**（去掉渐变底，`#send` / `#heroSend` 同款）。
5. **导航文字**：`Debug` → `调试`；`余量` → `上下文`（tooltip 同步）；顶栏按钮统一 30px 高、ghost 弱化；侧栏「+」弱化。
6. **控件/容器统一**：输入框单层焦点环、`[hidden]` 强制隐藏（修掉顶栏 3 个空按钮）、菜单/浮窗/弹窗/气泡/会话列表统一圆角与边框。
7. **探针适配**：`probe-hero-modes` 旧断言要求「Agent 斜体 / 推理宋体 / 霓虹色」，按新设计改为「无衬线正常体 / 非霓虹色」。

## 二、验证（8 个界面探针，全绿）

| 探针 | 结果 |
|---|---|
| probe-start-screen | 12/12 |
| probe-start-flow | 8/8 |
| probe-ui-new | 30/30 |
| probe-settings-tools | 9/9 |
| probe-hero-modes | 10/10（断言已更新） |
| probe-input-extras | 8/8 |
| probe-ui-version | 9/9 |
| probe-code-window-ui | 10/10 |

日志见 `server/docs/ui-redesign/probe-regression/`。

## 三、截图（screens/）

- `hero-dark.png` / `hero-light.png`：开场白（宋体问候 + 模式 + 输入 + 扁平发送）
- `chat-dark.png` / `chat-light.png`：对话（用户/模型气泡、底部工具栏）
- `settings-dark.png` / `settings-light.png`：设置弹窗
- `topbar-icons.png`：顶栏文字 / 齿轮 / 主题开关 / 上下文（3 倍放大）
- `send-plane.png`：纸飞机发送键（4 倍放大）

## 四、复跑

- UI 截图：`node server/docs/ui-redesign/ui-shot.mjs`（`UISHOT_BASE=http://127.0.0.1:8399` 可指向源码实例）；聊天截图 `ui-chat-shot.mjs`。
- 探针：`server/docs/ui-redesign/run-ui-probes.ps1`（依赖 8099 + 9333 headless Edge）。

## 五、未做 / 下一轮

- 设置页 slider / 代码审查面板 / 工具卡片的细节打磨；窄窗 / 高 DPI 专项。
- 版本号仍 1.11.1，v1.11.2 打包时统一 bump（5 文件 7 处）。
- 字体只做了开场白子集；若以后正文也要宋体需另做子集（体积会大很多）。

## 六、第二轮细化（2026-11-26 深夜）

- **模型菜单**：删除键从「删」文字（10.5px 下发虚像「拝」）换成**垃圾桶 SVG**（悬停才点亮/变红）；行高 46、名称 13px/大小 11px、菜单宽 330、选中行浅色 + 绿点；
- **代码面板**：工具条与审查栏按钮统一 26px 高/8px 圆角；`运行`=实心主题色、`模型审查`=描边主题色、其余 ghost；编辑器 13px/1.62；
- **设置页**：页签改成 30px 高的 chip 式，选中用主题色；
- **提示 toast**：统一圆角 + 左侧主题色条；
- **弹层层级修复**：`.modal` z-index 90、`.toasts` 100（之前「上次在聊」浮卡会盖住代码面板等弹层）；
- **CSS 事故修复**：第二版补丁漏了一个 `}`，导致其后 3~6 号补丁整段被当成嵌套规则静默失效（模型菜单/代码面板样式没生效）；已补 `}` 并加「改 CSS 后校验 `{`/`}` 平衡」的检查。

### 追加探针（全绿）

| 探针 | 结果 |
|---|---|
| probe-code-panel-v2 | 44/44 |
| probe-start-screen | 12/12 |
| probe-start-flow | 8/8 |
| probe-ui-new | 30/30 |
| probe-settings-tools | 9/9 |
| probe-hero-modes | 10/10 |
| probe-input-extras | 8/8 |
| probe-ui-version | 9/9 |
| probe-code-window-ui | 10/10 |

追加截图：`screens/menu-dark.png` / `menu-light.png`（模型菜单）、`code-dark.png` / `code-light.png`（代码面板）。
