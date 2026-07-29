param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Palwarden",
  [switch]$StartAfterInstall = $true
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = [System.IO.Path]::GetFullPath($InstallDir)

if ($source -ne $installDir) {
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  robocopy $source $installDir /MIR | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "Could not copy Palwarden files. Robocopy exited with code $LASTEXITCODE."
  }
}

$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktop 'Palwarden.lnk'
$target = Join-Path $installDir 'Start-Palwarden.ps1'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$target`""
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = 'powershell.exe'
$shortcut.Save()

Write-Host "Palwarden installed to $installDir"
Write-Host "A desktop shortcut was created at $shortcutPath"

if ($StartAfterInstall) {
  Write-Host "Starting Palwarden. The browser will open when the app is ready."
  & (Join-Path $installDir 'Start-Palwarden.ps1')
}
