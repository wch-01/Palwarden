$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root 'node\node.exe'
$launcher = Join-Path $root 'launcher\palwarden-launcher.js'
$dataRoot = if ($env:PALWARDEN_DATA_DIR) { $env:PALWARDEN_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Palwarden\data' }
$configPath = Join-Path $dataRoot 'palwarden.env'
$logDir = Join-Path $dataRoot 'logs'
$stdoutLog = Join-Path $logDir 'palwarden-launcher.out.log'
$stderrLog = Join-Path $logDir 'palwarden-launcher.err.log'
$hostName = '127.0.0.1'
$port = '3333'

if (Test-Path $configPath) {
  Get-Content $configPath | ForEach-Object {
    if ($_ -match '^PALWARDEN_HOST="?([^"]+)"?$') { $script:hostName = $Matches[1] }
    if ($_ -match '^PALWARDEN_PORT="?([^"]+)"?$') { $script:port = $Matches[1] }
  }
}

$url = "http://$hostName`:$port"

if (!(Test-Path $node)) {
  $node = 'node.exe'
}

if (!(Test-Path $launcher)) {
  throw "Palwarden launcher was not found at $launcher."
}

$existing = @()
try {
  $existing = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*palwarden-launcher.js*' }
} catch {
  Write-Host "Could not inspect existing Palwarden processes. A new process will be started."
}

if (!$existing) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $process = Start-Process -FilePath $node -ArgumentList @($launcher) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  Write-Host "Starting Palwarden. Startup logs are written to $logDir"
}

for ($attempt = 1; $attempt -le 90; $attempt++) {
  try {
    $response = Invoke-WebRequest -Uri "$url/api/auth/state" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Start-Process $url
      exit 0
    }
  } catch {
    if ($process -and $process.HasExited) {
      Write-Host "Palwarden exited before it finished starting."
      if (Test-Path $stderrLog) {
        Write-Host ""
        Write-Host "Recent error log:"
        Get-Content $stderrLog -Tail 40
      }
      throw "Palwarden failed to start. Check $stderrLog"
    }
    Start-Sleep -Seconds 1
  }
}

Write-Host "Palwarden did not respond at $url within 90 seconds."
if (Test-Path $stderrLog) {
  Write-Host ""
  Write-Host "Recent error log:"
  Get-Content $stderrLog -Tail 40
}
throw "Palwarden did not become ready. Check $logDir"
