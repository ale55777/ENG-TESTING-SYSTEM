# Shared helpers for setup.ps1 / start.ps1 / stop.ps1 (Windows PowerShell 5.1 compatible).
# "Continue": Windows PowerShell 5.1 turns redirected native stderr into errors under "Stop".
# Failures are detected explicitly via $LASTEXITCODE and try/catch around cmdlets.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Web = Join-Path $Root "apps\web"
$Compose = Join-Path $Root "infrastructure\docker-compose.yml"
$EnvFile = Join-Path $Root ".env"
$RunDir = Join-Path $Root ".run"
$LogDir = Join-Path $Root "logs"
$VenvPy = Join-Path $Backend ".venv\Scripts\python.exe"

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    [ok]   $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    [warn] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    [fail] $msg" -ForegroundColor Red }

function Read-DotEnv {
    $vars = @{}
    if (Test-Path $EnvFile) {
        foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
            $l = $line.Trim().TrimStart([char]0xFEFF)
            if ($l -eq "" -or $l.StartsWith("#")) { continue }
            $i = $l.IndexOf("=")
            if ($i -lt 1) { continue }
            $vars[$l.Substring(0, $i).Trim()] = $l.Substring($i + 1).Trim()
        }
    }
    return $vars
}

function Set-DotEnvValue($key, $value) {
    $lines = @()
    if (Test-Path $EnvFile) { $lines = Get-Content $EnvFile -Encoding UTF8 }
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($key))\s*=") { $found = $true; "$key=$value" } else { $line }
    }
    if (-not $found) { $out = @($out) + "$key=$value" }
    # UTF-8 without BOM so Docker Compose and Python read it cleanly.
    [System.IO.File]::WriteAllLines($EnvFile, [string[]]$out, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-Py($spec, [string[]]$arguments) {
    # $spec is e.g. "py -3.12" or "python"
    $parts = $spec.Split(" ")
    $rest = @()
    if ($parts.Length -gt 1) { $rest = $parts[1..($parts.Length - 1)] }
    & $parts[0] @rest @arguments
}

function Test-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Confirm-Action($question, [switch]$AssumeYes) {
    if ($AssumeYes) { return $true }
    $a = Read-Host "$question [y/N]"
    return $a -match "^(y|yes)$"
}

function Wait-Http($url, $seconds = 60) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($r.StatusCode -lt 500) { return $true }
        } catch { Start-Sleep -Milliseconds 800 }
    }
    return $false
}

function Wait-Postgres($seconds = 90) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $state = (docker inspect -f "{{.State.Health.Status}}" elp-postgres 2>$null)
        if ($state -eq "healthy") { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Stop-ProcessTree($procId) {
    if (-not $procId) { return }
    try { & taskkill.exe /PID $procId /T /F 2>$null | Out-Null } catch { }
}
