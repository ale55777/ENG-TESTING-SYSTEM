<#
.SYNOPSIS
  `npm run dev` from the project root: PostgreSQL (Docker) + FastAPI backend (:8000, auto-reload)
  + Next.js dev server (:3000), all in this terminal. Press Ctrl+C to stop both servers.
  (PostgreSQL keeps running in Docker; stop it with scripts\stop.ps1.)
#>
. (Join-Path $PSScriptRoot "common.ps1")

if (-not (Test-Path $VenvPy)) { Write-Fail "Backend venv missing - run scripts\setup.ps1 first."; exit 1 }
if (-not (Test-Path $EnvFile)) { Write-Fail ".env missing - run scripts\setup.ps1 first."; exit 1 }

# Free the ports if the app was started earlier with scripts\start.ps1.
foreach ($svc in @("frontend", "backend")) {
    $pidFile = Join-Path $RunDir "$svc.pid"
    if (Test-Path $pidFile) { Stop-ProcessTree (Get-Content $pidFile); Remove-Item $pidFile -ErrorAction SilentlyContinue }
}

Write-Step "Starting PostgreSQL"
docker compose -f $Compose --env-file $EnvFile up -d postgres 2>$null | Out-Null
if (-not (Wait-Postgres)) { Write-Fail "PostgreSQL is not healthy. Is Docker Desktop running?"; exit 1 }
Write-Ok "PostgreSQL healthy"

Write-Step "Applying database migrations"
Push-Location $Backend
try { & $VenvPy -m alembic upgrade head; if ($LASTEXITCODE -ne 0) { Write-Fail "Migration failed (is the disk full or Docker read-only?)"; exit 1 } } finally { Pop-Location }

Write-Step "Backend  http://localhost:8000   |   Website  http://localhost:3000   (Ctrl+C stops both)"
$be = Start-Process -FilePath $VenvPy -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload") `
    -WorkingDirectory $Backend -NoNewWindow -PassThru
try {
    Push-Location $Web
    & (Get-Command npm.cmd).Source run dev
} finally {
    Pop-Location
    Stop-ProcessTree $be.Id
    Write-Ok "Backend stopped"
}
