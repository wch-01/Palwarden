$ErrorActionPreference = 'Stop'

$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*palwarden-launcher.js*' -or $_.CommandLine -like '*apps\api\dist\main.js*' -or $_.CommandLine -like '*\api\dist\main.js*' }

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
}

Write-Host "Stopped $($processes.Count) Palwarden process(es)."
