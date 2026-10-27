// Full README content for every package. Each README embeds the SVG diagrams from docs/
// and gives exact, numbered steps for the person doing the installation.
const { GECKO_ID } = require("./extension-id.js");

const DIAGRAMS = `## Architecture (pictures)

| System architecture | JIT redaction & activity flow |
|---|---|
| ![System architecture](docs/architecture.svg) | ![JIT flow](docs/jit-flow.svg) |

| Standalone installation flow | Enterprise deployment flow |
|---|---|
| ![Standalone flow](docs/standalone-flow.svg) | ![Enterprise flow](docs/enterprise-flow.svg) |

*Open the SVG files in any browser if your Markdown viewer does not render images.*
`;

const WHAT_IT_DOES = `## What VerifAI does on the device

- **Allows** only Copilot (copilot.microsoft.com, copilot.com, m365.cloud.microsoft), Gemini (gemini.google.com) and Perplexity (perplexity.ai).
- **Blocks** every other catalogued AI site (claude.ai, chatgpt.com, deepseek, huggingface, poe, character.ai, ...) at the network layer and shows the VerifAI block page.
- **Redacts PII before it is sent** in the approved chats: names, SIN/SSN, health card and driver's licence numbers, addresses, emails, phone, cards, bank accounts, dates of birth. Only categories and counts are recorded - never the text.
- **Records** every blocked attempt, approved-site visit and redaction with date/time, browser and hostname, pushes it to the local SOC dashboard **instantly (JIT)** and rewrites the day's **JSON + PDF logs**.
- Everything stays on the device: loopback collector on 127.0.0.1:43821, no cloud, no prompt text.
`;

const LOGS = `## Daily logs

\`<EVENT LOGS folder>\\<yyyy>\\<MMM-yyyy>\\AI_Activity_Logs_dd-MMM-yyyy.json\` and \`.pdf\`
\`<EVENT LOGS folder>\\<yyyy>\\<MMM-yyyy>\\Redacted_PII_Logs_dd-MMM-yyyy.json\` and \`.pdf\`

Example: \`EVENT LOGS\\2026\\Oct-2026\\Redacted_PII_Logs_26-Oct-2026.pdf\`. One file per type per day; both are rewritten
after every new event, and a new month/year folder is created automatically. Logs written by earlier versions
(\`Oct_2026\\..._26_Oct_2026.*\`) are moved into this layout the first time the collector starts.
`;

const VERIFY = `## Verify it works (2 minutes, synthetic data only)

1. Click the **VerifAI** toolbar icon: the SOC dashboard opens, already signed in.
2. Open **gemini.google.com** (or Copilot / Perplexity) and type: \`Resident: Alex Example, SIN: 123-456-789\`
3. Press Enter once. The text becomes \`[REDACTED: NAME], [REDACTED: SOCIAL INSURANCE NUMBER]\` and the send is held; press Enter again to send the clean text.
4. The dashboard's **Redacted PII** tab shows the event within a second; the day's \`Redacted_PII_Logs_*.json/.pdf\` are updated.
5. Open **claude.ai**: the VerifAI block page appears and **AI Activities** shows the blocked attempt.
`;

const LIMITS = `## Private windows (Incognito / InPrivate / Private)

Browsers keep every extension out of private windows until the user allows it, and **Chrome, Edge and Brave
offer no policy that can switch this on** (Microsoft: "by design... to protect user privacy"). VerifAI
therefore:

- **Standalone / USB:** after the extension is detected, setup opens the Extensions page and asks you to turn on
  **Allow in Incognito** (Chrome), **Allow in InPrivate** (Edge) or **Allow in Private** (Brave), re-checks for
  30 seconds, and lists each browser's private-window coverage on the finish screen. The dashboard's
  diagnostics line shows *Private windows: covered / NOT covered*. Firefox asks on install ("Run in Private Windows").
- **Enterprise (default):** removes private mode on Chrome/Edge/Brave by policy (\`IncognitoModeAvailability\` /
  \`InPrivateModeAvailability\` = 1) and forces VerifAI on in Firefox Private Windows (\`private_browsing: true\`,
  Firefox 136+ / ESR 128.8+). \`distribution.config.json\` -> \`privateWindows\` offers \`gate-edge\` (Edge 139+ keeps
  InPrivate but opens it only after the user allows VerifAI there) and \`allow\` (leave private mode unmanaged).
- Events from private windows are recorded with a **(private)** marker next to the browser name in the dashboard,
  CSV/JSON exports and the daily logs.

## Honest limits

- The browser must be told to enable the extension (standalone) or receive a managed policy (enterprise); no installer can switch on an extension silently without one of those.
- Firefox **temporary** add-ons disappear when Firefox closes; a Mozilla-signed add-on (AMO) is needed for a permanent install - the Enterprise package covers that.
- Safari (macOS/iOS) only runs extensions shipped inside a signed App Store app built with your Apple Developer identity.
- On Android only Firefox supports extensions; on iOS only the Safari app does.
- Detection is pattern based (labelled fields and standard formats); it does not guarantee every possible PII phrasing.
- Private windows on Chrome/Edge/Brave are covered only after the user turns on the per-extension toggle (Standalone) or when private mode is removed by policy (Enterprise default); no installer can grant that access itself.
`;

