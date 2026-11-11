<#
.SYNOPSIS
  One-time setup for the English Learning & Practice Platform on Windows.

.DESCRIPTION
  Checks prerequisites (offering winget installs with your approval), creates the Python venv,
  installs backend + frontend dependencies, downloads local models (Supertonic TTS, wav2vec2
  pronunciation model), starts PostgreSQL in Docker, runs migrations, writes config templates,
  verifies Groq/Ably credentials, backend health, TTS and the frontend build, then prints a summary.

  No API keys are generated or faked. Without GROQ_API_KEY / ABLY_API_KEY the platform still runs:
  typing practice, predefined exercises, offline pronunciation scoring and an offline (lower accuracy)
  speech recognizer remain available.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Yes -SkipBuild
#>
param(
    [switch]$Yes,          # answer "yes" to install prompts
    [switch]$SkipModels,   # do not download local models
    [switch]$SkipBuild     # do not run the frontend production build
)

. (Join-Path $PSScriptRoot "common.ps1")
$summary = [ordered]@{}

# 1. Windows version -------------------------------------------------------------------------
Write-Step "Checking Windows version"
$os = Get-CimInstance Win32_OperatingSystem
Write-Ok "$($os.Caption) build $($os.BuildNumber)"
if ([int]$os.BuildNumber -lt 17763) { Write-Warn2 "Windows 10 1809 or newer is recommended." }
$summary["Windows"] = "$($os.Caption) ($($os.BuildNumber))"

# 2-4. Prerequisites ---------------------------------------------------------------------------
function Ensure-Tool($label, $check, $wingetId) {
    $v = $null
    try { $v = & $check } catch { $v = $null }
    if ($v) { Write-Ok "$label $v"; return $v }
    Write-Warn2 "$label not found."
    if ((Test-Command winget) -and (Confirm-Action "Install $label with winget ($wingetId)?" -AssumeYes:$Yes)) {
        winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
        Write-Warn2 "Installed $label. Open a NEW terminal and re-run setup so PATH is refreshed."
        exit 1
    }
    return $null
}

Write-Step "Checking Python 3.12+"
$pyExe = $null
foreach ($cand in @("py -3.13", "py -3.12", "python")) {
    try {
        $ver = (Invoke-Py $cand @("--version") 2>&1) | Out-String
        if ($ver -match "Python 3\.(\d+)" -and [int]$Matches[1] -ge 12) { $pyExe = $cand; Write-Ok "$($ver.Trim()) ($cand)"; break }
    } catch { }
}
if (-not $pyExe) {
    Ensure-Tool "Python 3.12" { $null } "Python.Python.3.12" | Out-Null
    Write-Fail "Python 3.12+ is required."; exit 1
}
$summary["Python"] = $pyExe

Write-Step "Checking Node.js 20+"
$nodeV = Ensure-Tool "Node.js" { if (Test-Command node) { node --version } } "OpenJS.NodeJS.LTS"
if (-not $nodeV -or [int]($nodeV.TrimStart("v").Split(".")[0]) -lt 20) { Write-Fail "Node.js 20+ is required."; exit 1 }
$summary["Node.js"] = $nodeV

Write-Step "Checking Docker Desktop"
$dockerV = Ensure-Tool "Docker" { if (Test-Command docker) { (docker --version) } } "Docker.DockerDesktop"
$dockerOk = $false
if ($dockerV) {
    docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $dockerOk = $true; Write-Ok "Docker engine is running" }
    else { Write-Warn2 "Docker is installed but the engine is not running. Start Docker Desktop, then re-run setup." }
}
$summary["Docker"] = if ($dockerOk) { "running" } else { "NOT running" }

# 5. Resources ---------------------------------------------------------------------------------
Write-Step "Checking RAM and disk space"
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$drive = (Get-Item $Root).PSDrive
$freeGb = [math]::Round($drive.Free / 1GB, 1)
if ($ramGb -lt 7.5) { Write-Warn2 "$ramGb GB RAM (8 GB recommended for local TTS + speech models)" } else { Write-Ok "$ramGb GB RAM" }
if ($freeGb -lt 3) { Write-Warn2 "$freeGb GB free on $($drive.Name): (about 3 GB needed for dependencies and models)" } else { Write-Ok "$freeGb GB free on $($drive.Name):" }
$summary["Resources"] = "$ramGb GB RAM, $freeGb GB free"

