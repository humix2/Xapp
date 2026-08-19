<#
  Manually assembles a portable Windows build of XDeck under dist\XDeck-win32-x64,
  reusing node_modules\electron\dist as the runtime (electron-packager's own zip
  extraction is unreliable on this machine, so this script does it directly).

  Usage:
    powershell -ExecutionPolicy Bypass -File build-package.ps1
#>

$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$outDir = Join-Path $src 'dist\XDeck-win32-x64'
$appDir = Join-Path $outDir 'resources\app'
$exePath = Join-Path $outDir 'XDeck.exe'

if (-not (Test-Path $exePath)) {
  Write-Host 'No existing build found - assembling the Electron runtime...'
  New-Item -ItemType Directory -Force $outDir | Out-Null
  Copy-Item -Path (Join-Path $src 'node_modules\electron\dist\*') -Destination $outDir -Recurse -Force
  Rename-Item -Path (Join-Path $outDir 'electron.exe') -NewName 'XDeck.exe'
} else {
  Write-Host 'Existing runtime found - reusing it, only refreshing app code.'
}

New-Item -ItemType Directory -Force $appDir | Out-Null
$files = @('main.js', 'preload.js', 'index.html', 'renderer.js', 'styles.css', 'inject.css', 'package.json')
foreach ($f in $files) {
  Copy-Item -Path (Join-Path $src $f) -Destination (Join-Path $appDir $f) -Force
}

Write-Host "Done: $exePath"
