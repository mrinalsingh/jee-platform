$timestamp = Get-Date -Format "yyyy-MM-dd"
$zipName = "agent-factory-$timestamp.zip"
$dest = Join-Path $env:USERPROFILE "Desktop\$zipName"
$source = Split-Path -Parent $PSCommandPath

Compress-Archive -Path "$source\*" -DestinationPath $dest -Force
Write-Host "Exported to: $dest" -ForegroundColor Green
Write-Host "Share this zip. Recipient extracts it and points Claude Code at the CLAUDE.md inside."
