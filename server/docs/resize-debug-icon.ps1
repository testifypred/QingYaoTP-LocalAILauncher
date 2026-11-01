# 调试工具图标：16 → 只 ∂；24/32/48 → ∂ + ?；64 以上 → ∂ + AI + ?
Add-Type -AssemblyName System.Drawing
$out = 'D:\LocalModels\server\icon-parts-debug'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$map = @{ 16='icon-debug-small-512.png'; 24='icon-debug-mid-512.png'; 32='icon-debug-mid-512.png'; 48='icon-debug-mid-512.png'; 64='icon-debug-512.png'; 128='icon-debug-512.png'; 256='icon-debug-512.png' }
foreach ($sz in @(256,128,64,48,32,24,16)) {
  $srcPath = 'D:\LocalModels\server\' + $map[$sz]
  if (-not (Test-Path $srcPath)) { Write-Warning ('缺少 ' + $srcPath); continue }
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = [System.Drawing.Bitmap]::new($sz, $sz)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $sz, $sz)
  $g.Dispose()
  $bmp.Save((Join-Path $out ('icon-' + $sz + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $src.Dispose()
}
'scaled'