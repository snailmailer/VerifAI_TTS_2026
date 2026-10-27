$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot) 'deployment\browser-inventory.ps1')
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('verifai-inventory-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $temporary 'Default') -Force | Out-Null
try {
  $id = 'a' * 32
  $settings = @{}
  $settings[$id] = @{ state = 1; manifest = @{ name = 'VerifAI Approval Gate'; version = '0.3.0' } }
  @{ extensions = @{ settings = $settings } } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $temporary 'Default\Preferences') -Encoding ascii
  $result = @(Get-VerifAIBrowserInventory Chrome $temporary)
  if ($result.Count -ne 1 -or !$result[0].Enabled -or $result[0].Id -ne $id) { throw 'Enabled Chromium inventory failed.' }
  $settings[$id].state = 0
  @{ extensions = @{ settings = $settings } } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $temporary 'Default\Preferences') -Encoding ascii
  $result = @(Get-VerifAIBrowserInventory Edge $temporary)
  if ($result[0].Enabled) { throw 'Disabled Chromium extension misreported as enabled.' }
  New-Item -ItemType Directory -Path (Join-Path $temporary 'Profile 1') | Out-Null
  '{}' | Set-Content -LiteralPath (Join-Path $temporary 'Profile 1\Preferences') -Encoding ascii
  $result = @(Get-VerifAIBrowserInventory Brave $temporary)
  if ($result.Count -ne 2 -or @($result | Where-Object { !$_.Id }).Count -ne 1) { throw 'Missing extension profile was not reported.' }
  $settings[$id].state = 1
  @{ extensions = @{ settings = $settings } } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $temporary 'Default\Secure Preferences') -Encoding ascii
  $result = @(Get-VerifAIBrowserInventory Chrome $temporary | Where-Object { $_.Id })
  if (!$result[0].Enabled) { throw 'Secure Preferences not inspected.' }
  New-Item -ItemType Directory -Path (Join-Path $temporary 'Extension') | Out-Null
  @{ name = 'VerifAI Approval Gate'; version = '0.4.0' } | ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $temporary 'Extension\manifest.json') -Encoding ascii
  $settings[$id] = @{ path = (Join-Path $temporary 'Extension'); state = 1 }
  @{ extensions = @{ settings = $settings } } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $temporary 'Default\Secure Preferences') -Encoding ascii
  $result = @(Get-VerifAIBrowserInventory Brave $temporary | Where-Object { $_.Id })
  if ($result[0].Version -ne '0.3.0') { throw 'Preferences manifest metadata was not preserved when merging Secure Preferences.' }
  '{}' | Set-Content -LiteralPath (Join-Path $temporary 'Default\Preferences') -Encoding ascii
  $result = @(Get-VerifAIBrowserInventory Brave $temporary | Where-Object { $_.Id })
  if ($result[0].Version -ne '0.4.0' -or !$result[0].Enabled) { throw 'Unpacked manifest path fallback failed.' }
  @{ addons = @(@{ id = 'verifai-approval-gate@example.com'; active = $true; userDisabled = $false; version = '0.3.0' }) } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $temporary 'Default\extensions.json') -Encoding ascii
  $result = @(Get-VerifAIBrowserInventory Firefox $temporary)
  if ($result.Count -ne 1 -or !$result[0].Enabled) { throw 'Firefox inventory failed.' }
  Write-Output 'PASS: enabled/disabled Chromium, missing profiles, Secure Preferences, and Firefox profile inventory.'
} finally {
  Remove-Item -LiteralPath $temporary -Recurse -Force
}
