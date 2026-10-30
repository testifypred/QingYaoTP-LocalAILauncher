# App icon: LaTeX-style integral + AI  (visual: \int AI)
# ASCII-only source to avoid PS 5.1 UTF-8-without-BOM decoding problems.
# Design: light paper-like rounded square, dark navy math glyphs (LaTeX look).
Add-Type -AssemblyName System.Drawing

$OutDir = 'D:\LocalModels\server'
$ErrorActionPreference = 'Stop'

$INTEGRAL = [string][char]0x222B   # U+222B INTEGRAL

function Get-SerifFont([single]$px, [bool]$italic) {
  $style = if ($italic) { [System.Drawing.FontStyle]::Italic } else { [System.Drawing.FontStyle]::Regular }
  foreach ($name in @('Cambria Math', 'Times New Roman', 'Georgia')) {
    try {
      $f = [System.Drawing.Font]::new($name, $px, $style, [System.Drawing.GraphicsUnit]::Pixel)
      if ($f.Name) { return $f }
    } catch { }
  }
  return [System.Drawing.Font]::new('Georgia', $px, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function New-IconBitmap([int]$size, [bool]$dark) {
  [single]$s = $size / 256.0
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # ---- rounded square ----
  [single]$pad = 5 * $s
  [single]$r = 56 * $s
  [single]$w = $size - 2 * $pad
  [single]$h = $size - 2 * $pad
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($pad, $pad, $r, $r, 180, 90)
  $path.AddArc($pad + $w - $r, $pad, $r, $r, 270, 90)
  $path.AddArc($pad + $w - $r, $pad + $h - $r, $r, $r, 0, 90)
  $path.AddArc($pad, $pad + $h - $r, $r, $r, 90, 90)
  $path.CloseFigure()

  if ($dark) {
    $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.PointF]::new(0, 0), [System.Drawing.PointF]::new(0, [single]$size),
      [System.Drawing.Color]::FromArgb(255, 38, 51, 79), [System.Drawing.Color]::FromArgb(255, 11, 14, 21))
    $inkColor = [System.Drawing.Color]::FromArgb(255, 150, 190, 255)
    $aiColor  = [System.Drawing.Color]::FromArgb(255, 240, 246, 255)
    $edgeColor = [System.Drawing.Color]::FromArgb(70, 110, 160, 240)
  } else {
    $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.PointF]::new(0, 0), [System.Drawing.PointF]::new(0, [single]$size),
      [System.Drawing.Color]::FromArgb(255, 255, 255, 255), [System.Drawing.Color]::FromArgb(255, 233, 238, 247))
    $inkColor = [System.Drawing.Color]::FromArgb(255, 24, 34, 58)
    $aiColor  = [System.Drawing.Color]::FromArgb(255, 24, 34, 58)
    $edgeColor = [System.Drawing.Color]::FromArgb(46, 30, 45, 80)
  }
  $g.FillPath($bg, $path)
  $edgePen = [System.Drawing.Pen]::new($edgeColor, [single][Math]::Max(1.0, 1.4 * $s))
  $g.DrawPath($edgePen, $path)

  # ---- glyphs ----
  $inkBrush = [System.Drawing.SolidBrush]::new($inkColor)
  $aiBrush  = [System.Drawing.SolidBrush]::new($aiColor)

  $fInt = Get-SerifFont ([single](118 * $s)) $false
  $fAI  = Get-SerifFont ([single](64 * $s))  $true

  $mInt = $g.MeasureString($INTEGRAL, $fInt)
  $mAI  = $g.MeasureString('AI', $fAI)

  # MeasureString includes side bearings on the integral glyph, so pull it in.
  [single]$gap = -5 * $s
  [single]$totalW = $mInt.Width + $gap + $mAI.Width
  [single]$x0 = ($size - $totalW) / 2

  # vertical: centre the taller glyph (integral), then centre AI against it
  [single]$blockH = [Math]::Max($mInt.Height, $mAI.Height)
  [single]$yInt = ($size - $mInt.Height) / 2
  [single]$yAI  = ($size - $mAI.Height) / 2

  $g.DrawString($INTEGRAL, $fInt, $inkBrush, [System.Drawing.PointF]::new($x0, $yInt))
  $g.DrawString('AI', $fAI, $aiBrush, [System.Drawing.PointF]::new($x0 + $mInt.Width + $gap, $yAI))

  $g.Dispose()
  return $bmp
}

# ---- previews: light 256, dark 256, light 48 (small-size legibility) ----
foreach ($p in @(@{ Size = 256; Dark = $false; Name = 'icon-preview.png' },
                 @{ Size = 256; Dark = $true;  Name = 'icon-preview-dark.png' },
                 @{ Size = 48;  Dark = $false; Name = 'icon-preview-48.png' })) {
  $b = New-IconBitmap $p.Size $p.Dark
  $out = Join-Path $OutDir $p.Name
  $b.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  Write-Output "preview -> $out"
}

# ---- multi-size ICO ----
$sizes = @(256, 128, 64, 48, 32, 16)
$blobs = @()
foreach ($sz in $sizes) {
  $b = New-IconBitmap $sz $false
  $ms = [System.IO.MemoryStream]::new()
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $blobs += [pscustomobject]@{ Size = $sz; Data = $ms.ToArray() }
  $ms.Dispose(); $b.Dispose()
}
$icoPath = Join-Path $OutDir 'localai.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = [System.IO.BinaryWriter]::new($fs)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
[UInt32]$offset = 6 + 16 * $sizes.Count
foreach ($blob in $blobs) {
  [Byte]$dim = if ($blob.Size -ge 256) { 0 } else { $blob.Size }
  $bw.Write($dim); $bw.Write($dim)
  $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$blob.Data.Length)
  $bw.Write($offset)
  $offset += $blob.Data.Length
}
foreach ($blob in $blobs) { $bw.Write($blob.Data) }
$bw.Flush(); $bw.Close(); $fs.Close()
Write-Output ("ico -> {0}  ({1} KB, {2} sizes)" -f $icoPath, [math]::Round((Get-Item $icoPath).Length/1KB,1), $sizes.Count)
