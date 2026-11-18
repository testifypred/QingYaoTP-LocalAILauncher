# v1.8.1 重打包证据（2026-11-18）

**目的**：让安装包里的**首启使用说明变成客户端版**（`build-portable.ps1` 复制仓库根 `README.md`；上一次打 zip 时 README 还没拆成客户端版 / 技术版）。

## 结论

| 项 | 值 |
|---|---|
| 交付 zip | `dist\QingYaoTP-AILauncher-v1.8.1.zip` |
| 字节数 | **127,901,058 B**（122.0 MB） |
| 条目数 | **3947**（含根目录条目） |
| SHA256 | `E3A70DE5829DF15C430CB3FF4EF8838158E4481834891B4E6267018BD495F4C0` |
| 旧包（作废） | 127,902,252 B / SHA256 `BE6AB2CB…74EC`（包内 README 还是技术版 16,669 B） |
| 包内 `app/README.md` | **14,523 B**，SHA256 `2A6D762CD7ED2AADB2E8C35FEADC13FC9F145B37A1D0D4DC8C09595CED528805` = 仓库根 `README.md` 同一文件 |
| 构建产物 | 258.6 MB / 3447 文件（打包瞬间；装回视觉增强包后 dist 3502 文件 / 377.2 MB） |
| 版本 | `APP_VERSION=1.8.1`（未改代码，只重打包） |

## 构建

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\make-zip.ps1
```

- 构建日志：`build.out.txt`（BUILD_EXIT=0，258.6MB / 3447 文件，自检「主包无 app\llama」）
- 打包日志：`makezip.out.txt`（ZIP_EXIT=0，122.0MB / 3947 条目 / 55.7s，自检无 `app/llama` 条目）

### 打包时踩到的坑（记下来，下次别浪费时间）

第一次构建报 `清空旧产物失败 … 'dist\QingYaoTP AILauncher\app' is being used by another process`：
上一轮留下的 **TUI 会话** 还在跑（`cmd.exe /K localai-tui.cmd`，pid 24176，cwd 就是 `dist\…\app`），
它用目录句柄锁住了 app 目录（连 Rename 都不行）。结束该 cmd 与它的 node 子进程后构建即通过。
→ 以后「杀启动器」还要顺手看 **dist 里的 TUI / cmd 子壳**（`Get-CimInstance Win32_Process | ? CommandLine -like '*localai-tui*'`）。

## 自检

- 六份源码 ↔ dist 哈希一致：`app.mjs / app.html / doc-extract.mjs / vision-pack.mjs / localai-debug.mjs / diag-zip.mjs`
- zip 卫生：无 `app/llama/` 条目；无 `data/cloud-review*`（`data/` 只有空目录条目）
- zip 内 `config.ini` 已消毒：`modelDir=` / `autoLoad=` / `vkDevices=` 空，无 `cloudApiKey/cloudBaseURL/cloudModel`
- 包内 `README.md` 与仓库 `README.md` 同哈希（客户端版）
- 重建后把 dist 运行目录恢复为可用：`config.ini` 回填 `modelDir=D:\LocalModels`（打包默认留空），视觉增强包用接口重装（source=pack / 53 文件 / 106,017,053 B）

## 发布包实例冒烟（8099 跑 dist 实例 v1.8.1）

| 探针 | 结果 | 证据 |
|---|---|---|
| `probe-version` | **14/14** | `release-probe-version.txt` |
| `probe-debug` | **54/54** | `release-probe-debug.txt` |
| `probe-readme`（含首启弹窗渲染客户端版正文） | **21/21** | `release-probe-readme.txt` |

`probe-readme` 渲染出客户端版正文：16 个标题 / 7 张表 / 6110 字，首启弹窗、设置→关于重开、Esc 关闭、跑完复位全部通过。

## 注意

- 本轮**只重打包，没改代码**；v1.8.1 的功能回归仍是 11-16 记录的 `probe-code-review-verify 87/87` + 后端自测 34/34。
- 交付 zip 不进 git；Release 附件需手动上传（见 `交接文档.md`「下一步」①）。
- 新的 SHA 已同步到：`README.md` / `.github\RELEASE-v1.8.1.md` / `交接文档.md` / `新会话启动词.md` / `DeveloperRealtimeLog.md`（第六十八节）。
