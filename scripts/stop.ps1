<#
.SYNOPSIS
  Stop the frontend, backend and (unless -KeepDatabase) the PostgreSQL container. Data is preserved
  in the Docker volume; use "docker compose -f infrastructure/docker-compose.yml down -v" to erase it.
#>
param([switch]$KeepDatabase)

. (Join-Path $PSScriptRoot "common.ps1")

foreach ($svc in @("frontend", "backend")) {
    $pidFile = Join-Path $RunDir "$svc.pid"
    if (Test-Path $pidFile) {
        $procId = Get-Content $pidFile
        Stop-ProcessTree $procId
        Remove-Item $pidFile -ErrorAction SilentlyContinue
        Write-Ok "Stopped $svc (PID $procId)"
    } else {
        Write-Warn2 "$svc is not running (no PID file)"
    }
}

if (-not $KeepDatabase) {
    if (Test-Command docker) {
        docker compose -f $Compose --env-file $EnvFile stop postgres 2>$null | Out-Null
        Write-Ok "Stopped PostgreSQL container (data kept in volume)"
    }
}
