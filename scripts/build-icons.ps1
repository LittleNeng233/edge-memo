# EdgeMemo icon build: design/icon-1024.png -> resources/ multi-size ico + derived icons
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root 'design\icon-1024.png'
$resDir = Join-Path $root 'resources'
if (-not (Test-Path $srcPath)) { Write-Error "design source missing: $srcPath"; exit 1 }

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$S = [Math]::Min($src.Width, $src.Height)

# Center-crop square source, scale to 512 intermediate
$mid = New-Object System.Drawing.Bitmap(512, 512)
$g = [System.Drawing.Graphics]::FromImage($mid)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$srcRect = New-Object System.Drawing.Rectangle(0, 0, $src.Width, $src.Height)
$side = [int](512 * [Math]::Max($src.Width, $src.Height) / $S)
$off = [int]((512 - $side) / 2)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle($off, $off, $side, $side)), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

# Two-step downscale (via 4x intermediate) to avoid artifacts at small sizes
function Get-IconFrame ([int]$size) {
  $from = $mid
  if ($size -lt 256) {
    $q = $size * 4
    $from = New-Object System.Drawing.Bitmap($q, $q)
    $g = [System.Drawing.Graphics]::FromImage($from)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($mid, (New-Object System.Drawing.Rectangle(0, 0, $q, $q)), (New-Object System.Drawing.Rectangle(0, 0, 512, 512)), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
  }
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($from, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)), (New-Object System.Drawing.Rectangle(0, 0, $from.Width, $from.Height)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  if ($from -ne $mid) { $from.Dispose() }
  return $bmp
}

$sizes = @(256, 128, 64, 48, 32, 24, 16)
$tmp = Join-Path $env:TEMP "edgememo-icons-$(Get-Random)"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

$frames = @()
foreach ($s in $sizes) {
  $bmp = Get-IconFrame $s
  $file = Join-Path $tmp "$s.png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $frames += , ([System.IO.File]::ReadAllBytes($file))
}

# Assemble ICO (PNG-compressed frames, standard Vista+ format)
$count = $sizes.Count
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$count)
$offset = 6 + 16 * $count
for ($i = 0; $i -lt $count; $i++) {
  $s = $sizes[$i]
  $len = $frames[$i].Length
  $dim = 0; if ($s -lt 256) { $dim = $s }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$len); $bw.Write([uint32]$offset)
  $offset += $len
}
foreach ($f in $frames) { $bw.Write($f) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $resDir 'icon.ico'), $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

# Main PNG (256) and derived icons
$f256 = Get-IconFrame 256
$f256.Save((Join-Path $resDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$f256.Dispose()
$f32 = Get-IconFrame 32
$f32.Save((Join-Path $resDir 'tray.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$f32.Save((Join-Path $resDir 'drag-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$f32.Dispose()

Remove-Item $tmp -Recurse -Force
$src.Dispose(); $mid.Dispose()
Write-Host "OK: icon.ico ($($sizes -join '/')) + icon.png / tray.png / drag-icon.png"
