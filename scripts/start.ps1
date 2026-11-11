<#
.SYNOPSIS
  Start PostgreSQL (Docker), the FastAPI backend (:8000) and the Next.js frontend (:3000).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1          # production frontend (builds if needed)
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Dev     # hot-reload dev servers
#>
param([switch]$Dev, [switch]$NoBrowser)

. (Join-Path $PSScriptRoot "common.ps1")
New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null

if (-not (Test-Path $VenvPy)) { Write-Fail "Backend venv missing - run scripts\setup.ps1 first."; exit 1 }
if (-not (Test-Path $EnvFile)) { Write-Fail ".env missing - run scripts\setup.ps1 first."; exit 1 }

foreach ($svc in @("backend", "frontend")) {
    $pidFile = Join-Path $RunDir "$svc.pid"
    if (Test-Path $pidFile) {
        $old = Get-Content $pidFile
        if (Get-Process -Id $old -ErrorAction SilentlyContinue) { Write-Warn2 "$svc already running (PID $old). Run scripts\stop.ps1 first."; exit 1 }
        Remove-Item $pidFile
    }
}

Write-Step "Starting PostgreSQL"
docker compose -f $Compose --env-file $EnvFile up -d postgres
if (-not (Wait-Postgres)) { Write-Fail "PostgreSQL is not healthy. Is Docker Desktop running?"; exit 1 }
Write-Ok "PostgreSQL healthy"

Write-Step "Applying database migrations"
Push-Location $Backend
try { & $VenvPy -m alembic upgrade head; if ($LASTEXITCODE -ne 0) { throw "migration failed" } } finally { Pop-Location }

Write-Step "Starting backend on http://localhost:8000"
$backendArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000")
if ($Dev) { $backendArgs += "--reload" }
$be = Start-Process -FilePath $VenvPy -ArgumentList $backendArgs -WorkingDirectory $Backend -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "backend.log") -RedirectStandardError (Join-Path $LogDir "backend.err.log")
Set-Content (Join-Path $RunDir "backend.pid") $be.Id
if (-not (Wait-Http "http://127.0.0.1:8000/api/v1/health" 90)) { Write-Fail "Backend failed to start - see logs\backend.err.log"; exit 1 }
$h = Invoke-RestMethod "http://127.0.0.1:8000/api/v1/health"
Write-Ok "Backend healthy (transcription: $($h.features.transcription); groq: $($h.features.groq); realtime: $($h.features.realtime))"

Write-Step "Starting frontend on http://localhost:3000"
$npm = (Get-Command npm.cmd).Source
if (-not $Dev -and -not (Test-Path (Join-Path $Web ".next\BUILD_ID"))) {
    Write-Host "    No production build found - building (one-time)..."
    Push-Location $Web; try { & $npm run build; if ($LASTEXITCODE -ne 0) { throw "build failed" } } finally { Pop-Location }
}
$feArgs = if ($Dev) { @("run", "dev") } else { @("run", "start") }
$fe = Start-Process -FilePath $npm -ArgumentList $feArgs -WorkingDirectory $Web -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "frontend.log") -RedirectStandardError (Join-Path $LogDir "frontend.err.log")
Set-Content (Join-Path $RunDir "frontend.pid") $fe.Id
if (-not (Wait-Http "http://localhost:3000/" 120)) { Write-Fail "Frontend failed to start - see logs\frontend.err.log"; exit 1 }
Write-Ok "Frontend ready"

Write-Host ""
Write-Host "LinguaPractice is running:  http://localhost:3000   (API docs: http://localhost:8000/api/docs)" -ForegroundColor Green
Write-Host "Logs: $LogDir    Stop with: powershell -ExecutionPolicy Bypass -File scripts\stop.ps1"
if (-not $NoBrowser) { Start-Process "http://localhost:3000" }