# 13. Configuration templates ------------------------------------------------------------------
Write-Step "Preparing configuration (.env)"
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $Root ".env.example") $EnvFile
    Write-Ok "Created .env from .env.example"
}
$envVars = Read-DotEnv
if (-not $envVars["JWT_SECRET"]) {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Set-DotEnvValue "JWT_SECRET" (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
    Write-Ok "Generated a random local JWT_SECRET"
}
$envVars = Read-DotEnv
$webEnv = Join-Path $Web ".env.local"
$apiBase = if ($envVars["NEXT_PUBLIC_API_BASE_URL"]) { $envVars["NEXT_PUBLIC_API_BASE_URL"] } else { "http://localhost:8000" }
$ablyAuth = if ($envVars["NEXT_PUBLIC_ABLY_AUTH_URL"]) { $envVars["NEXT_PUBLIC_ABLY_AUTH_URL"] } else { "$apiBase/api/v1/realtime/token" }
[System.IO.File]::WriteAllLines($webEnv, [string[]]@("NEXT_PUBLIC_API_BASE_URL=$apiBase", "NEXT_PUBLIC_ABLY_AUTH_URL=$ablyAuth"), (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "Wrote apps/web/.env.local (public values only - no secrets)"

# 7-8. Backend --------------------------------------------------------------------------------
Write-Step "Creating Python virtual environment and installing backend dependencies"
if (-not (Test-Path $VenvPy)) {
    Invoke-Py $pyExe @("-m", "venv", (Join-Path $Backend ".venv"))
}
& $VenvPy -m pip install --upgrade pip --quiet
& $VenvPy -m pip install -r (Join-Path $Backend "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { Write-Fail "pip install failed"; exit 1 }
Write-Ok "Backend dependencies installed"

# 9. Frontend ----------------------------------------------------------------------------------
Write-Step "Installing frontend dependencies"
Push-Location $Web
try {
    if (Test-Path "package-lock.json") { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Ok "Frontend dependencies installed"
} finally { Pop-Location }

# 10. Local models -----------------------------------------------------------------------------
$supertonicDir = Join-Path $Backend "models\supertonic3"
$pronDir = Join-Path $Backend "models\wav2vec2-base-960h"
if (-not $SkipModels) {
    Write-Step "Downloading local models (free, no API key)"
    if (-not (Test-Path (Join-Path $supertonicDir "onnx"))) {
        Write-Host "    Supertonic 3 TTS (~400 MB, code MIT / weights OpenRAIL-M)..."
        & $VenvPy -c "from supertonic import TTS; TTS(model_dir=r'$supertonicDir', auto_download=True)"
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "Supertonic download failed - reference audio will be unavailable." }
    } else { Write-Ok "Supertonic model present" }
    New-Item -ItemType Directory -Force $pronDir | Out-Null
    $base = "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main"
    $files = @{ "model_quantized.onnx" = "onnx/model_quantized.onnx"; "vocab.json" = "vocab.json"; "preprocessor_config.json" = "preprocessor_config.json"; "config.json" = "config.json" }
    foreach ($k in $files.Keys) {
        $dest = Join-Path $pronDir $k
        if (-not (Test-Path $dest)) {
            Write-Host "    wav2vec2-base-960h: $k"
            Invoke-WebRequest -Uri "$base/$($files[$k])" -OutFile $dest -UseBasicParsing -ErrorAction Stop
        }
    }
    Write-Ok "Pronunciation model present (wav2vec2-base-960h int8 ONNX, ~95 MB)"
}

# 11-12. Database ------------------------------------------------------------------------------
$dbOk = $false
if ($dockerOk) {
    Write-Step "Starting PostgreSQL (Docker) and running migrations"
    docker compose -f $Compose --env-file $EnvFile up -d postgres
    if (Wait-Postgres) {
        Write-Ok "PostgreSQL is healthy"
        Push-Location $Backend
        try {
            & $VenvPy -m alembic upgrade head
            if ($LASTEXITCODE -eq 0) { $dbOk = $true; Write-Ok "Migrations applied" } else { Write-Fail "alembic upgrade failed" }
        } finally { Pop-Location }
    } else { Write-Fail "PostgreSQL did not become healthy" }
}
$summary["Database"] = if ($dbOk) { "PostgreSQL ready, migrated" } else { "NOT ready" }

# 14-15. Credentials ---------------------------------------------------------------------------
Write-Step "Checking cloud credentials (never printed)"
$envVars = Read-DotEnv
if ($envVars["GROQ_API_KEY"]) {
    try {
        $r = Invoke-RestMethod -Uri "https://api.groq.com/openai/v1/models" -Headers @{ Authorization = "Bearer $($envVars['GROQ_API_KEY'])" } -TimeoutSec 15 -ErrorAction Stop
        $ids = $r.data | ForEach-Object { $_.id }
        $chat = if ($envVars["GROQ_CHAT_MODEL"]) { $envVars["GROQ_CHAT_MODEL"] } else { "openai/gpt-oss-20b" }
        $stt = if ($envVars["GROQ_STT_MODEL"]) { $envVars["GROQ_STT_MODEL"] } else { "whisper-large-v3-turbo" }
        Write-Ok "Groq key valid. $chat available: $($ids -contains $chat); $stt available: $($ids -contains $stt)"
        $summary["Groq"] = "valid"
    } catch { Write-Fail "Groq key rejected or Groq unreachable: $($_.Exception.Message)"; $summary["Groq"] = "INVALID / unreachable" }
} else {
    Write-Warn2 "GROQ_API_KEY not set: AI generation/feedback disabled; offline speech recognizer will be used."
    Write-Host "           Get a key at https://console.groq.com/keys and add GROQ_API_KEY=... to .env"
    $summary["Groq"] = "not configured (offline mode)"
}
if ($envVars["ABLY_API_KEY"]) {
    try {
        $pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($envVars["ABLY_API_KEY"]))
        Invoke-RestMethod -Uri "https://rest.ably.io/stats?limit=1" -Headers @{ Authorization = "Basic $pair" } -TimeoutSec 15 -ErrorAction Stop | Out-Null
        Write-Ok "Ably key valid"
        $summary["Ably"] = "valid"
    } catch { Write-Fail "Ably key rejected or Ably unreachable: $($_.Exception.Message)"; $summary["Ably"] = "INVALID / unreachable" }
} else {
    Write-Warn2 "ABLY_API_KEY not set: realtime streaming disabled; the UI falls back to HTTP polling."
    Write-Host "           Create an app at https://ably.com/accounts and copy its API key into .env"
    $summary["Ably"] = "not configured (polling)"
}

# 18. TTS initialisation -----------------------------------------------------------------------
Write-Step "Verifying Supertonic TTS initialisation"
Push-Location $Backend
try {
    & $VenvPy -c "from app.services.registry import tts_service as t; w,_=t.synthesize_wav('Setup check complete.','F1'); print(len(w))" 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Ok "TTS synthesized audio"; $summary["TTS"] = "working" } else { Write-Warn2 "TTS failed to initialise"; $summary["TTS"] = "unavailable" }
} finally { Pop-Location }

# 16-17. Backend health ------------------------------------------------------------------------
if ($dbOk) {
    Write-Step "Testing backend health and database connectivity"
    New-Item -ItemType Directory -Force $LogDir | Out-Null
    $p = Start-Process -FilePath $VenvPy -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8765" `
        -WorkingDirectory $Backend -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "setup-backend.log") -RedirectStandardError (Join-Path $LogDir "setup-backend.err.log")
    try {
        if (Wait-Http "http://127.0.0.1:8765/api/v1/health" 60) {
            $h = Invoke-RestMethod "http://127.0.0.1:8765/api/v1/health"
            Write-Ok "Backend status: $($h.status); database ok: $($h.database.ok); transcription: $($h.features.transcription)"
            $summary["Backend"] = "healthy"
        } else { Write-Fail "Backend did not respond (see logs\setup-backend.err.log)"; $summary["Backend"] = "FAILED" }
    } finally { Stop-ProcessTree $p.Id }
}

# 19. Frontend build ---------------------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Step "Verifying the frontend production build"
    Push-Location $Web
    try {
        npm run build
        if ($LASTEXITCODE -eq 0) { Write-Ok "Frontend build succeeded"; $summary["Frontend build"] = "ok" } else { Write-Fail "Frontend build failed"; $summary["Frontend build"] = "FAILED" }
    } finally { Pop-Location }
}

# 20. Summary ----------------------------------------------------------------------------------
Write-Step "Setup summary"
foreach ($k in $summary.Keys) { "    {0,-16} {1}" -f $k, $summary[$k] | Write-Host }
Write-Host ""
Write-Host "Next: powershell -ExecutionPolicy Bypass -File scripts\start.ps1   then open http://localhost:3000" -ForegroundColor Cyan
Write-Host "The first account you register becomes the administrator."
