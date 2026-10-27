param(
  [string[]]$Browsers = @('Chrome', 'Edge', 'Brave'),
  [string]$PackageRoot,
  [int]$TimeoutSeconds = 120,
  [switch]$NonInteractive,
  [switch]$Undo
)
# Automatic, visible VerifAI extension installation for Chrome, Edge and Brave on any Windows PC.
#
# How: the signed VerifAI CRX (stable ID on every machine) is staged locally together with a
# local update.xml, and a per-user ExtensionInstallForcelist policy (HKCU - no admin rights) tells
# each browser to install it. This is the same mechanism IT departments use; the browser performs
# the install itself, the extension cannot be disabled by accident, and it updates when a newer
# CRX is staged. No browser profile files are edited. Everything is shown live and can be undone.
$ErrorActionPreference = 'Stop'
$policyRoots = @{
  Chrome = 'HKCU:\Software\Policies\Google\Chrome'
  Edge   = 'HKCU:\Software\Policies\Microsoft\Edge'
  Brave  = 'HKCU:\Software\Policies\BraveSoftware\Brave'
}
$executables = @{
  Chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  Edge   = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
  Brave  = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe")
}
$profileRoots = @{
  Chrome = "$env:LOCALAPPDATA\Google\Chrome\User Data"
  Edge   = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
  Brave  = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"
}
$pages = @{ Chrome = 'chrome://extensions'; Edge = 'edge://extensions'; Brave = 'brave://extensions' }

if (-not $PackageRoot) { $PackageRoot = Split-Path $PSScriptRoot -Parent }
$crxSource = @((Join-Path $PackageRoot 'release-assets\verifai-chromium.crx'), (Join-Path $PackageRoot 'extension-crx\verifai-chromium.crx')) |
  Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$idFile = @((Join-Path $PackageRoot 'release-assets\extension-ids.json'), (Join-Path $PackageRoot 'extension-crx\extension-ids.json')) |
  Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$stageRoot = Join-Path $env:LOCALAPPDATA 'VerifAI\Extensions\crx'
$stagedCrx = Join-Path $stageRoot 'verifai-chromium.crx'
$stagedUpdate = Join-Path $stageRoot 'update.xml'
$node = if (Test-Path (Join-Path $env:LOCALAPPDATA 'VerifAI\Runtime\node.exe')) { Join-Path $env:LOCALAPPDATA 'VerifAI\Runtime\node.exe' } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
$inventoryScript = Join-Path $PSScriptRoot 'browser-inventory.js'

