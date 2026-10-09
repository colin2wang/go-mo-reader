# =====================================================================
# MoRead - Windows one-click build script (build.ps1)
# Stack: Go + Wails v2 + Vue3 + TypeScript
# Usage:
#   .\build.ps1              # normal build (produces build\bin\MoRead.exe)
#   .\build.ps1 -Clean       # clean, then build
#   .\build.ps1 -Package     # build, then pack a zip into build\dist\
#   .\build.ps1 -Clean -Package
# =====================================================================
[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$Package
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location $Root

function Test-Cmd($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "[X] $name not found. Please install it and add it to PATH." -ForegroundColor Red
        exit 1
    }
}

Write-Host '==> Checking build environment...' -ForegroundColor Cyan
Test-Cmd 'go'
Test-Cmd 'pnpm'
Test-Cmd 'wails'

Write-Host "    go    : $(go version)"
Write-Host "    node  : $(node -v)"
Write-Host "    pnpm  : $(pnpm -v)"
Write-Host "    wails : $(wails version | Select-Object -First 1)"

# WebView2 runtime check (usually preinstalled on Windows 10/11)
$wv2 = @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
         'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
$hasWv2 = $false
foreach ($k in $wv2) { if (Test-Path $k) { $hasWv2 = $true; break } }
if (-not $hasWv2) {
    Write-Host '[!] WebView2 runtime not detected. MoRead.exe requires it:' -ForegroundColor Yellow
    Write-Host '    https://developer.microsoft.com/microsoft-edge/webview2/' -ForegroundColor Yellow
}

if ($Clean) {
    Write-Host '==> Cleaning build artifacts...' -ForegroundColor Cyan
    Remove-Item -Recurse -Force "$Root\build\bin"   -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$Root\build\dist"  -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$Root\frontend\node_modules" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$Root\frontend\dist"         -ErrorAction SilentlyContinue
}

Write-Host '==> Installing frontend dependencies (pnpm install)...' -ForegroundColor Cyan
Push-Location "$Root\frontend"
# --frozen-lockfile keeps node_modules in sync with pnpm-lock.yaml (CI-safe)
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Pop-Location

Write-Host '==> Building with Wails (windows/amd64)...' -ForegroundColor Cyan
wails build -platform windows/amd64 -webview2 embed
if ($LASTEXITCODE -ne 0) { exit 1 }

$exe = "$Root\build\bin\MoRead.exe"
if (-not (Test-Path $exe)) { Write-Host '[X] Build output is missing.' -ForegroundColor Red; exit 1 }
Write-Host "    Output: $exe ($([math]::Round((Get-Item $exe).Length/1MB,1)) MB)" -ForegroundColor Green

if ($Package) {
    Write-Host '==> Packaging ZIP...' -ForegroundColor Cyan
    $dist = "$Root\build\dist"
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $stage = "$dist\MoRead"
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item $exe $stage
    if (Test-Path "$Root\README.md") { Copy-Item "$Root\README.md" "$stage\README.md" }
    # Source code (excluding build artifacts and dependencies)
    robocopy "$Root" "$stage\src" /E /XD node_modules dist bin ".git" build /XF "*.syso" /NFL /NDL /NJH /NJS | Out-Null
    $zip = "$dist\MoRead-1.0.0.zip"
    if (Test-Path $zip) { Remove-Item -Force $zip }
    Compress-Archive -Path $stage -DestinationPath $zip
    Remove-Item -Recurse -Force $stage
    Write-Host "    ZIP: $zip" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Build finished. Right-click an EPUB -> Send to -> MoRead to open it.' -ForegroundColor Green
Write-Host '(To add the Send to entry: Win+R, type shell:sendto, then put a shortcut to MoRead.exe there.)'
