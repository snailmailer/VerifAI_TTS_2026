function Get-VerifAIBrowserInventory {
  param([string]$Browser, [string]$UserDataRoot)
  $json = & node (Join-Path $PSScriptRoot 'browser-inventory.js') $Browser $UserDataRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not enumerate $Browser profiles." }
  $records = $json | ConvertFrom-Json
  foreach ($record in $records) {
    if ($record.Error) { Write-Warning $record.Error }
    $record
  }
}
