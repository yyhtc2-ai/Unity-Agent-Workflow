param(
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [string]$CodelyEntry,
    [switch]$SkipFoundry
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
if ($env:CODEX_HOME -and [IO.Path]::GetFullPath($env:CODEX_HOME) -ne $CodexHome) { throw 'CodexHome differs from CODEX_HOME' }
$defaultHome = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.codex'))
if ($CodexHome -ne $defaultHome -and !$env:CODEX_HOME) { throw 'Set CODEX_HOME to match custom CodexHome before installation' }
$node = (Get-Command node -ErrorAction Stop).Source
$null = Get-Command codex -ErrorAction Stop
$null = Get-Command npm.cmd -ErrorAction Stop
if (!$CodelyEntry) {
    $npmRoot = (& npm.cmd root -g | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve npm global modules' }
    $CodelyEntry = Join-Path $npmRoot '@codely/cli/bundle/gemini.js'
}
if (!(Test-Path -LiteralPath $CodelyEntry -PathType Leaf)) { throw 'Install official Codely CLI first or specify -CodelyEntry' }
$CodelyEntry = (Resolve-Path -LiteralPath $CodelyEntry).Path
# Preflight every destination before any user configuration changes.
$skillRoot = Join-Path $CodexHome 'skills'
$sources = @((Get-Item (Join-Path $root 'skills/cowork-collaboration')))
if (!$SkipFoundry) { $sources += @(Get-ChildItem (Join-Path $root 'plugins/agent-foundry/skills') -Directory) }
foreach ($source in $sources) {
    if (Test-Path -LiteralPath (Join-Path $skillRoot $source.Name)) { throw "Skill already exists: $($source.Name). No overwrite performed." }
}
& codex mcp get codely_bridge 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw 'codely_bridge already registered. Review existing configuration instead of overwriting it.' }
Push-Location (Join-Path $root 'bridge/codely')
try {
    & npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
} finally { Pop-Location }
New-Item -ItemType Directory -Path $skillRoot -Force | Out-Null
foreach ($source in $sources) { Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $skillRoot $source.Name) -Recurse }
if (!$SkipFoundry) {
    $noticeDir = Join-Path $CodexHome 'agent-workflow-notices/agent-foundry'
    New-Item -ItemType Directory -Path $noticeDir -Force | Out-Null
    foreach ($name in @('LICENSE','THIRD_PARTY_NOTICES.md','UNITY_COMPANION_LICENSE.md')) {
        Copy-Item -LiteralPath (Join-Path $root "plugins/agent-foundry/$name") -Destination $noticeDir
    }
}
$server = Join-Path $root 'bridge/codely/dist/server.js'
& codex mcp add codely_bridge --env 'BRIDGE_EXPOSE=codely' --env "BRIDGE_CODELY_ENTRY=$CodelyEntry" -- $node $server
if ($LASTEXITCODE -ne 0) { throw 'MCP registration failed. Copied skills remain installed; inspect before retrying.' }
Write-Host 'Installed. Keep this repository at its current path; open a new Codex session.'
Write-Host 'Codely collaboration requires explicit user invocation for the current project/task.'
