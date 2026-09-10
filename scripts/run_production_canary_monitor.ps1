$ErrorActionPreference = 'Stop'
$workspace = 'C:\Data\Affiliate Chat'
$watcher = Join-Path $workspace 'scripts\watch_production_canary_sqlite.js'
$output = Join-Path $workspace 'n8n\exports\production-canary-20260828\persistent-watch.ndjson'
$status = Join-Path $workspace 'n8n\exports\production-canary-20260828\persistent-monitor-status.json'
$baseline = 26835
$paused = $false

Set-Location -LiteralPath $workspace
@{ started_at = [DateTime]::UtcNow.ToString('o'); baseline = $baseline; state = 'watching'; dispatch = 'enabled' } |
  ConvertTo-Json | Set-Content -LiteralPath $status

Get-Content -Raw -LiteralPath $watcher |
  docker exec -i n8n-local node - $baseline 2000 |
  ForEach-Object {
    $line = [string]$_
    Add-Content -LiteralPath $output -Value $line
    if (-not $paused -and $line -match '"workflow_id":"AffWaDelivery2026"' -and $line -match '"status":"error"') {
      $pauseOutput = node scripts\production_canary_control.js pause 2>&1
      $pauseOutput | Add-Content -LiteralPath $output
      $paused = $true
      @{ observed_at = [DateTime]::UtcNow.ToString('o'); state = 'delivery_failed'; dispatch = 'paused'; reason = 'first_post_unpause_delivery_error' } |
        ConvertTo-Json | Set-Content -LiteralPath $status
    }
  }
