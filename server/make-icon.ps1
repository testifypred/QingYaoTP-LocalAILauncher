# App icon generator (black edition) -- ink-measured auto layout
# Motif: LaTeX \partial + "AI" + "?" on a black rounded square.
# ASCII-only source: PS 5.1 may decode this file as GBK if the BOM is lost.
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$OutDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$Parts  = Join-Path $OutDir 'icon-parts'
New-Item -ItemType Directory -Force -Path $Parts | Out-Null
$PARTIAL = [string][char]0x2202   # U+2202

function New-RoundPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $p.AddArc($x, $y, $r, $r, 180, 90)
  $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
  $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
  $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Font([string[]]$names, [single]$px, [bool]$italic, [bool]$bold) {
  $st = [System.Drawing.FontStyle]::Regular
  if ($italic -and $bold) { $st = [System.Drawing.FontStyle]::Italic -bor [System.Drawing.FontStyle]::Bold }
  elseif ($italic) { $st = [System.Drawing.FontStyle]::Italic }
  elseif ($bold) { $st = [System.Drawing.FontStyle]::Bold }
  foreach ($n in $names) {
    try {
      $f = [System.Drawing.Font]::new($n, $px, $st, [System.Drawing.GraphicsUnit]::Pixel)
      if ($f.Name -eq $n) { return $f }
    } catch { }
  }
  return [System.Drawing.Font]::new('Segoe UI', $px, $st, [System.Drawing.GraphicsUnit]::Pixel)
}

# Measure the ink box of a glyph run relative to the DrawString origin.
function Get-InkBox([string]$text, [System.Drawing.Font]$font) {
  $m = [int][math]::Ceiling($font.Size * 3) + 40
  $bmp = [System.Drawing.Bitmap]::new($m, $m)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawString($text, $font, [System.Drawing.Brushes]::White, [single]10, [single]10)
  $minX = $m; $minY = $m; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $m; $y++) {
    for ($x = 0; $x -lt $m; $x++) {
      if ($bmp.GetPixel($x, $y).A -gt 16) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $g.Dispose(); $bmp.Dispose()
  if ($maxX -lt 0) { return @{ x = 0; y = 0; w = 1; h = 1 } }
  return @{ x = ($minX - 10); y = ($minY - 10); w = ($maxX - $minX + 1); h = ($maxY - $minY + 1) }
}

function Draw-Ink([System.Drawing.Graphics]$g, [string]$text, $font, $brush, [single]$left, [single]$top, [bool]$isSmall) {
  # 测量和绘制必须用同一个 StringFormat（这里都用默认）。
  # 之前测量用默认、绘制用 GenericTypographic，两者内边距不同，整体就偏了。
  $ink = Get-InkBox $text $font
  $g.DrawString($text, $font, $brush, [single]($left - $ink.x), [single]($top - $ink.y))
}

function New-IconBitmap([int]$size) {
  [single]$s = $size / 256.0
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  [single]$pad = 4 * $s
  [single]$r = 58 * $s
  $path = New-RoundPath $pad $pad ([single]($size - 2 * $pad)) ([single]($size - 2 * $pad)) $r

  $rect = [System.Drawing.RectangleF]::new(0, 0, [single]$size, [single]$size)
  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect,
    [System.Drawing.Color]::FromArgb(255, 20, 22, 28),
    [System.Drawing.Color]::FromArgb(255, 0, 0, 0),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillPath($bg, $path)

  if ($size -ge 48) {
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(60, 34, 211, 238), [single](1.6 * $s))
    $g.DrawPath($pen, $path)
    $pen.Dispose()
  }

  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 246, 248, 250))
  $cyan  = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 45, 212, 238))

  # ---- layout targets (in 256 units) ----
  $inkH = 0.50 * 256     # partial glyph height
  $aiH  = 0.26 * 256     # AI cap height
  $qH   = 0.13 * 256     # question mark height
  $gap  = 0.055 * 256
  $baseY = 0.74 * 256    # common baseline (ink bottoms)

  $fD = New-Font @('Cambria Math', 'Times New Roman', 'Georgia') ([single](256 * $s)) $true $false
  $inkD = Get-InkBox $PARTIAL $fD
  [single]$scaleD = ($inkH * $s) / $inkD.h
  $fD.Dispose()
  $fD = New-Font @('Cambria Math', 'Times New Roman', 'Georgia') ([single](256 * $s * $scaleD)) $true $false
  $inkD = Get-InkBox $PARTIAL $fD

  $fA = New-Font @('Segoe UI', 'Arial') ([single](256 * $s)) $false $true
  $inkA = Get-InkBox 'AI' $fA
  [single]$scaleA = ($aiH * $s) / $inkA.h
  $fA.Dispose()
  $fA = New-Font @('Segoe UI', 'Arial') ([single](256 * $s * $scaleA)) $false $true
  $inkA = Get-InkBox 'AI' $fA

  $wD = $inkD.w; $wA = $inkA.w
  $groupW = $wD + ($gap * $s) + $wA
  [single]$groupLeft = (($size - $groupW) / 2)
  [single]$clusterRight = $groupLeft + $groupW

  $topD = ($baseY * $s) - $inkD.h
  Draw-Ink $g $PARTIAL $fD $white $groupLeft $topD $false
  [single]$topA = ($baseY * $s) - $inkA.h
  Draw-Ink $g 'AI' $fA $white ([single]($groupLeft + $wD + $gap * $s)) $topA $false

  if ($size -ge 48) {
    $fQ = New-Font @('Segoe UI', 'Arial') ([single](256 * $s)) $false $true
    $inkQ = Get-InkBox '?' $fQ
    [single]$scaleQ = ($qH * $s) / $inkQ.h
    $fQ.Dispose()
    $fQ = New-Font @('Segoe UI', 'Arial') ([single](256 * $s * $scaleQ)) $false $true
    $inkQ = Get-InkBox '?' $fQ
    [single]$qx = $clusterRight - $inkQ.w
    [single]$qy = $topA - ($inkQ.h) - (0.045 * $s * 256)
    if ($qy -lt (0.10 * $s * 256)) { $qy = 0.10 * $s * 256 }
    Draw-Ink $g '?' $fQ $cyan $qx $qy $true
    $fQ.Dispose()
  }

  $fD.Dispose(); $fA.Dispose()
  $white.Dispose(); $cyan.Dispose(); $bg.Dispose(); $path.Dispose(); $g.Dispose()
  return $bmp
}

foreach ($sz in @(256, 128, 64, 48, 32, 16)) {
  $bmp = New-IconBitmap $sz
  $bmp.Save((Join-Path $Parts ("icon-$sz.png")), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$big = New-IconBitmap 512
$big.Save((Join-Path $OutDir 'icon-preview-black.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose()
Copy-Item (Join-Path $Parts 'icon-256.png') (Join-Path $OutDir 'icon-preview-black-256.png') -Force
'SIZES OK'
