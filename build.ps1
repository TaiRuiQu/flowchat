param([switch]$Publish)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if ($Publish) { & npm.cmd run package } else { & npm.cmd run build }
    if ($LASTEXITCODE -ne 0) { throw 'Electron build failed.' }
    if ($Publish) { Write-Output (Join-Path $PSScriptRoot '.artifacts\electron\win-unpacked\FlowChat.exe') }
} finally { Pop-Location }
