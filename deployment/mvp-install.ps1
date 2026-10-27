param(
  [string[]]$ChromiumExtensionIds = @(),
  [string]$EventLogsDirectory,
  [switch]$SkipBrowsers,
  [switch]$NonInteractive
)
# VerifAI MVP installer (USB). Everything needed is on the stick; nothing is downloaded.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$app = $PSScriptRoot
$localRoot = Join-Path $env:LOCALAPPDATA 'VerifAI'
$runtimeTarget = Join-Path $localRoot 'Runtime'
$stableRoot = Join-Path $localRoot 'Extensions'
$log = Join-Path $localRoot 'Logs'
New-Item -ItemType Directory -Path $log -Force | Out-Null
$transcript = Join-Path $log ("mvp-install-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $transcript | Out-Null

function Say([string]$Text) { Write-Host $Text }
function Step([string]$Text) { Write-Host "`n== $Text ==" -ForegroundColor Cyan }
function Pause-ForUser([string]$Text) {
  if ($NonInteractive) { return }
  Write-Host ''
  Read-Host $Text | Out-Null
}
function Get-Sha256([string]$File) {
  # Pure .NET so it works even when PowerShell module auto-loading is
  # disabled or PSModulePath is clobbered (common on locked-down/enterprise PCs),
  # which otherwise makes Get-FileHash fail with "not recognized".
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($File)
    try {
      ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join ''
    } finally { $stream.Dispose() }
  } finally { $sha.Dispose() }
}

