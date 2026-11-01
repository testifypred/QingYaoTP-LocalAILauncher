# 软件本体图标（∫ + AI）：16/24 只画 ∫；32 以上 ∫ + AI
# 调试工具的 ∂+AI+? 不走这里，见 debug-icon.png
Add-Type -AssemblyName System.Drawing
$map = @{ 16='icon-app-small-512.png'; 24='icon-app-small-512.png'; 32='icon-app-512.png'; 48='icon-app-512.png'; 64='icon-app-512.png'; 128='icon-app-512.png'; 256='icon-app-512.png' }
foreach ($sz in @(256,128,64,48,32,24,16)) {
  $srcPath = 'D:\LocalModels\server\' + $map[$sz]
  if (-not (Test-Path $srcPath)) { Write-Warning ('缺少 ' + $srcPath + '，跳过 ' + $sz); continue }
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = [System.Drawing.Bitmap]::new($sz, $sz)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $sz, $sz)
  $g.Dispose()
  $bmp.Save('D:\LocalModels\server\icon-parts\icon-' + $sz + '.png', [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $src.Dispose()
}
'scaled'