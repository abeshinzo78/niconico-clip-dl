# build.ps1
# Firefox版・Chrome版の拡張機能ZIPを生成するビルドスクリプト
#
# 使用方法:
#   .\build.ps1
#
# 出力:
#   niconico-clip-dl-firefox.zip  — Firefox (Manifest V2)
#   niconico-clip-dl-chrome.zip   — Chrome  (Manifest V3)

$rootDir = $PSScriptRoot
Add-Type -Assembly 'System.IO.Compression.FileSystem'

function New-ZipEntry {
    param($zip, $entryName, $filePath)
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
}

# ── 共有ファイル (Firefox・Chrome 両方に含める) ──────────────────────────────

$sharedFiles = @(
    'content/hls-interceptor.js',
    'content/overlay-ui.js',
    'content/downloader.js',
    'content/content.js',
    'lib/mp4box.min.js',
    'lib/hls-parser.js',
    'assets/overlay.css'
)

# ── Firefox版 ─────────────────────────────────────────────────────────────────

$ffZip = Join-Path $rootDir 'niconico-clip-dl-firefox.zip'
if (Test-Path $ffZip) { Remove-Item $ffZip }

$zip = [System.IO.Compression.ZipFile]::Open($ffZip, 'Create')

New-ZipEntry $zip 'manifest.json'         (Join-Path $rootDir 'manifest.json')
New-ZipEntry $zip 'background/background.js' (Join-Path $rootDir 'background/background.js')

foreach ($f in $sharedFiles) {
    New-ZipEntry $zip $f (Join-Path $rootDir $f)
}

$zip.Dispose()
Write-Host "✓ Firefox版: $ffZip"

# ── Chrome版 ──────────────────────────────────────────────────────────────────

$crZip = Join-Path $rootDir 'niconico-clip-dl-chrome.zip'
if (Test-Path $crZip) { Remove-Item $crZip }

$zip = [System.IO.Compression.ZipFile]::Open($crZip, 'Create')

# Chrome固有ファイル (chrome/ ディレクトリから取得して正しいパスに配置)
New-ZipEntry $zip 'manifest.json'         (Join-Path $rootDir 'chrome/manifest.json')
New-ZipEntry $zip 'background/background.js' (Join-Path $rootDir 'chrome/background.js')

# Chrome用互換シム (最初に読み込む)
New-ZipEntry $zip 'lib/browser-compat.js' (Join-Path $rootDir 'lib/browser-compat.js')

foreach ($f in $sharedFiles) {
    New-ZipEntry $zip $f (Join-Path $rootDir $f)
}

$zip.Dispose()
Write-Host "✓ Chrome版:  $crZip"