try {
  Step 'Checking this computer'
  Say "PowerShell $($PSVersionTable.PSVersion); Windows $([Environment]::OSVersion.Version)"
  if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'This installer runs on Windows only.' }
  if ($PSVersionTable.PSVersion.Major -lt 5) {
    throw "Windows PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion)). Update Windows Management Framework."
  }
  $arch = $env:PROCESSOR_ARCHITECTURE
  $archW = $env:PROCESSOR_ARCHITEW6432
  if ($arch -eq 'x86' -and -not $archW) {
    throw 'This computer is running 32-bit Windows. The bundled runtime is 64-bit. Use a 64-bit Windows PC.'
  }
  if ($arch -eq 'ARM64' -or $archW -eq 'ARM64') {
    Say 'ARM64 Windows detected; the 64-bit runtime runs under built-in emulation (supported).'
  }
  foreach ($variable in @('LOCALAPPDATA', 'APPDATA', 'USERPROFILE')) {
    if (-not (Get-Item "Env:$variable" -ErrorAction SilentlyContinue)) { throw "The $variable environment variable is not set; cannot continue." }
  }
  # Fail early if something other than our collector already holds the port.
  $listener = Get-NetTCPConnection -LocalPort 43821 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $ownerScript = if ($owner) { $owner.CommandLine } else { '' }
    if ($ownerScript -notlike '*VerifAI\App\local-service.js*') {
      throw 'Port 43821 is in use by another program. Close it and retry (VerifAI uses 127.0.0.1:43821).'
    }
    Say 'An existing VerifAI collector is running; it will be upgraded in place.'
  }
  Say 'Computer checks passed.'

  Step 'Checking the package on the USB drive'
  $manifestFile = Join-Path $root 'SHA256.json'
  if (!(Test-Path -LiteralPath $manifestFile)) { throw 'SHA256.json is missing; this is not a complete VerifAI MVP package.' }
  $expected = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
  $bad = @()
  $optionalMissing = @()
  foreach ($property in $expected.PSObject.Properties) {
    $file = Join-Path $root ($property.Name -replace '/', '\')
    # docs/ and README files are documentation only; the installer runs without them.
    $optional = $property.Name -like 'docs/*' -or $property.Name -like 'README.*'
    if (!(Test-Path -LiteralPath $file)) {
      if ($optional) { $optionalMissing += $property.Name } else { $bad += $property.Name }
    } elseif ((Get-Sha256 $file) -ne $property.Value) { $bad += $property.Name }
  }
  if ($bad.Count) { throw "Package files are missing or altered: $($bad -join ', '). Copy the MVP folder to the USB again." }
  if ($optionalMissing.Count) { Say "Documentation files not present (not required to install): $($optionalMissing -join ', ')" }
  Say "All $(@($expected.PSObject.Properties).Count - $optionalMissing.Count) required package files verified."

  Step 'Installing the bundled runtime (so the USB can be removed afterwards)'
  New-Item -ItemType Directory -Path $runtimeTarget -Force | Out-Null
  $nodeSource = Join-Path $root 'runtime\node.exe'
  $node = Join-Path $runtimeTarget 'node.exe'
  if (!(Test-Path -LiteralPath $node) -or (Get-Sha256 $node) -ne (Get-Sha256 $nodeSource)) {
    Copy-Item -LiteralPath $nodeSource -Destination $node -Force
  }
  Copy-Item -LiteralPath (Join-Path $root 'runtime\NODE-LICENSE.txt') -Destination (Join-Path $runtimeTarget 'NODE-LICENSE.txt') -Force
  # Files copied from a USB stick carry Mark-of-the-Web; clear it so Windows does not block the runtime.
  Unblock-File -LiteralPath $node -ErrorAction SilentlyContinue
  try {
    $version = (& $node --version 2>&1 | Out-String).Trim()
  } catch {
    throw "The bundled runtime could not start: $($_.Exception.Message). If this PC blocks unsigned executables, copy the MVP folder to the local disk and retry."
  }
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v\d+\.') {
    throw "The bundled runtime did not run correctly (returned '$version'). Copy the MVP folder to the local disk (not the USB) and retry."
  }
  Say "Runtime ready: Node.js $version at $node"

  Step 'Staging the browser extension'
  $wantedVersion = (Get-Content (Join-Path $root 'extension-chromium\manifest.json') -Raw | ConvertFrom-Json).version
  foreach ($kind in @('chromium', 'firefox')) {
    $source = Join-Path $root "extension-$kind"
    $target = Join-Path $stableRoot $kind
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    # Manifest last, so a running extension's update check never sees a new version before its files exist.
    foreach ($file in @(Get-ChildItem -LiteralPath $source -File | Sort-Object { $_.Name -eq 'manifest.json' })) {
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $target $file.Name) -Force
    }
  }
  $chromiumFolder = Join-Path $stableRoot 'chromium'
  $firefoxManifest = Join-Path $stableRoot 'firefox\manifest.json'
  Say "Extension $wantedVersion staged in $stableRoot"

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
  $pages = @{ Chrome = 'chrome://extensions'; Edge = 'edge://extensions'; Brave = 'brave://extensions'; Firefox = 'about:debugging#/runtime/this-firefox' }
  function Get-Inventory([string]$Browser) {
    $json = & $node (Join-Path $app 'browser-inventory.js') $Browser $profileRoots[$Browser]
    if ($LASTEXITCODE -ne 0) { return @() }
    # Windows PowerShell 5.1 returns a JSON array as one object; ForEach-Object unrolls it.
    return @(($json | ConvertFrom-Json) | ForEach-Object { $_ })
  }

  # -File passes "id1,id2" as one string; accept both array and comma-separated forms.
  $ids = @($ChromiumExtensionIds | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
  $updateTargets = @()
  $detected = @()
  foreach ($browser in @('Chrome', 'Edge', 'Brave', 'Firefox')) {
    $executable = @($candidates[$browser] | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
    if ($executable.Count) { $detected += $browser }
  }
  Step "Browsers detected: $(if ($detected.Count) { $detected -join ', ' } else { 'none' })"

  $usbRoot = [IO.Path]::GetPathRoot($root)
  function Test-RemovablePath([string]$Path) {
    try {
      $drive = New-Object System.IO.DriveInfo ([IO.Path]::GetPathRoot($Path))
      return $drive.DriveType -eq 'Removable' -or $drive.DriveType -eq 'CDRom' -or $drive.DriveType -eq 'Network'
    } catch { return $false }
  }
  function Register-Record([string]$Browser, $Record) {
    if (!$Record.Id -or $Record.Id -cnotmatch '^[a-p]{32}$') { return }
    $script:ids += $Record.Id
    $where = if ($Record.Path) { $Record.Path.TrimEnd('\') } else { '' }
    Say "${Browser}/$($Record.Profile): VerifAI $($Record.Version) found, ID $($Record.Id)"
    if ($where -eq $chromiumFolder) {
      $script:updateTargets += @{ caller = "chrome-extension://$($Record.Id)/"; manifestPath = (Join-Path $chromiumFolder 'manifest.json') }
    } elseif ($where -and (($usbRoot -and $where.StartsWith($usbRoot, [StringComparison]::OrdinalIgnoreCase)) -or (Test-RemovablePath $where))) {
      Write-Host "    WARNING: loaded from the USB drive ($where). It will stop working when the drive is removed." -ForegroundColor Yellow
      Write-Host "    Fix: on the extensions page click Remove on VerifAI, then Load unpacked -> $chromiumFolder, then re-run this installer." -ForegroundColor Yellow
    } elseif ($where) {
      Say "    (loaded from $where; the stable folder $chromiumFolder receives automatic updates)"
    }
  }
  # Browsers flush preference files a few seconds after an extension is loaded.
  function Wait-ForRecords([string]$Browser, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
      $records = @(Get-Inventory $Browser | Where-Object { $_.Id -and $_.Version -eq $wantedVersion })
      if ($records.Count) { return $records }
      Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return @(Get-Inventory $Browser | Where-Object { $_.Id })
  }

  # Precise numbered instructions, shown as a pop-up when interactive and always echoed to the console.
  function Show-Guide([string]$Title, [string[]]$Lines) {
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ('-' * 72) -ForegroundColor Cyan
    $Lines | ForEach-Object { Write-Host $_ }
    Write-Host ('=' * 72) -ForegroundColor Cyan
    if ($NonInteractive) { return }
    try {
      Add-Type -AssemblyName System.Windows.Forms
      [void][System.Windows.Forms.MessageBox]::Show(($Lines -join "`r`n"), $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
    } catch {}
  }
  function Chromium-Steps([string]$Browser) {
    @(
      "$Browser has opened its Extensions page ($($pages[$Browser])).",
      'An Explorer window showing the correct folder has also opened - you can drag it onto the picker.',
      '1. Top-right corner: switch "Developer mode" ON.',
      '2. Click the "Load unpacked" button that appears.',
      '3. In the folder picker, click the address bar at the top, paste (Ctrl+V) this EXACT path and press Enter:',
      "      $chromiumFolder",
      '   (It is already on your clipboard.)',
      '4. You must now be INSIDE the "chromium" folder and see manifest.json listed. Then click "Select Folder".',
      '   WRONG: stopping at "VerifAI" or "Extensions" gives "Manifest file is missing or unreadable".',
      '   WRONG: the extension-chromium folder on the USB drive - it breaks when the drive is removed.',
      '5. "VerifAI Approval Gate" appears. Make sure its switch is ON (blue); click "Allow" if asked.',
      '6. If VerifAI was already listed: click its Reload (circular arrow) instead of adding a second copy.',
      "7. Return to this window and press Enter. Setup waits up to 30 seconds while $Browser saves the extension ID",
      '   and then checks that the loaded copy is in the correct folder.'
    )
  }
  function Firefox-Steps {
    @(
      'Firefox has opened about:debugging (This Firefox).',
      '1. Click "Load Temporary Add-on...".',
      '2. In the file picker, paste this path and press Enter:',
      "      $firefoxManifest",
      '   (It is already on your clipboard.)',
      '3. Click "Open". "VerifAI Approval Gate" appears under Temporary Extensions.',
      '4. Return to this window and press Enter.',
      'Note: Firefox removes temporary add-ons when it closes. Repeat these steps after restarting Firefox,',
      'or use the Enterprise package with a Mozilla-signed add-on for a permanent install.'
    )
  }

  # Always register VerifAI copies that already exist, whatever path they were loaded from.
  foreach ($browser in @('Chrome', 'Edge', 'Brave')) {
    foreach ($record in @(Get-Inventory $browser | Where-Object { $_.Id })) { Register-Record $browser $record }
  }

  if (!$SkipBrowsers) {
    $stepNumber = 0
    foreach ($browser in $detected) {
      $stepNumber++
      $executable = @($candidates[$browser] | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)[0]
      if ($browser -ne 'Firefox') {
        $current = @(Get-Inventory $browser | Where-Object { $_.Id -and $_.Version -eq $wantedVersion -and $_.Path -and $_.Path.TrimEnd('\') -eq $chromiumFolder })
        if ($current.Count) {
          Say "${browser}: VerifAI $wantedVersion is already loaded from the stable folder in $($current.Count) profile(s); nothing to do."
          continue
        }
      }
      if ($browser -eq 'Firefox') {
        try { Set-Clipboard -Value $firefoxManifest } catch {}
        Start-Process -FilePath $executable -ArgumentList $pages[$browser]
        Show-Guide "Step $stepNumber of $($detected.Count) - Firefox" (Firefox-Steps)
        Pause-ForUser 'Press Enter when done with Firefox (or to skip)'
        continue
      }
      try { Set-Clipboard -Value $chromiumFolder } catch {}
      Start-Process -FilePath $executable -ArgumentList $pages[$browser]
      # Open Explorer inside the exact folder so the user can see manifest.json and drag the folder onto the picker.
      if (!$NonInteractive) { try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $chromiumFolder + '"') } catch {} }
      Show-Guide "Step $stepNumber of $($detected.Count) - $browser" (Chromium-Steps $browser)
      $attempt = 0
      while ($true) {
        $attempt++
        Pause-ForUser "Press Enter after VerifAI is loaded and enabled in $browser"
        $known = @($ids)
        Say "${browser}: waiting for the browser to save the extension ID..."
        $after = @(Wait-ForRecords $browser 30 | Where-Object { $known -notcontains $_.Id })
        if ($after.Count) {
          foreach ($record in $after) { Register-Record $browser $record }
          $wrongPlace = @($after | Where-Object { $_.Path -and $_.Path.TrimEnd('\') -ne $chromiumFolder })
          if ($wrongPlace.Count -and !$NonInteractive -and $attempt -lt 3) {
            $answer = Read-Host "${browser}: VerifAI was loaded from a different folder ($($wrongPlace[0].Path)). Remove it in $browser and load $chromiumFolder instead, then type R and Enter to re-check (or just Enter to keep it)"
            if ($answer -match '^[Rr]') { try { Set-Clipboard -Value $chromiumFolder } catch {}; continue }
          }
          break
        }
        if ($NonInteractive) { break }
        Show-Guide "$browser - VerifAI was not detected" @(
          "No new VerifAI extension was found in $browser.",
          'If the browser showed "Manifest file is missing or unreadable", the folder picker stopped one level too high.',
          'Open "Load unpacked" again, paste this exact path in the address bar, press Enter, confirm you see manifest.json, then "Select Folder":',
          "      $chromiumFolder",
          'Type R and press Enter here to re-check, paste the 32-letter ID shown under VerifAI, or press Enter to skip this browser.'
        )
        $typed = Read-Host "${browser}: R = re-check, or paste the ID, or Enter to skip"
        if ($typed -match '^[Rr]$') { try { Set-Clipboard -Value $chromiumFolder } catch {}; if ($attempt -lt 5) { continue } }
        if ($typed -cmatch '^[a-p]{32}$') { $ids += $typed } else { Say "${browser}: skipped." }
        break
      }
    }
  }
  $ids = @($ids | Where-Object { $_ -cmatch '^[a-p]{32}$' } | Select-Object -Unique)
  $rejected = @($ChromiumExtensionIds | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ -and $_ -cnotmatch '^[a-p]{32}$' })
  if ($rejected.Count) { Say "Ignored invalid extension ID value(s): $($rejected -join ', ')" }
  foreach ($id in $ids) {
    if (!($updateTargets | Where-Object { $_.caller -eq "chrome-extension://$id/" })) {
      $updateTargets += @{ caller = "chrome-extension://$id/"; manifestPath = (Join-Path $chromiumFolder 'manifest.json') }
    }
  }

  # Private windows: browsers only run the extension there after the user allows it per extension.
  # No installer or policy can switch this on for Chrome/Edge/Brave, so guide the user and verify.
  $privateToggle = @{ Chrome = 'Allow in Incognito'; Edge = 'Allow in InPrivate'; Brave = 'Allow in Private' }
  $coverage = @()
  if (!$SkipBrowsers) {
    foreach ($browser in @($detected | Where-Object { $_ -ne 'Firefox' })) {
      $records = @(Get-Inventory $browser | Where-Object { $_.Id })
      if (!$records.Count) { $coverage += [pscustomobject]@{ Browser = $browser; Covered = $null }; continue }
      $covered = @($records | Where-Object { $_.Incognito -ne $true }).Count -eq 0
      for ($attempt = 0; $attempt -lt 3 -and -not $covered; $attempt++) {
        $executable = @($candidates[$browser] | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)[0]
        Start-Process -FilePath $executable -ArgumentList $pages[$browser]
        Show-Guide "Private windows - $browser" @(
          "${browser}: VerifAI is installed but NOT yet active in private windows ($($privateToggle[$browser])).",
          "Without it, Incognito/InPrivate/Private windows are not blocked or redacted. $browser does not let any installer turn this on for you.",
          '1. On the Extensions page find "VerifAI Approval Gate" and click "Details".',
          "2. Scroll to `"$($privateToggle[$browser])`" and switch it ON.",
          '3. Return to this window and press Enter. Setup re-checks for up to 30 seconds.'
        )
        Pause-ForUser "Press Enter after `"$($privateToggle[$browser])`" is ON in $browser (or Enter to skip)"
        $deadline = (Get-Date).AddSeconds(30)
        do {
          $records = @(Get-Inventory $browser | Where-Object { $_.Id })
          $covered = $records.Count -and @($records | Where-Object { $_.Incognito -ne $true }).Count -eq 0
          if ($covered) { break }
          Start-Sleep -Seconds 2
        } while ((Get-Date) -lt $deadline)
        if ($covered) { Say "${browser}: private windows covered."; break }
        if ($NonInteractive) { break }
        $again = Read-Host "${browser}: still not allowed in private windows. R = re-check, Enter = continue without it"
        if ($again -notmatch '^[Rr]$') { break }
      }
      $coverage += [pscustomobject]@{ Browser = $browser; Covered = $covered }
    }
  }
  $coverageLines = @($coverage | ForEach-Object {
    "   $($_.Browser): " + $(if ($_.Covered -eq $true) { 'covered' } elseif ($_.Covered -eq $false) { "NOT covered - turn on `"$($privateToggle[$_.Browser])`" on its Extensions page" } else { 'not verified' })
  })

  Step 'Installing the local collector, native bridge and automatic startup'
  if (!$EventLogsDirectory) { $EventLogsDirectory = Join-Path $env:USERPROFILE 'VerifAI\EVENT LOGS' }
  $installer = Join-Path $app 'install-windows.ps1'
  & $installer -NodePath $node -ChromiumExtensionIds $ids -EventLogsDirectory $EventLogsDirectory -UpgradeInstalledCollector
  if (!$?) { throw 'Collector installation failed.' }
  ConvertTo-Json -InputObject @($updateTargets) -Depth 4 |
    Set-Content -LiteralPath (Join-Path $localRoot 'App\extension-update-targets.json') -Encoding ascii

  Step 'Verifying'
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:43821/api/health' -TimeoutSec 5
  if (-not $health.ok) { throw 'Collector health check failed.' }
  Say 'Collector healthy on 127.0.0.1:43821.'
  Say "Daily JSON/PDF logs: $EventLogsDirectory"
  Say "Registered Chromium IDs: $(if ($ids.Count) { $ids -join ', ' } else { 'none (re-run after loading the extension)' })"

  Write-Host "`nVerifAI MVP is installed. You can remove the USB drive." -ForegroundColor Green
  Show-Guide 'VerifAI - installation complete' (@(
    'Installation complete. You can remove the USB drive.',
    '1. In each browser click the puzzle-piece (Extensions) icon and pin "VerifAI".',
    '2. Click the VerifAI icon once: the SOC dashboard opens already signed in.',
    '3. Open gemini.google.com, copilot.microsoft.com or perplexity.ai and type a test line such as',
    '      "SIN: 123-456-789"  -  it is replaced before sending and appears on the Redacted PII tab.',
    '4. Any other AI site (for example claude.ai) is blocked and appears under AI Activities.',
    "Daily logs: $EventLogsDirectory  (one JSON + one PDF per day, in <year>\<Mon-year> folders)."
  ) + $(if ($coverageLines.Count) { @('Private-window coverage:') + $coverageLines } else { @() }) + @(
    'Re-run Install-VerifAI.cmd any time to add browsers or apply a newer version; records are kept.'
  ))
} catch {
  Write-Host "`nInstallation stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $transcript"
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