function Get-ForceList([string]$Root) {
  if (-not (Test-Path (Join-Path $Root 'ExtensionInstallForcelist'))) { return @{} }
  $item = Get-ItemProperty -LiteralPath (Join-Path $Root 'ExtensionInstallForcelist')
  $map = @{}
  foreach ($property in $item.PSObject.Properties) { if ($property.Name -match '^\d+$') { $map[[int]$property.Name] = [string]$property.Value } }
  return $map
}
function Set-ForceListEntry([string]$Root, [string]$Value, [string]$Id) {
  $key = Join-Path $Root 'ExtensionInstallForcelist'
  New-Item -Path $key -Force | Out-Null
  $map = Get-ForceList $Root
  foreach ($index in @($map.Keys)) { if ($map[$index] -like "$Id;*") { Remove-ItemProperty -LiteralPath $key -Name $index } }
  $map = Get-ForceList $Root
  $next = 1; while ($map.ContainsKey($next)) { $next++ }
  New-ItemProperty -LiteralPath $key -Name $next -PropertyType String -Value $Value -Force | Out-Null
}
function Remove-ForceListEntry([string]$Root, [string]$Id) {
  $key = Join-Path $Root 'ExtensionInstallForcelist'
  if (-not (Test-Path $key)) { return }
  foreach ($index in @((Get-ForceList $Root).Keys)) {
    if ((Get-ForceList $Root)[$index] -like "$Id;*") { Remove-ItemProperty -LiteralPath $key -Name $index }
  }
  if (-not @((Get-ForceList $Root).Keys).Count) { Remove-Item -LiteralPath $key -Force }
  if ((Test-Path $Root) -and -not @(Get-ChildItem $Root).Count -and -not @((Get-ItemProperty $Root).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' }).Count) {
    Remove-Item -LiteralPath $Root -Force
  }
}
function Get-VerifAIEntries([string]$Browser) {
  if (-not $node -or -not (Test-Path $profileRoots[$Browser])) { return @() }
  $json = & $node $inventoryScript $Browser $profileRoots[$Browser]
  if ($LASTEXITCODE -ne 0) { return @() }
  return @((($json | ConvertFrom-Json) | ForEach-Object { $_ }) | Where-Object { $_.Id })
}
function Refresh-Policy([string]$Browser, [string]$Exe) {
  # A running browser re-reads policy within ~90 s on its own; opening the policy page triggers it now.
  $running = @(Get-CimInstance Win32_Process -Filter "Name = '$(Split-Path $Exe -Leaf)'" | Where-Object { $_.ExecutablePath -eq $Exe })
  $policyPage = $pages[$Browser] -replace 'extensions$', 'policy'
  Start-Process -FilePath $Exe -ArgumentList $policyPage | Out-Null
  return $running.Count -gt 0
}

# ---- cancellable progress window ----
$ui = $null
$script:cancelled = $false
$script:done = $false
if (-not $NonInteractive) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $ui = New-Object System.Windows.Forms.Form
    $ui.Text = 'VerifAI - installing the browser extension automatically'
    $ui.Size = New-Object System.Drawing.Size(680, 440); $ui.StartPosition = 'CenterScreen'; $ui.TopMost = $true
    $log = New-Object System.Windows.Forms.TextBox
    $log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'; $log.Font = New-Object System.Drawing.Font('Consolas', 9.5)
    $log.Location = New-Object System.Drawing.Point(12, 12); $log.Size = New-Object System.Drawing.Size(640, 300)
    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Location = New-Object System.Drawing.Point(12, 322); $bar.Size = New-Object System.Drawing.Size(500, 22); $bar.Maximum = 100
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel and undo'; $cancel.Location = New-Object System.Drawing.Point(524, 320); $cancel.Size = New-Object System.Drawing.Size(128, 26)
    $cancel.Add_Click({ $script:cancelled = $true; $cancel.Enabled = $false; $cancel.Text = 'Undoing...' })
    $note = New-Object System.Windows.Forms.Label
    $note.Text = 'The browser installs VerifAI itself from a signed package via a per-user policy (no admin rights). Nothing inside your browser profile is edited. "Cancel and undo" removes the policy; the browser then removes the extension.'
    $note.Location = New-Object System.Drawing.Point(12, 352); $note.Size = New-Object System.Drawing.Size(640, 44)
    $ui.Controls.AddRange(@($log, $bar, $cancel, $note))
    $ui.Add_FormClosing({ if (-not $script:done) { $script:cancelled = $true } })
    $ui.Show() | Out-Null
  } catch { $ui = $null }
}
function Log([string]$Text) {
  Write-Host $Text
  if ($ui) { $log.AppendText($Text + "`r`n"); [System.Windows.Forms.Application]::DoEvents() }
}
function Progress([int]$Value) { if ($ui) { $bar.Value = [Math]::Min(100, [Math]::Max(0, $Value)); [System.Windows.Forms.Application]::DoEvents() } }
function Check-Cancel { if ($ui) { [System.Windows.Forms.Application]::DoEvents() }; return $script:cancelled }

# Browsers only force-install an OFF-STORE (file://) extension on an enrolled machine:
#   Chrome: AD-domain-joined, Entra-joined or Chrome Enterprise Core;  Edge: AD-domain-joined.
# A STORE-published extension force-installs from HKCU on any machine. Detect which applies.
function Get-MachineEnrollment {
  $domain = $false; $entra = $false; $cbcm = $false
  try { $domain = (Get-CimInstance Win32_ComputerSystem).PartOfDomain } catch {}
  try { $entra = ((dsregcmd /status 2>$null) -join "`n") -match 'AzureAdJoined\s*:\s*YES' } catch {}
  foreach ($root in 'HKLM:\Software\Policies\Google\Chrome', 'HKLM:\Software\Policies\Google\Chrome\CloudManagementEnrollmentToken') {
    try { if ((Get-ItemProperty -LiteralPath $root -ErrorAction Stop).CloudManagementEnrollmentToken) { $cbcm = $true } } catch {}
  }
  return [pscustomobject]@{ Domain = $domain; Entra = $entra; ChromeEnterpriseCore = $cbcm; OffStoreAllowed = ($domain -or $entra -or $cbcm) }
}
$STORE_UPDATE = @{
  Chrome = 'https://clients2.google.com/service/update2/crx'
  Edge   = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx'
  Brave  = 'https://clients2.google.com/service/update2/crx'
}

