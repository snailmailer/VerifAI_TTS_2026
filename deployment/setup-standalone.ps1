param([string[]]$ChromiumExtensionIds = @())
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Write-Output 'VerifAI standalone setup: this installs the bridge and sign-in startup, without managed-browser policies.'
Write-Output 'Node.js must be installed. Install the extension from extension-chromium in Chrome, Edge and Brave.'
Write-Output 'Firefox development package: extension-firefox. Production Firefox requires a signed XPI.'
Write-Output 'Safari is not available on Windows; its macOS signed app is not included.'
if (!$ChromiumExtensionIds.Count) {
  $answer = Read-Host 'Paste only VerifAI Chromium IDs (comma-separated, 32 letters a-p), or Enter for Firefox only'
  if ($answer.Trim()) { $ChromiumExtensionIds = @($answer.Split(',') | ForEach-Object { $_.Trim() }) }
}
& (Join-Path $root 'install-windows.ps1') -ChromiumExtensionIds $ChromiumExtensionIds
if (!$?) { throw 'Standalone bridge installation failed.' }
Write-Output 'Refresh AI tabs and use the VerifAI toolbar button to open the authenticated dashboard.'