function nodeInstallHint(osName) {
  return {
    Windows: "Windows: not needed - the MVP/USB package bundles the runtime. For the Standalone package install Node.js 22 LTS from https://nodejs.org (one click, no admin needed with the per-user installer).",
    macOS: "macOS: `brew install node` or download the LTS .pkg from https://nodejs.org. If a `runtime/darwin-<arch>/bin/node` folder exists in this package, setup.sh uses it automatically and nothing needs installing.",
    Linux: "Linux: `sudo apt install nodejs` (Debian/Ubuntu 24.04+), `sudo dnf install nodejs` (Fedora), or the official tarball from https://nodejs.org. If a `runtime/linux-x64/bin/node` folder exists in this package, setup.sh uses it automatically."
  }[osName];
}

function standaloneReadme(version) {
  return `# VerifAI Standalone - ${version}

One per-user setup for **Windows, macOS and Linux** covering **Chrome, Edge, Brave and Firefox** (and the collector for Safari).
Nothing is force-installed: you load the extension in each browser once, guided by on-screen pop-ups.

${DIAGRAMS}
${WHAT_IT_DOES}
## Before you start

- Node.js 22 or newer (the setup checks and tells you if it is missing):
  - ${nodeInstallHint("Windows")}
  - ${nodeInstallHint("macOS")}
  - ${nodeInstallHint("Linux")}
- Your normal user account (no administrator / root needed).
- The browsers you want to protect, installed in their standard locations.

## Install - step by step

| OS | Start the setup |
|----|-----------------|
| Windows | double-click **Setup.cmd** |
| macOS   | open Terminal in this folder and run \`sh setup.sh\` |
| Linux   | open a terminal in this folder and run \`sh setup.sh\` |

On Windows the setup first tries **automatic installation**: a progress window shows each browser being told,
through its own per-user policy, to install the signed VerifAI package - you watch it happen and can press
**Cancel and undo** at any time. Browsers only accept a non-store package this way on computers that are
domain / Entra / MDM-enrolled (or once VerifAI is published to the stores). On an unmanaged home PC the window
says so plainly, changes nothing, and the setup falls back to the guided steps below for those browsers.
You can also run **Auto-Install-Extension.cmd** on its own later, and **Undo-Auto-Install.cmd** to reverse it.

The setup then walks you through these screens:

1. **Detected browsers** - type the numbers of the browsers to set up, or press Enter for all.
2. **Daily log folder** - press Enter to accept \`<home>/VerifAI/EVENT LOGS\` or type another folder.
3. **One pop-up per browser** (Chrome, Edge, Brave):
   1. Top-right corner of the Extensions page: switch **Developer mode** ON.
   2. Click **Load unpacked**.
   3. Paste the folder path from the clipboard into the picker's address bar and press Enter
      (\`%LOCALAPPDATA%\\VerifAI\\Extensions\\chromium\` on Windows, \`~/.local/share/VerifAI/Extensions/chromium\` on macOS/Linux).
   4. Click **Select Folder**; "VerifAI Approval Gate" appears.
   5. Make sure its switch is ON; click **Allow** if asked.
   6. Back in the setup window press **Enter** - it waits up to 30 s for the browser to save the extension ID.
4. **Firefox pop-up**: **Load Temporary Add-on...** -> paste the manifest path from the clipboard -> **Open** -> Enter.
5. The setup installs the local collector, native bridge and automatic start-up, registers the detected IDs and checks health.
6. **Finish pop-up** - pin the VerifAI icon and run the verification below.

Re-run the same command any time to add a browser or apply a newer version; records are kept.

### If a browser says "Access to the specified native messaging host is forbidden"
That browser's copy of VerifAI was loaded **after** setup registered the IDs (or in a browser you did not select).
Run **Repair-VerifAI.cmd** (Windows) or **\`./repair.sh\`** (macOS/Linux): it registers every VerifAI copy found in
Chrome, Edge and Brave in a few seconds without opening any browser. Then reload the extension once.

### If a browser says "Manifest file is missing or unreadable"
The folder picker stopped one level too high. Click **Load unpacked** again, paste the clipboard path into the picker's
**address bar**, press Enter, confirm \`manifest.json\` is visible, then **Select Folder**.

${VERIFY}
${LOGS}
## Uninstall

- Windows: \`runtime\\install-windows.ps1 -Uninstall\` (removes start-up entry and bridge registration; records kept).
- macOS: \`launchctl bootout gui/$(id -u)/com.verifai.collector\`, then delete \`~/Library/LaunchAgents/com.verifai.collector.plist\` and the \`NativeMessagingHosts/com.verifai.bridge.json\` files.
- Linux: \`systemctl --user disable --now verifai-collector.service\`, then delete the unit file and the \`com.verifai.bridge.json\` files.
- In each browser remove the VerifAI extension from its Extensions page.

${LIMITS}
`;
}

