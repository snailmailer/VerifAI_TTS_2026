$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$root = Split-Path $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser-inventory.ps1')

function Show-Notice([string]$message) {
  [System.Windows.Forms.MessageBox]::Show($message, 'VerifAI Setup', 'OK', 'Information') | Out-Null
}
function Confirm-Step([string]$message) {
  return [System.Windows.Forms.MessageBox]::Show($message, 'VerifAI Setup', 'OKCancel', 'Information') -eq 'OK'
}
function Read-ExtensionId([string]$browser, [string]$knownId) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = "VerifAI - $browser extension ID"
  $form.Size = New-Object System.Drawing.Size(560, 230)
  $form.StartPosition = 'CenterScreen'
  $label = New-Object System.Windows.Forms.Label
  $label.Text = "After loading VerifAI, copy ONLY its ID from the browser extension card.`r`n32 lowercase letters a-p. Cancel skips connection for this browser."
  $label.SetBounds(15, 15, 515, 55)
  $idBox = New-Object System.Windows.Forms.TextBox
  $idBox.Text = $knownId
  $idBox.SetBounds(15, 80, 510, 25)
  $next = New-Object System.Windows.Forms.Button
  $next.Text = 'Next'
  $next.SetBounds(335, 130, 90, 30)
  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Skip'
  $cancel.DialogResult = 'Cancel'
  $cancel.SetBounds(435, 130, 90, 30)
  $next.Add_Click({
    if ($idBox.Text.Trim() -cnotmatch '^[a-p]{32}$') {
      [System.Windows.Forms.MessageBox]::Show('Enter the actual VerifAI ID: exactly 32 lowercase letters a-p.') | Out-Null
    } else { $form.DialogResult = 'OK'; $form.Close() }
  })
  $form.Controls.AddRange(@($label, $idBox, $next, $cancel))
  $form.AcceptButton = $next
  $form.CancelButton = $cancel
  try {
    if ($form.ShowDialog() -eq 'OK') { return $idBox.Text.Trim() }
    return $null
  } finally { $form.Dispose() }
}

