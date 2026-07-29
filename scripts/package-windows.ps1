param(
  [string]$NodeVersion = '24.11.1',
  [string]$OutputRoot = 'dist\windows'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$outputRootPath = Join-Path $repo $OutputRoot
$staging = Join-Path $outputRootPath 'Palwarden'
$cache = Join-Path $outputRootPath 'cache'
$nodeZip = Join-Path $cache "node-v$NodeVersion-win-x64.zip"
$nodeExtract = Join-Path $cache "node-v$NodeVersion-win-x64"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"

function Invoke-Native {
  & $args[0] $args[1..($args.Count - 1)]
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $($args -join ' ')"
  }
}

Push-Location $repo
try {
  Invoke-Native pnpm.cmd install --frozen-lockfile --config.confirmModulesPurge=false
  Invoke-Native pnpm.cmd build

  if (Test-Path $staging) {
    Remove-Item $staging -Recurse -Force
  }
  New-Item -ItemType Directory -Path $staging, $cache -Force | Out-Null

  if (!(Test-Path $nodeZip)) {
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
  }
  if (!(Test-Path $nodeExtract)) {
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $cache -Force
  }

  Copy-Item $nodeExtract (Join-Path $staging 'node') -Recurse

  $apiStage = Join-Path $staging 'api'
  Invoke-Native pnpm.cmd --filter @palwarden/api deploy --prod --legacy --config.node-linker=hoisted $apiStage
  Copy-Item (Join-Path $repo 'apps\api\dist') (Join-Path $apiStage 'dist') -Recurse -Force
  Copy-Item (Join-Path $repo 'apps\api\prisma') (Join-Path $apiStage 'prisma') -Recurse -Force
  Remove-Item (Join-Path $apiStage 'prisma\palwarden.db*') -Force -ErrorAction SilentlyContinue
  Push-Location $apiStage
  try {
    Invoke-Native node node_modules\prisma\build\index.js generate --schema prisma\schema.prisma
  } finally {
    Pop-Location
  }

  Copy-Item (Join-Path $repo 'apps\web\dist\browser') (Join-Path $staging 'web') -Recurse
  New-Item -ItemType Directory -Path (Join-Path $staging 'launcher') | Out-Null
  Copy-Item (Join-Path $repo 'packaging\windows\runtime\palwarden-launcher.js') (Join-Path $staging 'launcher\palwarden-launcher.js')
  Copy-Item (Join-Path $repo 'packaging\windows\Install-Palwarden.cmd') (Join-Path $staging 'Install-Palwarden.cmd')
  Copy-Item (Join-Path $repo 'packaging\windows\Install-Palwarden.ps1') (Join-Path $staging 'Install-Palwarden.ps1')
  Copy-Item (Join-Path $repo 'packaging\windows\Start-Palwarden.ps1') (Join-Path $staging 'Start-Palwarden.ps1')
  Copy-Item (Join-Path $repo 'packaging\windows\Stop-Palwarden.ps1') (Join-Path $staging 'Stop-Palwarden.ps1')
  Copy-Item (Join-Path $repo 'README.md') (Join-Path $staging 'README.txt')

  $archive = Join-Path $outputRootPath 'Palwarden-windows-x64.zip'
  if (Test-Path $archive) {
    Remove-Item $archive -Force
  }
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archive -Force
  Write-Host "Windows package created: $archive"
} finally {
  Pop-Location
}
