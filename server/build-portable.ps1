# QingYaoTP AILauncher（本地 AI）—— 便携版打包脚本
#
# 用法（在 server 目录下）：
#   powershell -ExecutionPolicy Bypass -File .\build-portable.ps1
#   powershell -ExecutionPolicy Bypass -File .\build-portable.ps1 -OutDir 'E:\build\dist\QingYaoTP AILauncher'
#   powershell -ExecutionPolicy Bypass -File .\build-portable.ps1 -BundleVision   # 离线一体化包（把 101MB 视觉 sidecar 也打进去）
#
# 产物：
#   <OutDir>\QingYaoTP AILauncher.exe   带图标的启动器（托盘 + 优雅停机）
#   <OutDir>\app\               服务端、界面、KaTeX、node-llama-cpp
#   <OutDir>\runtime\node.exe   随包 Node，目标机器不需要装 Node
#   <OutDir>\config.ini         端口 / 模型目录 / 自动加载
#   <OutDir>\logs\              运行日志
#
# 只保留 Vulkan 与 CPU 两套原生库（cuda / cuda-ext / arm64 共 528MB 全部剔除），
# 便携目录因此从 ~700MB 降到 ~200MB；模型本身永远外置。
#
# 视觉增强包（v1.6.0 起拆分）：看图用的 llama.cpp sidecar（tools\llama.cpp，53 文件 / 101.1MB）
# 默认**不**进主包，改由 server\make-vision-pack.ps1 打成
#   dist\QingYaoTP-AILauncher-v<APP_VERSION>-vision-pack.zip
# 用户在「设置 → 视觉 → 安装视觉增强包」里一键装/卸，不看图的人不用下这 101MB。
# 需要「离线一体化包」（目标机没法单独装增强包）时加 -BundleVision 恢复旧行为。

param(
    # 输出目录：默认 <repo>\dist\QingYaoTP AILauncher（repo = 本脚本所在 server 的上一级）
    [string]$OutDir = '',
    # 应用图标：默认 server\localai.ico
    [string]$Icon = '',
    # 随包 node.exe：留空 = LOCALAI_NODE_EXE > PATH 上的 node > %ProgramFiles%\nodejs\node.exe
    [string]$NodeExe = '',
    [string]$ModelDir = '',   # 留空 = 用 <安装目录>\models（便携；不要写死本机路径）
    [string]$AutoLoad = '',   # 留空 = 首启「自动检查用户配置」按本机硬件推荐
    [int]$ContextSize = 16384,
    [int]$Port = 8099,
    # 视觉增强包（tools\llama.cpp → app\llama，53 文件 / 101.1MB）是否打进主包。
    # 默认关（v1.6.0 起拆分）；需要离线一体化包时加 -BundleVision。
    [switch]$BundleVision
)

