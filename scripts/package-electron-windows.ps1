param(
  [string]$NodeVersion = '24.11.1'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')

function Invoke-Native {
  & $args[0] $args[1..($args.Count - 1)]
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $($args -join ' ')"
  }
}

Push-Location $repo
try {
  Invoke-Native powershell -ExecutionPolicy Bypass -File scripts\package-windows.ps1 -NodeVersion $NodeVersion
  Invoke-Native pnpm.cmd --filter @palwarden/desktop build
  Invoke-Native pnpm.cmd --filter @palwarden/desktop dist:win
} finally {
  Pop-Location
}