try {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (!$node) {
    if (Confirm-Step 'Node.js 22+ is required. Click OK to open the official Node.js download page. Install it, then run VerifAI Setup again. No Node.js installer will run automatically.') {
      Start-Process 'https://nodejs.org/en/download'
    }
    exit 1
  }
  $version = & $node.Source --version
  if ($LASTEXITCODE -ne 0 -or [int]($version.TrimStart('v').Split('.')[0]) -lt 22) {
    throw 'Install Node.js 22 or newer, then rerun setup.'
  }
  $ids = @()
  $summary = @()
  $candidates = @{
    Chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
    Edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
    Brave = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe")
    Firefox = @("$env:ProgramFiles\Mozilla Firefox\firefox.exe", "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe")
  }
  $profileRoots = @{
    Chrome = "$env:LOCALAPPDATA\Google\Chrome\User Data"
    Edge = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
    Brave = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"
    Firefox = "$env:APPDATA\Mozilla\Firefox\Profiles"
  }
  $wantedVersion = (Get-Content (Join-Path $root 'extension-chromium\manifest.json') -Raw | ConvertFrom-Json).version
  $stableRoot = Join-Path $env:LOCALAPPDATA 'VerifAI\Extensions'
  foreach ($kind in @('chromium', 'firefox')) {
    $source = Join-Path $root "extension-$kind"
    $target = Join-Path $stableRoot $kind
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    # Publish the manifest last so update checks cannot see a version before its scripts are copied.
    foreach ($file in @(Get-ChildItem -LiteralPath $source -File | Sort-Object { $_.Name -eq 'manifest.json' })) {
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $target $file.Name) -Force
    }
  }
  $updateTargets = @()
  foreach ($browser in @('Chrome', 'Edge', 'Brave', 'Firefox')) {
    $executable = @($candidates[$browser] | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
    if (!$executable.Count) {
      $summary += "${browser}: not detected in standard locations; skipped."
      continue
    }
    $inventory = @(Get-VerifAIBrowserInventory -Browser $browser -UserDataRoot $profileRoots[$browser])
    foreach ($record in $inventory) {
      if ($record.Id) {
        $summary += "${browser}/$($record.Profile): installed version $($record.Version), enabled preference: $($record.Enabled) (not live verification)."
        if ($browser -ne 'Firefox') { $ids += $record.Id }
        if ($record.Path -and $record.Path.TrimEnd('\') -eq (Join-Path $stableRoot 'chromium')) {
          $updateTargets += @{ caller = "chrome-extension://$($record.Id)/"; manifestPath = (Join-Path $stableRoot 'chromium\manifest.json') }
        }
      } else {
        $summary += "${browser}/$($record.Profile): no verified VerifAI installation found; browser approval needed."
      }
    }
    $existing = @($inventory | Where-Object { $_.Enabled -and $_.Version -eq $wantedVersion })
    $uncovered = @($inventory | Where-Object {
      $profileName = $_.Profile
      !@($existing | Where-Object { $_.Profile -eq $profileName }).Count
    })
    if ($existing.Count -gt 0 -and $uncovered.Count -eq 0) {
      $summary += "${browser}: reusing current extension in $($existing.Count) profile(s); other profiles need separate coverage checks."
      continue
    }
    if ($uncovered.Count -gt 0) {
      Show-Notice ("${browser}: these profiles still need installation, enablement or an update: " +
        (($uncovered.Profile | Select-Object -Unique) -join ', ') +
        ". Switch to each affected profile in the browser. Do not add a duplicate in profiles that already have VerifAI.")
    }
    if ($browser -eq 'Firefox') {
      $manifest = Join-Path $stableRoot 'firefox\manifest.json'
      if (Confirm-Step "Firefox: click OK to open about:debugging.`r`nChoose This Firefox > Load Temporary Add-on, then select:`r`n$manifest`r`n`r`nThis development add-on must be reloaded after Firefox restarts. The manifest path will be copied to your clipboard.") {
        [System.Windows.Forms.Clipboard]::SetText($manifest)
        Start-Process -FilePath $executable[0] -ArgumentList 'about:debugging#/runtime/this-firefox'
        if (Confirm-Step 'Complete the Firefox add-on installation in the browser, then click OK here. Cancel records it as skipped. This temporary add-on cannot be re-added silently after Firefox closes. A signed Firefox release is needed for persistent installation. Setup cannot verify this browser approval automatically.') {
          $summary += 'Firefox: user-confirmed temporary add-on installation (not independently verified).'
        } else { $summary += 'Firefox: extension step skipped.' }
      } else { $summary += 'Firefox: skipped.' }
      continue
    }
    $uri = @{ Chrome = 'chrome://extensions'; Edge = 'edge://extensions'; Brave = 'brave://extensions' }[$browser]
    $folder = Join-Path $stableRoot 'chromium'
    if (!(Confirm-Step "${browser}: click OK to open its extensions page.`r`nIf VerifAI already exists, enable or update it instead of adding a duplicate. Otherwise enable Developer mode > Load unpacked > select:`r`n$folder`r`n`r`nThe folder path will be copied to your clipboard. Approve only the VerifAI extension.")) {
      $summary += "${browser}: skipped."
      continue
    }
    [System.Windows.Forms.Clipboard]::SetText($folder)
    Start-Process -FilePath $executable[0] -ArgumentList $uri
    $id = $null
    if (Confirm-Step "Finish loading/enabling VerifAI version $wantedVersion in every affected ${browser} profile, then click OK. Setup will try to detect its ID automatically. If updating from an old package folder, use the stable folder shown above; do not leave duplicate VerifAI copies enabled.") {
      $after = @(Get-VerifAIBrowserInventory -Browser $browser -UserDataRoot $profileRoots[$browser])
      foreach ($record in @($after | Where-Object { $_.Id })) {
        $ids += $record.Id
        if ($record.Path -and $record.Path.TrimEnd('\') -eq $folder) {
          $updateTargets += @{ caller = "chrome-extension://$($record.Id)/"; manifestPath = (Join-Path $folder 'manifest.json') }
        }
      }
      $current = @($after | Where-Object { $_.Id -and $_.Enabled -and $_.Version -eq $wantedVersion })
      if ($current.Count -gt 0) {
        $summary += "${browser}: current enabled preference records detected in $($current.Count) profile(s); live enforcement still needs testing."
        continue
      }
      $knownIds = @($after | Where-Object { $_.Id } | Select-Object -ExpandProperty Id -Unique)
      $known = if ($knownIds.Count -eq 1) { $knownIds[0] } else { '' }
      $id = Read-ExtensionId $browser $known
    }
    if ($id) {
      $ids += $id
      $summary += "${browser}: ID supplied for native connection (browser installation not independently verified)."
    } else { $summary += "${browser}: native connection skipped." }
  }
  Write-Output 'Browser guidance complete. Applying the collector, native bridge and startup configuration approved on the first screen.'
  & (Join-Path $root 'install-windows.ps1') -ChromiumExtensionIds @($ids | Select-Object -Unique) -UpgradeInstalledCollector
  if (!$?) { throw 'Collector installation failed.' }
  ConvertTo-Json -InputObject @($updateTargets) -Depth 4 |
    Set-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'VerifAI\App\extension-update-targets.json') -Encoding ascii
  $tokenPath = Join-Path $env:LOCALAPPDATA 'VerifAI\local-service-token'
  $credential = [System.IO.File]::ReadAllText($tokenPath).Trim()
  $session = Invoke-RestMethod -Uri 'http://127.0.0.1:43821/api/session' -Method Post -ContentType 'text/plain' -Body (@{ token = $credential } | ConvertTo-Json) -TimeoutSec 5
  $credential = $null
  $dashboardUri = [uri]$session.dashboardUrl
  if ($dashboardUri.Scheme -ne 'http' -or $dashboardUri.Host -ne '127.0.0.1' -or $dashboardUri.Port -ne 43821) {
    throw 'Collector returned an unexpected dashboard location.'
  }
  Start-Process $session.dashboardUrl
  Show-Notice ("Collector health check passed and the authenticated dashboard was opened. Automatic connection is configured for detected/supplied IDs and the Firefox build ID.`r`n`r`nRefresh AI tabs. Extensions must be enabled and site access granted in each browser profile. Preference checks and user confirmation are not a live monitoring test.`r`n`r`n" + ($summary -join "`r`n") + "`r`n`r`nSafari was not installed. Uninstall registration/startup using install-windows.ps1 -Uninstall; app data is retained.")
  exit 0
} catch {
  Write-Output ("SETUP ERROR: " + $_.Exception.Message)
  Write-Output ("LOCATION: " + $_.InvocationInfo.PositionMessage)
  Write-Output ("STACK: " + $_.ScriptStackTrace)
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'VerifAI setup failed', 'OK', 'Error') | Out-Null
  exit 1
}