$results = @()
$id = $null
try {
  if (-not $idFile) { throw "This package has no extension-ids.json (release-assets\). Use the guided Load-unpacked setup instead." }
  $ids = Get-Content -LiteralPath $idFile -Raw | ConvertFrom-Json
  $selfHostedId = if ($ids.chromium.selfHostedId) { $ids.chromium.selfHostedId } else { $ids.chromium.id }
  $version = $ids.version
  $installed = @($Browsers | Where-Object { @($executables[$_] | Where-Object { Test-Path -LiteralPath $_ }).Count })
  $enrollment = Get-MachineEnrollment
  # Per-browser plan: store ID (works everywhere) > self-hosted CRX (enrolled machines only) > none.
  $plan = @{}
  foreach ($browser in $installed) {
    $storeId = $ids.chromium.policyIds.($browser.ToLower())
    $isStore = $storeId -and $storeId -ne $selfHostedId -and ($ids.distribution.($browser.ToLower()) -eq 'store')
    if ($isStore) { $plan[$browser] = @{ Id = $storeId; Mode = 'store'; UpdateUrl = $STORE_UPDATE[$browser] } }
    elseif ($enrollment.OffStoreAllowed -and $crxSource) { $plan[$browser] = @{ Id = $selfHostedId; Mode = 'self-hosted'; UpdateUrl = $null } }
    else { $plan[$browser] = @{ Id = $selfHostedId; Mode = 'unavailable'; UpdateUrl = $null } }
  }

  if ($Undo) {
    foreach ($browser in $installed) {
      foreach ($candidate in @($selfHostedId, $ids.chromium.policyIds.($browser.ToLower())) | Where-Object { $_ -cmatch '^[a-p]{32}$' } | Select-Object -Unique) {
        Remove-ForceListEntry $policyRoots[$browser] $candidate
      }
      Log "$browser`: VerifAI auto-install policy removed. The browser removes the extension on its next policy refresh (open $($pages[$browser] -replace 'extensions$','policy') or restart it)."
      $results += [pscustomobject]@{ Browser = $browser; Id = $selfHostedId; Status = 'policy-removed' }
    }
    $script:done = $true
    return
  }

  Log "VerifAI $version"
  Log "Browsers detected: $(if ($installed.Count) { $installed -join ', ' } else { 'none' })"
  if (-not $installed.Count) { throw 'None of Chrome, Edge or Brave is installed in a standard location.' }
  Log ("This computer: " + $(if ($enrollment.Domain) { 'AD-domain joined' } elseif ($enrollment.Entra) { 'Entra (Azure AD) joined' } elseif ($enrollment.ChromeEnterpriseCore) { 'Chrome Enterprise Core enrolled' } else { 'not enrolled in a domain/MDM' }))
  Log ''
  foreach ($browser in $installed) {
    $p = $plan[$browser]
    switch ($p.Mode) {
      'store'       { Log "$browser`: will auto-install from the store (ID $($p.Id)) - works on any computer." }
      'self-hosted' { Log "$browser`: will auto-install the signed VerifAI package (ID $($p.Id)) - allowed because this computer is enrolled." }
      default       { Log "$browser`: AUTOMATIC INSTALL NOT POSSIBLE HERE. Browsers only auto-install a non-store extension on domain/MDM-enrolled computers, and VerifAI is not published to the store yet. Use the guided Load-unpacked setup for this browser." }
    }
  }
  $actionable = @($installed | Where-Object { $plan[$_].Mode -ne 'unavailable' })
  if (-not $actionable.Count) {
    Log ''
    Log 'Nothing was changed. To enable automatic installation on unmanaged computers, publish VerifAI to the Chrome Web Store / Edge Add-ons and put the store IDs in distribution.config.json (see PUBLISH-CHECKLIST.md).'
    $results += [pscustomobject]@{ Browser = '*'; Id = $selfHostedId; Status = 'not-possible-unmanaged' }
    $script:done = $true
    return
  }
  Log ''
  if (@($actionable | Where-Object { $plan[$_].Mode -eq 'self-hosted' }).Count) {
    Log 'Step 1/3  Staging the signed extension package locally...'
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    Copy-Item -LiteralPath $crxSource -Destination $stagedCrx -Force
    $codebase = 'file:///' + ($stagedCrx -replace '\\', '/')
    @"
<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="$selfHostedId">
    <updatecheck codebase="$codebase" version="$version" />
  </app>
</gupdate>
"@ | Set-Content -LiteralPath $stagedUpdate -Encoding utf8
    Log "          $stagedCrx"
  } else { Log 'Step 1/3  Store-hosted: nothing to stage.' }
  Progress 10
  if (Check-Cancel) { throw 'cancelled' }

  $localUpdateUrl = 'file:///' + ($stagedUpdate -replace '\\', '/')
  $step = 0
  foreach ($browser in $actionable) {
    $step++
    if (Check-Cancel) { throw 'cancelled' }
    $p = $plan[$browser]
    $id = $p.Id
    $updateUrl = if ($p.Mode -eq 'store') { $p.UpdateUrl } else { $localUpdateUrl }
    $exe = @($executables[$browser] | Where-Object { Test-Path -LiteralPath $_ })[0]
    $already = @(Get-VerifAIEntries $browser | Where-Object { $_.Id -eq $id -and $_.Version -eq $version })
    if ($already.Count) {
      Log "Step 2/3  $browser`: VerifAI $version already installed by policy (profile: $($already[0].Profile)). Nothing to do."
      $results += [pscustomobject]@{ Browser = $browser; Id = $id; Status = 'already-installed' }
      continue
    }
    Log "Step 2/3  $browser`: writing the per-user install policy (HKCU\...\ExtensionInstallForcelist, $($p.Mode))..."
    Set-ForceListEntry $policyRoots[$browser] "$id;$updateUrl" $id
    $wasRunning = Refresh-Policy $browser $exe
    Log ("          " + $(if ($wasRunning) { "$browser is running; asked it to re-read policy (policy page opened)." } else { "$browser started on its policy page." }))
    Log "Step 3/3  $browser`: waiting up to $TimeoutSeconds s for the browser to install VerifAI..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $found = $null
    $tick = 0
    while ((Get-Date) -lt $deadline) {
      if (Check-Cancel) { break }
      Start-Sleep -Seconds 3
      $tick += 3
      Progress ([int](10 + ($step - 1) / $actionable.Count * 90 + ($tick / $TimeoutSeconds) * (90 / $actionable.Count)))
      $entries = @(Get-VerifAIEntries $browser | Where-Object { $_.Id -eq $id })
      if ($entries.Count) { $found = $entries[0]; break }
      if ($tick % 15 -eq 0) { Log "          ... $browser has not reported it yet ($tick s). If it stays this way, close and reopen $browser." }
    }
    if ($found) {
      Log "          $browser`: VerifAI $($found.Version) installed (ID $id). Opening its Extensions page so you can see it."
      Start-Process -FilePath $exe -ArgumentList $pages[$browser] | Out-Null
      $results += [pscustomobject]@{ Browser = $browser; Id = $id; Status = 'installed' }
    } elseif ($script:cancelled) {
      break
    } else {
      Log "          $browser`: not confirmed within $TimeoutSeconds s. The policy stays in place: VerifAI installs the next time $browser starts. (Check $($pages[$browser] -replace 'extensions$','policy') for ExtensionInstallForcelist.)"
      $results += [pscustomobject]@{ Browser = $browser; Id = $id; Status = 'pending-restart' }
    }
  }
  if ($script:cancelled) { throw 'cancelled' }
  Progress 100
  Log ''
  Log 'Done. The extension is managed by policy: it shows "Installed by your administrator" and cannot be removed by mistake.'
  Log 'To uninstall later run this script with -Undo (or Uninstall-VerifAI.cmd).'
  $script:done = $true
} catch {
  if ($_.Exception.Message -eq 'cancelled') {
    Log ''
    Log 'Cancelled - undoing: removing the VerifAI install policy from every browser...'
    foreach ($browser in $installed) { try { Remove-ForceListEntry $policyRoots[$browser] $plan[$browser].Id } catch {} }
    Log 'Undone. Browsers remove the extension on their next policy refresh.'
    $results += [pscustomobject]@{ Browser = '*'; Id = $selfHostedId; Status = 'cancelled-undone' }
    $script:done = $true
  } else {
    Log "Error: $($_.Exception.Message)"
    $script:done = $true
    if ($ui) { Start-Sleep -Seconds 5 }
    throw
  }
} finally {
  Write-Output ($results | ConvertTo-Json -Compress)
  if ($ui) { Start-Sleep -Seconds 3; $ui.Close(); $ui.Dispose() }
}
