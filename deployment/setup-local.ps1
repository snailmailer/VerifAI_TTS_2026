$ErrorActionPreference = 'Stop'
try {
  $node = Get-Command node -ErrorAction Stop
  $version = & $node.Source --version
  if ($LASTEXITCODE -ne 0 -or [int]($version.TrimStart('v').Split('.')[0]) -lt 22) {
    throw 'Node.js 22 or newer is required. Install an approved Node.js release, then rerun setup.'
  }
  $installer = Join-Path (Split-Path $PSScriptRoot) 'install-windows.ps1'
  & $installer
  if (!$?) { throw 'Local component installation failed.' }
} catch {
  Write-Output ("SETUP ERROR: " + $_.Exception.Message)
  Write-Output ("LOCATION: " + $_.InvocationInfo.PositionMessage)
  Write-Output ("STACK: " + $_.ScriptStackTrace)
  exit 1
}
exit 0
