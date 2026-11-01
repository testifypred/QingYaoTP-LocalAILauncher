# 按尺寸选源稿：16 → 只有 ∂；24/32/48 → ∂ + ?；64 以上 → 完整稿（∂ + AI + ?）
# 用法：先渲染 icon-512 / icon-mid-512 / icon-small-512（Edge 截图，见 technique/08），再跑这个，最后 node make-ico.mjs
Add-Type -AssemblyName System.Drawing
$map = @{ 16='icon-small-512.png'; 24='icon-mid-512.png'; 32='icon-mid-512.png'; 48='icon-mid-512.png'; 64='icon-512.png'; 128='icon-512.png'; 256='icon-512.png' }
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