$ErrorActionPreference = 'Stop'
$Server = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Server
if (-not $OutDir) { $OutDir = Join-Path $Repo 'dist\QingYaoTP AILauncher' }
if (-not $Icon) { $Icon = Join-Path $Server 'localai.ico' }
$Nlc = Join-Path $Server 'node_modules\node-llama-cpp'
$Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $Csc)) { $Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Die($msg) { Write-Host "!!  $msg" -ForegroundColor Red; exit 1 }

# 随包 node.exe：不再写死某个盘上的安装路径（换台机器就崩）。优先级：
#   -NodeExe 参数 > LOCALAI_NODE_EXE > PATH 上的 node > %ProgramFiles%\nodejs\node.exe
# 注意：PATH 上的 node 常常是 npm 的 .cmd 垫片（120 字节），复制进包会是废文件——
#       所以要求候选必须是 .exe 且体积 > 1MB。
$nodeCandidates = @()
if ($env:LOCALAI_NODE_EXE) { $nodeCandidates += $env:LOCALAI_NODE_EXE }
if ($NodeExe) { $nodeCandidates += $NodeExe }
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeCandidates += $nodeCmd.Source
    $nodeCandidates += ($nodeCmd.Source -replace '\.(cmd|bat|ps1)$', '.exe')
}
$nodeCandidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
$pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
if ($pf86) { $nodeCandidates += (Join-Path $pf86 'nodejs\node.exe') }
# 最后扫一遍 PATH 里的每个目录直接找 node.exe（有的机器只把 NODE 的目录丢进 PATH，
# 真正的 node.exe 就在那儿，而 Get-Command node 命中的是别的垫片）
foreach ($dir in ($env:PATH -split ';')) {
    if (-not $dir) { continue }
    $cand = Join-Path $dir 'node.exe'
    if (Test-Path $cand) { $nodeCandidates += $cand }
}
$NodeExe = $nodeCandidates | Where-Object {
    $_ -and (Test-Path $_) -and ($_ -match '\.exe$') -and ((Get-Item $_).Length -gt 1MB)
} | Select-Object -First 1
if (-not $NodeExe) {
    Die '找不到可用的 node.exe（要求是真正的 .exe，不是 npm 的 .cmd 垫片）：用 -NodeExe 指定，或设 LOCALAI_NODE_EXE，或把 node 放进 PATH'
}
if (-not (Test-Path $Csc)) { Die "找不到 C# 编译器 csc.exe：$Csc" }
Write-Host ("   随包 node：$NodeExe")
Write-Host ("   C# 编译器：$Csc")

foreach ($need in @(
    (Join-Path $Server 'app.mjs'),
    (Join-Path $Server 'app.html'),
    # 首启「使用说明」弹窗读它（打包进 app\README.md）；漏了首启只能看到「没找到 README.md」
    (Join-Path $Repo 'README.md'),
    # 许可证与第三方声明：随包分发（Apache-2.0 + 依赖许可清单）
    (Join-Path $Repo 'LICENSE'),
    (Join-Path $Repo 'NOTICE'),
    (Join-Path $Repo 'THIRD_PARTY_NOTICES.md'),
    # app.mjs 里 import 了它（docx/pdf 抽文本）；漏了整包起不来
    (Join-Path $Server 'doc-extract.mjs'),
    # app.mjs 里 import 了它（首启配置推荐）；漏了整包起不来
    (Join-Path $Server 'config-recommend.mjs'),
    (Join-Path $Server 'localai.mjs'),
    (Join-Path $Server 'localai.cmd'),
    (Join-Path $Server 'localai-tui.mjs'),
    (Join-Path $Server 'localai-tui.cmd'),
    # 调试工具：页面 + 独立程序 + 它自己的图标（漏了它，包里「Debug」按钮会 500）
    # 调试工具导出诊断包用（app.mjs import 了它；漏了 /debug 与导出接口都会 500）
    (Join-Path $Server 'diag-zip.mjs'),
    # 视觉增强包（app.mjs import 了它：解 ZIP / 装 / 卸）；漏了整包起不来（2026-11-15 v1.6.0 差点漏）
    (Join-Path $Server 'vision-pack.mjs'),
    # v1.10.0 多文件 / 整工作区审查（app.mjs import 了它）；漏了整包起不来（同 vision-pack 的老账）
    (Join-Path $Server 'code-review-multi.mjs'),
    (Join-Path $Server 'debug.html'),
    (Join-Path $Server 'localai-debug.mjs'),
    (Join-Path $Server 'localai-debug.cmd'),
    (Join-Path $Server 'debug-icon-64.png'),
    (Join-Path $Server 'vendor\katex\katex.min.js'),
    $Nlc,
    (Join-Path $Server 'launcher\Launcher.cs'),
    (Join-Path $Server 'launcher\DebugTool.cs'),
    (Join-Path $Server 'debug.ico'),
    (Join-Path $Server 'launcher\app.manifest'),
    (Join-Path $Server 'launcher\webview2\Microsoft.Web.WebView2.Core.dll'),
    (Join-Path $Server 'launcher\webview2\Microsoft.Web.WebView2.WinForms.dll'),
    (Join-Path $Server 'launcher\webview2\WebView2Loader.dll'),
    $Icon,
    $Csc,
    $NodeExe
)) { if (-not (Test-Path $need)) { Die "缺少依赖：$need" } }

