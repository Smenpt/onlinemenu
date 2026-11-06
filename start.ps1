$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command fnm -ErrorAction SilentlyContinue)) {
        throw 'Node.js was not found. Install it from https://nodejs.org and run this script again.'
    }
    fnm env --shell powershell | Out-String | Invoke-Expression
    fnm use --install-if-missing
}

$port = 3000
if ($env:PORT) {
    $port = [int]$env:PORT
} elseif (Test-Path -LiteralPath '.env') {
    $match = Select-String -LiteralPath '.env' -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($match) { $port = [int]$match.Matches[0].Groups[1].Value }
}

# Stop only the server on our port, never other Node.js programs.
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($processId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'node') {
        Stop-Process -Id $processId -Force
        Start-Sleep -Milliseconds 300
    } elseif ($process) {
        throw "Port $port is used by $($process.ProcessName). Close it or set PORT in .env."
    }
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
    npm install --omit=dev --no-fund --no-audit
}

node server.js
