Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('D:\LocalModels\server\icon-512.png')
foreach ($sz in @(256,128,64,48,32,16)) {
  $bmp = [System.Drawing.Bitmap]::new($sz, $sz)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $sz, $sz)
  $g.Dispose()
  $bmp.Save('D:\LocalModels\server\icon-parts\icon-' + $sz + '.png', [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$src.Dispose()
'scaled'