function mvpReadme(version, nodeVersion) {
  return `# VerifAI MVP - USB installer for Windows (${version})

**Zero prerequisites.** A portable Node.js ${nodeVersion} runtime is on the stick; nothing is downloaded and no admin rights are needed.
Tested on a simulated brand-new Windows profile (no Node.js, empty user folders) and on a real workstation.

${DIAGRAMS}
${WHAT_IT_DOES}
## Install - step by step (about 2 minutes)

1. Plug in the USB drive and open this folder.
2. Double-click **Install-VerifAI.cmd**. A console window opens and:
   - checks the PC (64-bit Windows 10/11, PowerShell 5.1+, port 43821 free),
   - verifies all package files against \`SHA256.json\`,
   - copies the runtime to \`%LOCALAPPDATA%\\VerifAI\\Runtime\` so the stick can be removed later,
   - stages the extension in \`%LOCALAPPDATA%\\VerifAI\\Extensions\\chromium\` (and \`firefox\`).
3. **A pop-up appears for each detected browser** and that browser's Extensions page opens. Follow the pop-up exactly:
   - Chrome / Edge / Brave: **Developer mode ON** -> **Load unpacked** -> paste the clipboard path -> **Select Folder** -> switch ON -> back to the console -> **Enter**.
     Do **not** pick the \`extension-chromium\` folder on the USB drive - that copy stops working when the drive is removed.
   - Firefox: **Load Temporary Add-on...** -> paste the clipboard path -> **Open** -> **Enter**.
4. The installer waits up to 30 s per browser for the extension ID, installs the collector, native bridge and start-up entry, configures the daily logs and checks health.
5. The **finish pop-up** confirms success. Remove the USB drive.

### If a browser says "Manifest file is missing or unreadable"
The folder picker stopped one level too high (at \`VerifAI\` or \`Extensions\`). Click **Load unpacked** again, paste the clipboard path into the picker's **address bar**, press Enter, confirm \`manifest.json\` is visible, then **Select Folder**. The correct folder is \`%LOCALAPPDATA%\\VerifAI\\Extensions\\chromium\` (the installer also opens it in Explorer; you can drag it onto the picker).

### If a browser later says "Access to the specified native messaging host is forbidden"
That browser's copy of VerifAI was loaded after the installer ran. Double-click **Repair-VerifAI.cmd** (4 seconds), then reload the extension once.

${VERIFY}
${LOGS}
## Update / uninstall

- **Update:** run **Install-VerifAI.cmd** from a newer stick. Chromium browsers reload the staged extension automatically; records are kept.
- **Uninstall:** **Uninstall-VerifAI.cmd**, then remove VerifAI from each browser's Extensions page.

${LIMITS}
`;
}

