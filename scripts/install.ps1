# Installs Claude Crew (crew-map) and Codex Bridge (codex-bridge) for every Claude Code chat on this PC,
# without the plugin marketplace: copies both mods to ~/.claude/mods and points Claude Code at them.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1            # both mods
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 crew-map   # just one
#
# It backs up ~/.claude/settings.json before changing it, and changes nothing if that file is not
# valid JSON. Run it again to update. -ClaudeDir <folder> installs into another Claude config folder.
param([string[]]$Mods = @('crew-map', 'codex-bridge'), [string]$ClaudeDir = (Join-Path $HOME '.claude'))
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$target = Join-Path $ClaudeDir 'mods'
$settingsPath = Join-Path $ClaudeDir 'settings.json'

# Read the settings first: if they cannot be read, nothing is installed or changed.
$settings = [pscustomobject]@{}
if (Test-Path $settingsPath) {
    try { $settings = Get-Content -Raw -Encoding UTF8 $settingsPath | ConvertFrom-Json }
    catch { throw "$settingsPath is not valid JSON, so nothing was changed: $($_.Exception.Message)" }
    if ($null -eq $settings) { $settings = [pscustomobject]@{} }
}
foreach ($m in $Mods) {
    if (-not (Test-Path (Join-Path $repo "$m/.claude-plugin/plugin.json"))) { throw "No mod named '$m' in $repo" }
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
$dirs = @()
foreach ($m in $Mods) {
    $dst = Join-Path $target $m
    if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
    Copy-Item -Recurse (Join-Path $repo $m) $dst
    $dirs += $dst
    Write-Host "copied $m -> $dst"
}

# Add the folders to CLAUDE_CODE_PLUGIN_DIRS (keeping any already there) and turn mods' hooks on.
if (Test-Path $settingsPath) { Copy-Item $settingsPath "$settingsPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }
if (-not $settings.PSObject.Properties['env']) { $settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
$envBlock = $settings.env
$existing = @()
if ($envBlock.PSObject.Properties['CLAUDE_CODE_PLUGIN_DIRS'] -and $envBlock.CLAUDE_CODE_PLUGIN_DIRS) {
    $existing = $envBlock.CLAUDE_CODE_PLUGIN_DIRS -split ';' | Where-Object { $_ }
}
$all = @($existing) + @($dirs) | Select-Object -Unique
$envBlock | Add-Member -Force -NotePropertyName CLAUDE_CODE_PLUGIN_DIRS -NotePropertyValue ($all -join ';')
$envBlock | Add-Member -Force -NotePropertyName CLAUDE_CODE_ENABLE_FUNCTION_HOOKS -NotePropertyValue '1'
[System.IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 32), (New-Object System.Text.UTF8Encoding $false))
Write-Host "updated $settingsPath (a backup sits next to it)"
Write-Host ''
Write-Host 'Done. Quit the Claude desktop app completely (or close every claude terminal), start it again,'
Write-Host 'and open a new chat: /crew opens the crew map, /codex the Codex pane.'
