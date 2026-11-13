$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1')
Push-Location $PSScriptRoot
try { & npm.cmd start } finally { Pop-Location }