function enterpriseReadme(manifest, enterprisePath) {
  const mode = manifest.distribution;
  const rows = manifest.packages.filter((entry) => entry.forced).map((entry) =>
    `| ${entry.os} | ${entry.browsers.join(", ")} | ${entry.method} | \`${enterprisePath(entry.path)}/\` |`).join("\n");
  return `# VerifAI Enterprise - ${manifest.version}

Managed **force-install + auto-update** for Windows (Intune), macOS (Jamf/Intune), Linux (managed policy), iOS (MDM / Safari app) and Android (EMM / Firefox).
Users never see a browser prompt: the policy installs, pins and updates the extension.

${DIAGRAMS}
${WHAT_IT_DOES}
## Distribution mode

Chrome **${mode.chrome}**, Edge **${mode.edge}**, Brave **${mode.brave}**, Firefox **${mode.firefox}**.
Extension IDs in the policies: Chrome \`${manifest.policyIds.chrome}\`, Edge \`${manifest.policyIds.edge}\`, Brave \`${manifest.policyIds.brave}\`, Firefox \`${GECKO_ID}\`.
Switch to store mode by pasting the store IDs into \`distribution.config.json\` and rebuilding (\`npm run build:distribution\`).

| OS | Browsers | Mechanism | Folder |
|----|----------|-----------|--------|
${rows}

## Deploy - step by step

1. **Publish** - follow \`PUBLISH-CHECKLIST.md\` (stores recommended; otherwise upload \`release-assets/\` to the GitHub release).
2. **Pick the deployment set** - \`node select-package.js --os Windows --browsers Chrome,Edge\` or open \`package-chooser.html\`.
3. **Apply the browser policy** with your MDM (each OS folder has its own README with exact clicks).
4. **Deploy the per-user collector** in the logged-on user's context (not SYSTEM/root): Windows \`collector/runtime/install-windows.ps1\`, macOS \`macOS-MDM/jamf-install-bridge.sh\`, Linux \`collector/deployment/install-linux.js\`.
5. **Verify** on one pilot device using the checklist below, then roll out.

${VERIFY}
${LOGS}
${LIMITS}
`;
}

function windowsIntuneReadme(id, urls, version, geckoId = GECKO_ID) {
  return `# Windows - force-install with Intune

**Chromium extension ID (Chrome, Edge, Brave):** \`${id}\`  **Firefox ID:** \`${geckoId}\`  **Version:** ${version}

![Enterprise flow](../docs/enterprise-flow.svg)

## Prerequisite - host the packages (self-hosted mode only)
Upload to the GitHub release so these URLs resolve:
- \`${urls.crx}\`  (release-assets/verifai-chromium.crx)
- \`${urls.updateXml}\`  (release-assets/update/update.xml)
- \`${urls.xpi}\`  (**Mozilla-signed** verifai-firefox.xpi)

## Option A - Intune Win32 app (all four browsers) - step by step
1. Download the Microsoft Win32 Content Prep Tool and run, from this folder: \`IntuneWinAppUtil -c . -s Install.ps1 -o .\`
2. Intune admin center -> **Apps** -> **Windows** -> **Add** -> *Windows app (Win32)* -> select the generated \`Install.intunewin\`.
3. **Program** tab:
   - Install command: \`powershell.exe -ExecutionPolicy Bypass -File Install.ps1\`
   - Uninstall command: \`powershell.exe -ExecutionPolicy Bypass -File Uninstall.ps1\`
   - Install behavior: **System**
4. **Detection rules** -> *Use a custom detection script* -> upload \`Detect.ps1\` (exit 0 = installed).
5. **Assignments** -> Required -> the device group. Devices receive the HKLM \`ExtensionSettings\` policy on next check-in; browsers install VerifAI within minutes and keep it updated.

## Option B - Settings catalog (no packaging; Chrome and Edge)
Intune -> **Devices** -> **Configuration** -> **Create** -> *Settings catalog* -> search
*"Control which extensions are installed silently"* (Edge) / the Google Chrome ADMX equivalent and add:
\`${id};${urls.updateXml}\`
Firefox: deploy the ExtensionSettings policy from \`policies/windows-policy-plan.json\` via the Firefox ADMX.

## Per-user collector
Deploy \`collector/runtime/install-windows.ps1 -ChromiumExtensionIds @('${id}') -EventLogsDirectory '<folder>'\` **as the logged-on user** (Intune: Win32 app with *Install behavior: User*). Never run it as SYSTEM.

## Visible per-user automatic install (no Intune packaging)
On an enrolled device (AD / Entra / Chrome Enterprise Core), **Install-Extension-PerUser.cmd** writes the HKCU
\`ExtensionInstallForcelist\` for Chrome, Edge and Brave pointing at the signed VerifAI CRX, shows a progress window
while each browser installs it, and offers **Cancel and undo**. Unenrolled devices are detected and reported
(browsers refuse off-store force-install there); in store mode the same script works on any device.

## Verify on a pilot device
\`edge://policy\` / \`chrome://policy\` shows ExtensionSettings with the ID -> \`edge://extensions\` lists VerifAI as *Installed by your administrator* -> run the 2-minute verification in the top-level README.
`;
}

