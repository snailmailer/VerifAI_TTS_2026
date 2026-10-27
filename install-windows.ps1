param(
  [string[]]$ChromiumExtensionIds = @(),
  [switch]$UpgradeInstalledCollector,
  [string]$ActivityDataDirectory,
  [string]$EventLogsDirectory,
  [string]$NodePath,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$name = 'com.verifai.bridge'
$destination = Join-Path $env:LOCALAPPDATA 'VerifAI\App'
$registryRoots = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
  'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts',
  'HKCU:\Software\Mozilla\NativeMessagingHosts'
)
$startupDir = [Environment]::GetFolderPath('Startup')
if ([string]::IsNullOrEmpty($startupDir)) {
  # GetFolderPath returns "" when the folder is absent or redirected; rebuild it from APPDATA.
  $startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
}
$startup = Join-Path $startupDir 'VerifAI.lnk'
if ($Uninstall) {
  foreach ($root in $registryRoots) {
    $key = Join-Path $root $name
    if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key }
  }
  if (Test-Path -LiteralPath $startup) { Remove-Item -LiteralPath $startup }
  Write-Output 'Automatic startup and native-host registration removed. Data and running collector are retained.'
  exit
}
foreach ($id in $ChromiumExtensionIds) {
  if ($id -cnotmatch '^[a-p]{32}$') { throw "Invalid Chromium extension ID: $id" }
}
if ($NodePath) {
  if (!(Test-Path -LiteralPath $NodePath -PathType Leaf) -or (Split-Path $NodePath -Leaf) -ne 'node.exe') {
    throw "NodePath must point to an existing node.exe: $NodePath"
  }
  $node = (Resolve-Path -LiteralPath $NodePath).Path
} else {
  $node = (Get-Command node -ErrorAction Stop).Source
}
$nodeVersion = (& $node --version 2>$null)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
  throw "Node.js 22 or newer is required at $node (found '$nodeVersion')."
}
$listener = Get-NetTCPConnection -LocalPort 43821 -State Listen -ErrorAction SilentlyContinue
$files = @('local-service.js', 'native-host.js', 'activity-storage.js', 'event-logs.js', 'ai-policy.js', 'redaction-metadata.js', 'redaction-dashboard.js', 'package.json', 'dashboard.html', 'dashboard.js', 'dashboard.css', 'VerifAI Logo.png')
$reuseCollector = $false
function Get-SetupHash([string]$File) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($File)
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)) }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
if ($listener) {
  $ownerIds = @($listener.OwningProcess | Select-Object -Unique)
  if ($ownerIds.Count -ne 1) { throw 'Port 43821 is occupied; no process was stopped.' }
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($ownerIds[0])"
  $expectedScript = Join-Path $destination 'local-service.js'
  # The collector may have been started by a different Node binary (system install vs
  # bundled runtime); identity is the node.exe image plus the exact installed script path.
  if (!$owner.ExecutablePath -or (Split-Path $owner.ExecutablePath -Leaf) -ne 'node.exe' -or !$owner.CommandLine -or
      $owner.CommandLine.IndexOf($expectedScript, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'Port 43821 belongs to a different or unverified process. Stop the known collector explicitly and rerun setup.'
  }
  $filesMatch = $true
  if ($ActivityDataDirectory -or $EventLogsDirectory) { $filesMatch = $false }
  $runtimeFile = Join-Path $destination 'runtime.json'
  if (Test-Path -LiteralPath $runtimeFile) {
    $recordedNode = (Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json).node
    if ($recordedNode -and $recordedNode -ne $node) { $filesMatch = $false }
  }
  foreach ($file in $files) {
    $installedFile = Join-Path $destination $file
    if (!(Test-Path -LiteralPath $installedFile) -or
        (Get-SetupHash $installedFile) -ne (Get-SetupHash (Join-Path $PSScriptRoot $file))) {
      $filesMatch = $false
    }
  }
  if ($filesMatch) {
    $reuseCollector = $true
    Write-Output 'Reusing the matching installed collector; no duplicate process will be started.'
  } elseif ($UpgradeInstalledCollector) {
    $expectedCommand = '^\s*"?'+ [regex]::Escape($owner.ExecutablePath) + '"?\s+"' + [regex]::Escape($expectedScript) + '"\s*$'
    if ($owner.CommandLine -notmatch $expectedCommand) {
      throw 'Running command does not exactly match the installed VerifAI collector. It was not stopped.'
    }
    $ownerAccount = Invoke-CimMethod -InputObject $owner -MethodName GetOwner
    $currentAccount = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ("$($ownerAccount.Domain)\$($ownerAccount.User)" -ne $currentAccount) {
      throw 'The collector belongs to a different Windows account. It was not stopped.'
    }
    Stop-Process -Id $ownerIds[0] -ErrorAction Stop
    Wait-Process -Id $ownerIds[0] -ErrorAction SilentlyContinue
    Write-Output 'Stopped only the verified installed collector for the approved upgrade; event data is retained.'
  } else {
    throw 'A different VerifAI version is running. Use -UpgradeInstalledCollector to authorize restarting only the verified installed collector.'
  }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
if (!$reuseCollector) {
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $destination -Force }
}
@{ node = $node; version = $nodeVersion; installedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Compress |
  Set-Content -LiteralPath (Join-Path $destination 'runtime.json') -Encoding ascii
# Restrict the executable host and credentials to the current Windows account and SYSTEM.
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls (Split-Path $destination) /inheritance:r /grant:r "${account}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict VerifAI directory permissions.' }
$launcher = Join-Path $destination 'native-host.cmd'
Set-Content -LiteralPath $launcher -Encoding ascii -Value "@echo off`r`n`"$node`" `"%~dp0native-host.js`" %*"
# Node serializes plain string arrays consistently across Windows PowerShell versions.
& $node (Join-Path $PSScriptRoot 'native-config.js') $destination @ChromiumExtensionIds
if ($LASTEXITCODE -ne 0) { throw 'Native-host configuration validation failed.' }
$chromiumManifest = Join-Path $destination 'native-chromium.json'
$hasChromium = Test-Path -LiteralPath $chromiumManifest
foreach ($root in $registryRoots) {
  $firefox = $root -like '*Mozilla*'
  if (!$firefox -and !$hasChromium) { continue }
  $filename = if ($firefox) { 'native-firefox.json' } else { 'native-chromium.json' }
  $manifestPath = Join-Path $destination $filename
  $key = Join-Path $root $name
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $manifestPath
}
$shell = New-Object -ComObject WScript.Shell
New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
$shortcut = $shell.CreateShortcut($startup)
$shortcut.TargetPath = $node
$shortcut.Arguments = '"' + (Join-Path $destination 'local-service.js') + '"'
$shortcut.WorkingDirectory = $destination
$shortcut.WindowStyle = 7
$shortcut.Save()
$logs = Join-Path (Split-Path $destination) 'Logs'
if ($ActivityDataDirectory) {
  New-Item -ItemType Directory -Path $ActivityDataDirectory -Force | Out-Null
  & icacls $ActivityDataDirectory /inheritance:r /grant:r "${account}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict activity data directory permissions.' }
  & $node (Join-Path $destination 'activity-storage.js') (Split-Path $destination) $ActivityDataDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Could not migrate activity storage; collector was not started.' }
}
if ($EventLogsDirectory) {
  New-Item -ItemType Directory -Path $EventLogsDirectory -Force | Out-Null
  & icacls $EventLogsDirectory /inheritance:r /grant:r "${account}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict event log directory permissions.' }
  & $node (Join-Path $destination 'activity-storage.js') --logs (Split-Path $destination) $EventLogsDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Could not configure event log storage; collector was not started.' }
}
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$runId = [guid]::NewGuid().ToString('N')
if (!$reuseCollector) {
  # Launch through ShellExecute (no -Redirect*/-NoNewWindow) so the hidden collector does not inherit
  # the caller's stdout pipe; cmd performs the log redirection itself.
  $collectorCommand = '""' + $node + '" "' + (Join-Path $destination 'local-service.js') + '" > "' +
    (Join-Path $logs "collector-$runId.log") + '" 2> "' + (Join-Path $logs "collector-$runId-error.log") + '""'
  Start-Process -FilePath "$env:ComSpec" -ArgumentList ('/d /c ' + $collectorCommand) -WorkingDirectory $destination -WindowStyle Hidden
}
$healthy = $false
for ($attempt = 0; $attempt -lt 10; $attempt++) {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:43821/api/health' -TimeoutSec 2
    if ($response.ok) { $healthy = $true; break }
  } catch {
    if ($attempt -eq 9) { throw "Collector did not become healthy: $($_.Exception.Message)" }
  }
  Start-Sleep -Milliseconds 500
}
if (!$healthy) { throw 'Collector did not pass its health check.' }
Write-Output 'Installed per-user startup and native bridge. Reload extensions. No service token entry is required.'
if (!$hasChromium) {
  Write-Warning 'Only Firefox was registered. Re-run with -ChromiumExtensionIds to register Chrome/Edge/Brave IDs.'
}
