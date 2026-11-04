# QingYaoTP AILauncher（本地 AI）—— 便携版打包脚本
#
# 用法（在 server 目录下）：
#   powershell -ExecutionPolicy Bypass -File .\build-portable.ps1
#   powershell -ExecutionPolicy Bypass -File .\build-portable.ps1 -OutDir 'E:\build\dist\QingYaoTP AILauncher'
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

param(
    [string]$OutDir = 'D:\LocalModels\dist\QingYaoTP AILauncher',
    [string]$Icon = 'D:\LocalModels\server\localai.ico',
    [string]$ModelDir = '',   # 留空 = 用 <安装目录>\models（便携；不要写死本机 D:\LocalModels）
    [string]$AutoLoad = '',   # 留空 = 首启「自动检查用户配置」按本机硬件推荐
    [int]$ContextSize = 16384,
    [int]$Port = 8099
)

$ErrorActionPreference = 'Stop'
$Server = Split-Path -Parent $MyInvocation.MyCommand.Path
$Nlc = Join-Path $Server 'node_modules\node-llama-cpp'
$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Die($msg) { Write-Host "!!  $msg" -ForegroundColor Red; exit 1 }

foreach ($need in @(
    (Join-Path $Server 'app.mjs'),
    (Join-Path $Server 'app.html'),
    # app.mjs 里 import 了它（docx/pdf 抽文本）；漏了整包起不来
    (Join-Path $Server 'doc-extract.mjs'),
    # app.mjs 里 import 了它（首启配置推荐）；漏了整包起不来
    (Join-Path $Server 'config-recommend.mjs'),
    (Join-Path $Server 'localai.mjs'),
    (Join-Path $Server 'localai.cmd'),
    (Join-Path $Server 'localai-tui.mjs'),
    (Join-Path $Server 'localai-tui.cmd'),
    # 调试工具：页面 + 独立程序 + 它自己的图标（漏了它，包里「Debug」按钮会 500）
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
    'D:\Node.js\node.exe'
)) { if (-not (Test-Path $need)) { Die "缺少依赖：$need" } }

# 安全闸：只允许清空以 dist\QingYaoTP AILauncher 结尾的目录，绝不误删别处
$resolved = [System.IO.Path]::GetFullPath($OutDir).TrimEnd('\')
if ($resolved -notmatch '\\dist\\QingYaoTP AILauncher$') { Die "输出目录必须是 ...\dist\QingYaoTP AILauncher，收到：$resolved" }
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
# 首启配置推荐（app.mjs import）；和 doc-extract.mjs 一样必须进包
Copy-Item (Join-Path $Server 'config-recommend.mjs') $AppDir -Force
# 命令行客户端：跟着 app 一起进包，npm 那套东西它一样不依赖
Copy-Item (Join-Path $Server 'localai.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'localai.cmd') $AppDir -Force
# 终端界面（TUI）：顶栏「终端」按钮靠它开窗口
Copy-Item (Join-Path $Server 'localai-tui.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'localai-tui.cmd') $AppDir -Force
# 调试工具（Debugging Tool）：独立程序 + 调试页 + 它自己的图标
Copy-Item (Join-Path $Server 'debug.html') $AppDir -Force
Copy-Item (Join-Path $Server 'localai-debug.mjs') $AppDir -Force
Copy-Item (Join-Path $Server 'localai-debug.cmd') $AppDir -Force
Copy-Item (Join-Path $Server 'debug-icon-64.png') $AppDir -Force
Copy-Item (Join-Path $Server 'debug.ico') $AppDir -Force
# localai.ico 在下面「写图标」那步统一拷到根目录（桌面快捷方式的 IconLocation 指向它）

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

Step '复制 Node 运行时'
Copy-Item 'D:\Node.js\node.exe' (Join-Path $RuntimeDir 'node.exe') -Force

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
# 说明        首次启动会自动检查本机（CPU/内存/显卡/运行库/磁盘），给出模型与上下文建议，
#             点「按建议配置并应用」即可写回本文件（下一次启动生效）。
port=$Port
modelDir=$ModelDir
autoLoad=$AutoLoad
contextSize=$ContextSize
kvReuse=1
gpu=auto
vkDevices=
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
  模型体积大，不随包分发。默认指向 D:\LocalModels；换机器时改 config.ini 的 modelDir，
  或者把 gguf 放进本目录的 models\ 里（modelDir 留空即用该目录）。
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

八、排错
  1. 双击没反应：看 logs\app.log 与 logs\launcher.log；端口被占时启动器会弹提示。
  2. 想换端口：改 config.ini 的 port，然后重启启动器。
  3. 杀不干净：删掉 app\server.pid 后再执行 --stop。
  4. 内嵌窗口白屏：删掉 data\webview2 重试；仍不行就用 --no-webview。
"@
Set-Content -Path (Join-Path $resolved '使用说明.txt') -Value $readme -Encoding UTF8

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
Write-Host ("  合计       {0:N1} MB / {1} 个文件" -f ($sizeAll / 1MB), $files)
if ($sizeData -gt 0) { Write-Host ("  另有 data\\  {0:N1} MB（运行期缓存，可随时删）" -f ($sizeData / 1MB)) }
