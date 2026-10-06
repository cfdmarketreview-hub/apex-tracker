param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\public')
)

Add-Type -AssemblyName System.Drawing
$background = [System.Drawing.ColorTranslator]::FromHtml('#080808')
$gold = [System.Drawing.ColorTranslator]::FromHtml('#c8a96e')

foreach ($size in @(180, 512)) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear($background)

  $pen = [System.Drawing.Pen]::new($gold, [single]($size * 0.082))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
  $graphics.DrawLines($pen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new([single]($size * 0.24), [single]($size * 0.78)),
    [System.Drawing.PointF]::new([single]($size * 0.50), [single]($size * 0.20)),
    [System.Drawing.PointF]::new([single]($size * 0.76), [single]($size * 0.78))
  ))
  $graphics.DrawLine($pen,
    [single]($size * 0.355), [single]($size * 0.585),
    [single]($size * 0.645), [single]($size * 0.585))

  $path = Join-Path $OutputDirectory "icon-apex-$size.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  Write-Output $path
}
