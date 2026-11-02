$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location (Join-Path $root 'bridge/codely')
try {
    & npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    & node tests/codely-mcp.mjs
    if ($LASTEXITCODE -ne 0) { throw 'MCP tests failed' }
    & node --test tests/regressions.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Bridge regression tests failed' }
} finally { Pop-Location }
Push-Location (Join-Path $root 'skills/cowork-collaboration/scripts')
try {
    & python -X utf8 -m unittest test_ledger
    if ($LASTEXITCODE -ne 0) { throw 'Ledger tests failed' }
} finally { Pop-Location }
Write-Host 'Offline verification passed. No model calls were made.'