function macMdmReadme(id, urls, geckoId = GECKO_ID) {
  return `# macOS - force-install with Jamf Pro or Intune

**Chromium ID:** \`${id}\`  **Firefox ID:** \`${geckoId}\`

![Enterprise flow](../docs/enterprise-flow.svg)

## Chrome / Edge / Brave / Firefox - step by step
1. Host \`${urls.crx}\`, \`${urls.updateXml}\` and a **Mozilla-signed** \`${urls.xpi}\` (skip in store mode).
2. **Jamf Pro**: Computers -> Configuration Profiles -> **Upload** -> choose each file in \`profiles/\` (chrome, edge, brave, firefox) -> Scope -> Save.
   **Intune**: Devices -> macOS -> Configuration -> Create -> *Templates* -> *Custom* -> upload each \`.mobileconfig\` -> assign.
3. Browsers pick up \`ExtensionSettings\` (force_installed) at next launch and keep VerifAI updated from the store / update.xml.

## Safari
Safari extensions must ship inside a **signed, notarized app** built with your Apple Developer identity (Xcode -> Safari Web Extension), distributed via the App Store or Apple Business Manager. No profile can force a Safari extension without that app.

## Per-user collector
Jamf policy -> Scripts -> \`jamf-install-bridge.sh\` with parameters: **$4** extracted package root, **$5** trusted Node.js path, **$6** comma-separated Chromium IDs. It runs \`install-macos.js\` as the console user and creates the LaunchAgent.

## Verify
Chrome -> \`chrome://policy\` shows ExtensionSettings -> \`chrome://extensions\` lists VerifAI -> run the 2-minute verification in the top-level README.
`;
}

function linuxReadme(id, urls, geckoId = GECKO_ID) {
  return `# Linux - force-install with managed policies

**Chromium ID:** \`${id}\`  **Firefox ID:** \`${geckoId}\`

![Enterprise flow](../docs/enterprise-flow.svg)

## System policies (root) - step by step
1. Host \`${urls.crx}\`, \`${urls.updateXml}\` and a **Mozilla-signed** \`${urls.xpi}\` (skip in store mode).
2. Copy this folder to the device and run \`sudo ./install-linux.sh\`. It installs:
   - \`/etc/opt/chrome/policies/managed/verifai.json\`
   - \`/etc/opt/edge/policies/managed/verifai.json\`
   - \`/etc/brave/policies/managed/verifai.json\`
   - \`/etc/firefox/policies/policies.json\`
   (Push the same files with Ansible/Puppet/Landscape for fleets.)
3. Restart the browsers; they force-install VerifAI and keep it updated.

## Per-user collector
As the normal user: \`node deployment/install-linux.js ${id}\` (Node.js 22+). It installs the bridge and a \`systemd --user\` service.

## Verify
\`chrome://policy\` shows ExtensionSettings -> \`chrome://extensions\` lists VerifAI -> run the 2-minute verification in the top-level README.
`;
}

function iosReadme() {
  return `# iOS - Safari only, via MDM

![Enterprise flow](../docs/enterprise-flow.svg)

All iOS browsers use WebKit and cannot load extensions **except the Safari app**, and only from a signed app you publish.

## Steps (requires your Apple Developer account)
1. Xcode -> **File > New > Project > Safari Extension App**; import the extension sources from the Standalone package's \`extension-chromium\`.
2. Sign with your Team ID, archive, notarize and submit to the App Store (or distribute through Apple Business Manager).
3. Intune/Jamf: assign the app to devices, then push \`safari-managed-app-config.plist\` (set \`BUNDLE_ID\`) as the managed app configuration to force-enable the extension.
4. Users open Safari -> Settings -> Extensions: VerifAI shows as managed.

Chrome, Edge, Brave and Firefox on iOS cannot run extensions. The loopback collector model does not apply on mobile.
`;
}

function androidReadme(urls, geckoId = GECKO_ID) {
  return `# Android - Firefox only, via EMM

![Enterprise flow](../docs/enterprise-flow.svg)

On Android only Firefox supports extensions; Chrome, Edge and Brave for Android have none and cannot be forced.

## Steps
1. Publish an **AMO-signed** add-on (ID \`${geckoId}\`) hosted at \`${urls.xpi}\` (or AMO listing in store mode).
2. Enroll devices in Android Enterprise (Intune / Managed Google Play) and approve Firefox.
3. Intune -> Apps -> App configuration policies -> Managed devices -> Firefox -> **JSON data** -> paste \`firefox-enterprise-policy.json\`.
4. Firefox force-installs the add-on on next sync.

The loopback collector model does not apply on mobile; reporting requires a hosted collector (out of scope for this package).
`;
}

module.exports = { DIAGRAMS, standaloneReadme, mvpReadme, enterpriseReadme, windowsIntuneReadme, macMdmReadme, linuxReadme, iosReadme, androidReadme };
