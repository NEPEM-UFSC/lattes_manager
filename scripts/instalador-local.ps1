# Gera o instalador do Windows localmente (sem GitHub) e copia para instaladores/.
# Uso (na raiz do repositório):  powershell -ExecutionPolicy Bypass -File scripts\instalador-local.ps1
# Para só testar mudanças, sem instalador:  cargo tauri dev
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

cargo tauri build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "Falha no build (código $LASTEXITCODE)" }

$dest = Join-Path $root "instaladores"
New-Item -ItemType Directory -Force $dest | Out-Null
$exe = Get-ChildItem "target\release\bundle\nsis\*-setup.exe" | Sort-Object LastWriteTime | Select-Object -Last 1
Copy-Item $exe.FullName $dest -Force
Write-Host "Instalador: $(Join-Path $dest $exe.Name)"
