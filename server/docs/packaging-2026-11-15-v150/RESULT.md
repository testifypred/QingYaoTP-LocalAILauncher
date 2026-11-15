# v1.5.0 · README + 首启使用说明弹窗（2026-11-15）

## 交付

| 项 | 值 |
|---|---|
| 版本 | **1.5.0**（app.mjs / package.json / localai.mjs） |
| 发布包 | 359.5MB / **3499 文件**（+ `app\README.md`） |
| 交付 zip | `dist\QingYaoTP-AILauncher-v1.5.0.zip` = 166,241,366 B / 158.5MB / **4000 条目** / 72.3s |
| SHA256 | `EE2ED1D023F8F5F2CEEE05C9E40261C9924448283EAD1831772AEB84AEDE2D38` |
| 包内 README | `app/README.md` = 7,278 B |

## README 只写一份

- 仓库根 `README.md`：使用者（能力/5 分钟跑起来/常见问题/隐私/第三方许可）+ 开发者（源码运行、打包命令、目录结构）。
- 打包时复制到 `app\README.md`；`build-portable.ps1` 的**依赖清单也加了它**，漏了会直接报错而不是静默少文件。
- 服务端 `GET /api/readme` 返回 `{ name, version, seen, markdown, source }`；查找顺序 `app\README.md`（发布包）→ `..\README.md`（源码目录）。

## 首启弹窗

- 触发：`bootFirstRun()` → 没看过就先弹 `#readmeModal`，关掉后再走原来的「准备模型」引导（两个面板不叠）。
- 记住已读：关闭时 `POST /api/onboarding {readmeShown:true}` → 写 `workspace\onboarding.json`；**只看服务端状态**，换浏览器/清缓存不会重弹。
- 重看：设置 → 关于 → 「打开使用说明…」（`#setReadme`）；✕ / 「开始使用」/ 遮罩 / Esc 均可关闭。
- 渲染：复用 `renderMarkdown()`，外层套 `.bubble` 复用消息区 Markdown 排版，只加滚动高度。

## 探针

- 新增 `probe-readme.mjs`：**21 条**（接口 8 + 界面 9 + 复位 4）。全量驱动 55 → **56 条**，断言口径 847 → **868**。
- `run-full.ps1` 的 Seed-Workspace 预置 `{done:true, readmeShown:true}`，否则弹窗盖住顶栏会让界面探针假红。

## 实测

| 项 | 结果 |
|---|---|
| `probe-readme`（发布包） | **21/21** |
| `probe-version`（包内 app.mjs） | **14/14**（pkg=1.5.0） |
| `probe-debug`（发布包） | **54/54** |
| `probe-ui-new` / `probe-start-screen` | **30/30** / **12/12** |
| `probe-start-flow` | **8/8**（先跑 6/8：没装模型；装上 4B 后全绿） |
| 读取来源 | 发布包 `<安装目录>\app\README.md`（4017 字符）；源码目录 `PORT=8098` 时 `仓库根\README.md` |
| 截图 | `readme-modal.png`（1408×857，标题「使用说明 · QingYaoTP AILauncher v1.5.0」） |

> 截图注意：headless Edge 默认会弹它自己的「同步浏览数据」提示，截到的是浏览器弹窗。要用
> `--disable-sync --disable-features=msEdgeSyncPromo,EdgeSyncPromo,msEdgeIdentityFRE,EdgeIdentityFRE --no-default-browser-check` 才能拍到页面本体。

## 已知注意

- `README.md` 里写的是「76 个探针 / 全量 56 条」，增删探针时记得同步这一行与 `technique\06`。
- README 的配图暂时没有（`.gitignore` 屏蔽了 `server/docs/**/*.png`）；要做的话单独开一个放行目录。