# 安全闸：输出目录必须叫 QingYaoTP AILauncher，且不能是盘根/用户目录——绝不误删别处
$resolved = [System.IO.Path]::GetFullPath($OutDir).TrimEnd('\')
if ((Split-Path $resolved -Leaf) -ne 'QingYaoTP AILauncher') {
    Die "输出目录名必须是 QingYaoTP AILauncher，收到：$resolved"
}
$rootOfDrive = [System.IO.Path]::GetPathRoot($resolved).TrimEnd('\')
if ($resolved.TrimEnd('\') -eq $rootOfDrive -or $resolved.TrimEnd('\') -eq $env:USERPROFILE.TrimEnd('\')) {
    Die "输出目录不能是盘根或用户目录：$resolved"
}
if (Test-Path $resolved) {
    Step "清空旧产物 $resolved"
    # 内嵌窗口的 localStorage 里存着对话记录，重新打包时保留，别把历史一起删了
    $dataKeep = Join-Path $resolved 'data'
    if (Test-Path $dataKeep) {
        $dataBackup = Join-Path $env:TEMP ('localai-data-' + [guid]::NewGuid().ToString('N'))
        Move-Item $dataKeep $dataBackup -Force
    }
    try {
        Remove-Item $resolved -Recurse -Force -ErrorAction Stop
    } catch {
        # 这一步最容易失败（应用还在跑，node.exe 占着 DLL、启动器占着 logs\app.log）。
        # 失败时**必须**先把 data\ 放回去，否则用户的对话记录就留在 TEMP 里没人管了。
        if ($dataBackup -and (Test-Path $dataBackup)) {
            New-Item -ItemType Directory -Force -Path $resolved | Out-Null
            Move-Item $dataBackup (Join-Path $resolved 'data') -Force
            $dataBackup = $null
            Write-Host '  （已把 data\ 放回原处）' -ForegroundColor Yellow
        }
        Die ("清空旧产物失败，通常是应用还在运行。" +
            "先停服务：Start-Process '.\QingYaoTP AILauncher.exe' -ArgumentList '--stop' -Wait；" +
            "若之后 QingYaoTP AILauncher.exe 进程仍在（它占着 logs\app.log），再结束该进程。" +
            "原始错误：$($_.Exception.Message)")
    }
}
$AppDir = Join-Path $resolved 'app'
$RuntimeDir = Join-Path $resolved 'runtime'
$LogsDir = Join-Path $resolved 'logs'
New-Item -ItemType Directory -Force -Path $AppDir, $RuntimeDir, $LogsDir | Out-Null
if ($dataBackup) { Move-Item $dataBackup (Join-Path $resolved 'data') -Force }

Step '复制服务端与界面'
Copy-Item (Join-Path $Server 'app.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'app.html') $AppDir -Force
Copy-Item (Join-Path $Server 'doc-extract.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'package.json') $AppDir -Force  # 版本对账：probe-version 读包内 package.json，缺它版本号对不上
# 首启配置推荐（app.mjs import）；和 doc-extract.mjs 一样必须进包
Copy-Item (Join-Path $Server 'config-recommend.mjs') $AppDir -Force
# 命令行客户端：跟着 app 一起进包，npm 那套东西它一样不依赖
Copy-Item (Join-Path $Server 'localai.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'localai.cmd') $AppDir -Force
# 终端界面（TUI）：顶栏「终端」按钮靠它开窗口
Copy-Item (Join-Path $Server 'localai-tui.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'localai-tui.cmd') $AppDir -Force
# 调试工具（Debugging Tool）：独立程序 + 调试页 + 它自己的图标
Copy-Item (Join-Path $Server 'diag-zip.mjs') $AppDir -Force
# 视觉增强包：app.mjs import 的 vision-pack.mjs（自己解 ZIP、装/卸 sidecar）；和 doc-extract 一样必须进包
Copy-Item (Join-Path $Server 'vision-pack.mjs') $AppDir -Force
# v1.10.0 多文件审查：app.mjs import 的纯函数模块（拼计划 / 跨文件结论 / 导出 Markdown）
Copy-Item (Join-Path $Server 'code-review-multi.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'debug.html') $AppDir -Force
Copy-Item (Join-Path $Server 'localai-debug.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'localai-debug.cmd') $AppDir -Force
Copy-Item (Join-Path $Server 'debug-icon-64.png') $AppDir -Force
Copy-Item (Join-Path $Server 'debug.ico') $AppDir -Force
# localai.ico 在下面「写图标」那步统一拷到根目录（桌面快捷方式的 IconLocation 指向它）

# 使用说明：首启弹窗与「设置 → 关于 → 使用说明」都读 app\README.md
Copy-Item (Join-Path $Repo 'README.md') $AppDir -Force
# 许可证与第三方许可声明：随包分发（Apache-2.0 + 依赖 MIT 等；视觉增强包的 llama.cpp 也在此覆盖）
Copy-Item (Join-Path $Repo 'LICENSE') $AppDir -Force
Copy-Item (Join-Path $Repo 'NOTICE') $AppDir -Force
Copy-Item (Join-Path $Repo 'THIRD_PARTY_NOTICES.md') $AppDir -Force

# VC++ 运行库：全新 Windows 必缺，缺了模型根本加载不了，随包带一份让启动器直接装
$vcRedist = Join-Path $Server 'vendor\vc_redist.x64.exe'
if (Test-Path $vcRedist) {
    Copy-Item $vcRedist $resolved -Force
    $vcMB = [math]::Round((Get-Item $vcRedist).Length / 1MB)
    Write-Host ("   已附带 vc_redist.x64.exe（" + $vcMB + "MB）")
} else {
    Write-Host '   ! 未找到 vendor\vc_redist.x64.exe'
}

# 插件目录：随包带三个示例（用户也可以自己往里丢 .mjs）
$pluginSrc = Join-Path $Server 'plugins'
if (Test-Path $pluginSrc) {
    New-Item -ItemType Directory -Force -Path (Join-Path $resolved 'plugins') | Out-Null
    Copy-Item (Join-Path $pluginSrc '*.mjs') (Join-Path $resolved 'plugins') -Force
    Write-Host ('   已附带插件 ' + (Get-ChildItem $pluginSrc -Filter *.mjs | Measure-Object).Count + ' 个')
}



Copy-Item (Join-Path $Server 'vendor') (Join-Path $AppDir 'vendor') -Recurse -Force

Step '复制 node-llama-cpp（剔除 cuda / arm64 变体）'
$nlcDst = Join-Path $AppDir 'node_modules\node-llama-cpp'
New-Item -ItemType Directory -Force -Path (Split-Path $nlcDst) | Out-Null
$excludeDirs = @(
    (Join-Path $Nlc 'node_modules\@node-llama-cpp\win-x64-cuda'),
    (Join-Path $Nlc 'node_modules\@node-llama-cpp\win-x64-cuda-ext'),
    (Join-Path $Nlc 'node_modules\@node-llama-cpp\win-arm64'),
    (Join-Path $Nlc 'llama\addon'),
    (Join-Path $Nlc 'llama\cmake'),
    (Join-Path $Nlc 'llama\patches'),
    (Join-Path $Nlc 'llama\profiles'),
    (Join-Path $Nlc 'llama\toolchains'),
    (Join-Path $Nlc 'llama\xpack'),
    (Join-Path $Nlc 'llama\grammars')
)
# robocopy 的 /XD 对含空格路径要逐项传入；/NFL /NDL 让输出安静些
$rcArgs = @($Nlc, $nlcDst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1')
$rcArgs += '/XD'
$rcArgs += $excludeDirs
$rcArgs += '/XF'
$rcArgs += @('gitRelease.bundle')
& robocopy @rcArgs | Out-Null
if ($LASTEXITCODE -ge 8) { Die "robocopy 失败，退出码 $LASTEXITCODE" }

Step '复制 TTS 依赖（msedge-tts / ws 等，约 3MB）'
$modSrc = Join-Path $Server 'node_modules'
$modDst = Join-Path $AppDir 'node_modules'
$rc2 = @($modSrc, $modDst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1', '/XD', 'node-llama-cpp')
& robocopy @rc2 | Out-Null
if ($LASTEXITCODE -ge 8) { Die "复制 TTS 依赖失败，退出码 $LASTEXITCODE" }

if ($BundleVision) {
    Step '复制视觉增强包（-BundleVision：离线一体化包）'
    # 看图能力走独立进程：llama-server + --mmproj（nlc 3.22.x 没有视觉 API）
    $llamaSrc = Join-Path $Server '..\tools\llama.cpp'
    $llamaExe = Join-Path $llamaSrc 'llama-server.exe'
    if (-not (Test-Path $llamaExe)) { Die "缺少视觉 sidecar：$llamaExe（先把它放到 tools\llama.cpp）" }
    $llamaDst = Join-Path $AppDir 'llama'
    New-Item -ItemType Directory -Force -Path $llamaDst | Out-Null
    $rc3 = @($llamaSrc, $llamaDst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1')
    & robocopy @rc3 | Out-Null
    if ($LASTEXITCODE -ge 8) { Die "复制 llama-server 失败，退出码 $LASTEXITCODE" }
    $llamaMB = [math]::Round(((Get-ChildItem $llamaDst -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
    Write-Host ('   已附带 llama-server（' + $llamaMB + ' MB）')
} else {
    Step '视觉已拆分：主包不带 app\llama；用 server\make-vision-pack.ps1 生成增强包'
    # 视觉增强包（llama.cpp b12144，53 文件 / 约 101MB）单独打：server\make-vision-pack.ps1
    #   → <dist>\QingYaoTP-AILauncher-v<ver>-vision-pack.zip，用户在「设置 → 视觉」一键装/卸。
    # 这里清掉旧产物里可能残留的 app\llama（OutDir 被复用/增量拷贝时才会有）。
    $llamaDst = Join-Path $AppDir 'llama'
    if (Test-Path $llamaDst) {
        Remove-Item $llamaDst -Recurse -Force
        Write-Host ('   已清掉旧产物里的 app\llama：' + $llamaDst)
    }
    Write-Host '   不看图的人不用下这 101MB；需要「离线一体化包」时加 -BundleVision'
}

Step '复制 Node 运行时'
Copy-Item $NodeExe (Join-Path $RuntimeDir 'node.exe') -Force

Step '编译启动器（带图标 + WebView2 内嵌窗口）'
$exe = Join-Path $resolved 'QingYaoTP AILauncher.exe'
$wv2 = Join-Path $Server 'launcher\webview2'
& $Csc /nologo /codepage:65001 /target:winexe /platform:anycpu /optimize+ /utf8output `
    "/win32icon:$Icon" `
    "/win32manifest:$(Join-Path $Server 'launcher\app.manifest')" `
    /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "/r:$wv2\Microsoft.Web.WebView2.Core.dll" `
    "/r:$wv2\Microsoft.Web.WebView2.WinForms.dll" `
    "/out:$exe" (Join-Path $Server 'launcher\Launcher.cs')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { Die '启动器编译失败' }

Step '编译调试工具（独立窗口 + 自己的 ico）'
$dbgExe = Join-Path $resolved 'DebugTool.exe'
& $Csc /nologo /codepage:65001 /target:winexe /platform:anycpu /optimize+ /utf8output "/win32icon:$(Join-Path $Server 'debug.ico')" "/win32manifest:$(Join-Path $Server 'launcher\app.manifest')" /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll "/r:$wv2\Microsoft.Web.WebView2.Core.dll" "/r:$wv2\Microsoft.Web.WebView2.WinForms.dll" "/out:$dbgExe" (Join-Path $Server 'launcher\DebugTool.cs')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dbgExe)) { Die '调试工具编译失败' }

# WebView2 的两个托管 DLL + 原生加载器，必须和 exe 同目录
Copy-Item (Join-Path $wv2 '*.dll') $resolved -Force

Step '写配置与说明'
$cfg = @"
# QingYaoTP AILauncher（本地 AI）便携版配置（改完重启 QingYaoTP AILauncher.exe 生效）
# port        服务端口
# modelDir    gguf 所在目录；留空则用本目录下的 models\
# autoLoad    启动后自动加载的模型文件名（留空 = 只起服务，在界面里手选）
# contextSize 上下文长度，越大越吃内存
# kvReuse     1 = 多轮对话复用 KV 缓存（推荐）；0 = 每轮全量重算（仅用于对照）
# gpu         后端：auto（先试 Vulkan 再退 CPU）/ vulkan / cpu
# vkDevices   Vulkan 设备号（逗号分隔，空 = 全部设备）；核显+独显的机器填独显那一项
# visionModel 看图用的模型（留空 = 自动：modelDir\mmproj\*.gguf 按名字配对各模型）
# visionMmproj 看图用的视觉投影文件（留空 = 自动）
# 视觉增强包  看图用的 app\llama 不随主包：设置 → 视觉 → 安装视觉增强包（可选，不看图可忽略）
# visionContext 视觉模式上下文（默认 32768；8K 装不下多图/长对话）
# visionIdleSec 视觉模型闲置多少秒后自动停止（0 = 不停；默认 300）
# visionThreads 图像编码线程数（留空 = 核数-2，封顶 20）
# visionAutoRestore 看完图是否自动装回文本模型（默认 1）
# visionAutoRestoreSec 最后一帧图结束后多少秒装回（默认 15；0 = 立刻）
# 说明        首次启动会自动检查本机（CPU/内存/显卡/运行库/磁盘），给出模型与上下文建议，
#             点「按建议配置并应用」即可写回本文件（下一次启动生效）。
port=$Port
modelDir=$ModelDir
autoLoad=$AutoLoad
contextSize=$ContextSize
kvReuse=1
gpu=auto
vkDevices=
visionModel=
visionMmproj=
visionContext=32768
visionIdleSec=300
visionThreads=
visionAutoRestore=1
visionAutoRestoreSec=15
"@
Set-Content -Path (Join-Path $resolved 'config.ini') -Value $cfg -Encoding UTF8

Copy-Item $Icon (Join-Path $resolved 'localai.ico') -Force

$readme = @"
QingYaoTP AILauncher（本地 AI）便携版
=================

双击「QingYaoTP AILauncher.exe」即可：启动模型服务 → 等待端口就绪 → 打开内嵌窗口（WebView2）。
内嵌窗口是真正的独立窗口：有图标、有标题、没有地址栏，关掉它服务仍在后台跑。
程序会常驻托盘（右下角图标），右键菜单：
  · 打开界面
  · 停止服务并退出   ← 优雅退出，不会留下后台进程
  · 退出启动器（保留服务）

一、目录结构
  QingYaoTP AILauncher.exe  启动器（带图标）
  Microsoft.Web.WebView2.*  内嵌网页用的接口库（约 0.9 MB）
  WebView2Loader.dll        它的原生加载器
  config.ini                端口、模型目录、自动加载模型
  app\                      服务端 app.mjs、界面 app.html、KaTeX、node-llama-cpp
  app\llama\                视觉增强包安装位置（可选；默认不随包，设置 → 视觉 一键装）
  runtime\node.exe          随包 Node，目标机器不需要单独安装 Node
  vc_redist.x64.exe         VC++ 运行库安装包（缺它模型加载不了；启动器会自动提示安装）
  logs\app.log              服务端日志（启动器把 stdout/stderr 都写到这里）
  logs\launcher.log         启动器日志（界面用哪种方式打开、失败原因）
  data\webview2\            内嵌窗口的缓存与 localStorage，删掉即可重置界面状态

二、关于内嵌窗口
  界面是网页，窗口壳子用系统的 WebView2 运行时（Win10/11 基本随 Edge 预装），
  不再依赖「装没装 Edge 浏览器」这件事。
  启动器已声明 DPI 感知、并按系统缩放比例设置窗口大小，因此 125%/150%/175% 缩放的屏上
  文字依然锐利（早期版本没声明，窗口会被系统整体拉伸而发虚）。
  万一目标机器没有 WebView2：会自动静默改用 Edge/Chrome 的应用窗口，再不行用默认浏览器，
  不会弹错误框；具体走了哪条路记在 logs\launcher.log 里。
  想强制用浏览器窗口：QingYaoTP AILauncher.exe --no-webview

三、模型
  模型体积大，不随包分发。默认用本目录的 models\（把 gguf 放进去即可）；
  换机器/换目录时改 config.ini 的 modelDir（留空 = 本目录的 models\）。
  实测主力：qwen2.5-7b-instruct-q4_k_m（4.36GB，两分片，约 10 tok/s）。

  想跑得更快：config.ini 里的 gpu 保持 auto（先试 Vulkan，失败自动退 CPU）。
  虚拟机里没有 Vulkan 计算设备，会自动用 CPU——这是虚拟化的限制，不是软件问题；
  想跳过尝试过程，直接把 gpu 写成 cpu。界面状态栏会标出当前跑的是 CPU 还是 Vulkan。
  第一次没有模型也没关系：首启会引导你扫描本机，或者从 ModelScope 直接下一个（约 470MB）。
  首启的「自动检查用户配置」会按本机内存/显卡给出模型、上下文与 KV 量化的建议，
  点「按建议配置并应用」就会写回 config.ini（老笔记本/8GB 内存会推荐 0.5B + 4K 上下文）。

四、接口
  界面      http://127.0.0.1:8099/
  OpenAI    http://127.0.0.1:8099/v1    （Cherry Studio / DSH 可直接接）
  健康检查  http://127.0.0.1:8099/health

五、命令行
  QingYaoTP AILauncher.exe --status         服务在跑则退出码 0
  QingYaoTP AILauncher.exe --stop           优雅停止服务
  QingYaoTP AILauncher.exe --start-hidden   只起服务 + 托盘，不开界面
  QingYaoTP AILauncher.exe --no-webview     不用内嵌窗口，用浏览器 --app 窗口

六、语音朗读（TTS）
  界面上每条模型回复后面的 🔊 按钮会朗读那条回答；底部可切音色、调语速（0.7×~1.5×）。
  引擎优先级：Piper（离线神经网络） → Windows 内置语音（兜底），无需联网。
  语音资源与模型一起外置，默认在 <modelDir>\tts：
    tts\piper\piper.exe            合成程序（约 37MB，含 onnxruntime）
    tts\voices\*.onnx              音色，每个约 60MB
    tts\cache\                     合成结果缓存（超过 200MB 自动清理，可随时删）
  注意：Piper 只支持 phoneme_type=espeak 的音色；chaowen / xiao_ya 是 pinyin 模式，
  2023 版二进制会直接崩溃，服务端会自动跳过它们（不会出现在音色下拉里）。

七、KV 缓存复用
  kvReuse=1 时，多轮对话只解码「新增部分」，已评估的前缀直接从 KV 缓存复用。
  实测（qwen2.5-7b，1300 token 系统提示）：第二轮首字 16.7s → 0.97s。
  界面每轮会显示「预填充 x.xxs，复用 NN%」。

九、看图（视觉 sidecar）
  输入区的 Σ 按钮（也支持粘贴 / 拖拽）可以把图片发给本地模型看。
  需要一个视觉模型：把视觉模型 .gguf 放进模型目录，把配套的 mmproj-*.gguf 放进 <modelDir>\mmproj\。
  应用按文件名自动配对；也可以在 config.ini 用 visionModel= / visionMmproj= 直接指定。
  视觉增强包（llama.cpp sidecar：压缩包约 40MB / 解压 101MB）不随主包，
  先在「设置 → 视觉 → 安装视觉增强包」装一次（或选本地 zip 安装）；不装的话点图片入口会提示
  「视觉增强包未安装：设置 → 视觉 → 安装视觉增强包」——不看图可以忽略。
  装好后首次看图会启动独立进程 app\llama\llama-server.exe（约 6-12 秒）；单张 1440×900 截图约 40-60 秒
  （图像编码走 CPU：-ngl 0 只管文本层，必须 -mmdev none 才强制 CPU，否则核显会 device lost → 500）。
  上下文默认 32K（config.ini 的 visionContext 可改）；闲置 300 秒自动退出（visionIdleSec，0 = 不停）。
  设置 → 视觉 里可以调「发图质量」（768 快 / 1024 标准 / 1280 精细），越小越快。
  注意：同一时间只加载一个重模型——看图时文本模型会被卸载，看完再选回文本模型即可。
  若提示「没有可用的视觉模型」，先检查 mmproj 是否放在了 <modelDir>\mmproj\ 下。
  默认走 CPU（稳定）；想对比 GPU 可设 VISION_NGL=99 与 VISION_MMPROJ_DEVICE=vulkan0 再启动（部分核显驱动会 device lost）。

八、排错
  1. 双击没反应：看 logs\app.log 与 logs\launcher.log；端口被占时启动器会弹提示。
  2. 想换端口：改 config.ini 的 port，然后重启启动器。
  3. 杀不干净：删掉 app\server.pid 后再执行 --stop。
  4. 内嵌窗口白屏：删掉 data\webview2 重试；仍不行就用 --no-webview。
"@
Set-Content -Path (Join-Path $resolved '使用说明.txt') -Value $readme -Encoding UTF8

# 打包自检：视觉已拆分时主包里绝不允许有 app\llama；-BundleVision 时必须真的带上 llama-server.exe。
# （拆分后主包少 53 个文件 / 101.1MB，这条防脚本改坏、也防 OutDir 残留旧产物）
$llamaCheck = Join-Path $AppDir 'llama'
if ($BundleVision) {
    if (-not (Test-Path (Join-Path $llamaCheck 'llama-server.exe'))) { Die "自检失败：指定了 -BundleVision，但主包里没有 app\llama\llama-server.exe" }
    Write-Host '   自检：app\llama 随包（-BundleVision）'
} else {
    if (Test-Path $llamaCheck) { Die "自检失败：主包里不应该有 app\llama（视觉已拆分）：$llamaCheck" }
    Write-Host '   自检：主包无 app\llama（视觉已拆分）'
}

$sizeApp = (Get-ChildItem $AppDir -Recurse -File | Measure-Object Length -Sum).Sum
# data\ 是运行期产生的 WebView2 缓存与本地存储，不算包体
$dataDir = Join-Path $resolved 'data'
$shipped = Get-ChildItem $resolved -Recurse -File | Where-Object { $_.FullName -notlike "$dataDir\*" }
$sizeAll = ($shipped | Measure-Object Length -Sum).Sum
$files = ($shipped | Measure-Object).Count
$sizeData = 0
if (Test-Path $dataDir) { $sizeData = (Get-ChildItem $dataDir -Recurse -File | Measure-Object Length -Sum).Sum }
Write-Host ''
Write-Host ("完成：{0}" -f $resolved) -ForegroundColor Green
Write-Host ("  app\\      {0:N1} MB" -f ($sizeApp / 1MB))
Write-Host ("  视觉      {0}" -f $(if ($BundleVision) { '随包（-BundleVision）' } else { '已拆分：主包不含 app\llama；增强包用 make-vision-pack.ps1' }))
Write-Host ("  合计       {0:N1} MB / {1} 个文件" -f ($sizeAll / 1MB), $files)
if ($sizeData -gt 0) { Write-Host ("  另有 data\\  {0:N1} MB（运行期缓存，可随时删）" -f ($sizeData / 1MB)) }
