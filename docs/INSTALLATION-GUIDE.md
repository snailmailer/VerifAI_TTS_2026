# VerifAI — Installation Guide (Windows, per-user install)

**Installed location:** `C:\Users\<you>\AppData\Local\VerifAI`  (`%LOCALAPPDATA%\VerifAI`)
**Version:** extension 0.5.5 · bundled Node.js v24.13.0 · collector on `http://127.0.0.1:43821`

This guide explains what the installer puts in this folder, how to install VerifAI on a new PC, how to
add it to each browser, how to verify it is working, and how to repair or remove it.

---

## 1. What is in `%LOCALAPPDATA%\VerifAI`

| Path | Purpose |
|---|---|
| `App\` | The local collector (`local-service.js`), SOC dashboard (`dashboard.html/js/css`), native-messaging bridge (`native-host.js`, `native-host.cmd`), browser bridge manifests (`native-chromium.json`, `native-firefox.json`), the allow-list of registered extension IDs (`native-allowed.json`), daily-log writer (`event-logs.js`), PII metadata rules, and `runtime.json` (which Node to use). |
| `Extensions\chromium\` | The unpacked VerifAI extension for **Chrome, Edge and Brave**. Always "Load unpacked" from **this exact folder** — it survives removing the USB drive and receives updates. |
| `Extensions\firefox\` | The unpacked extension for **Firefox** (load `manifest.json` from here as a temporary add-on, or install the signed `.xpi` when available). |
| `Extensions\crx\` | Signed `verifai-chromium.crx` + `update.xml` used by the policy-based (automatic / enterprise) install. |
| `Runtime\node.exe` | Portable Node.js runtime copied from the USB. No system-wide Node install is needed. |
| `Packages\` | Staged package snapshots used for in-place upgrades. |
| `EndpointMonitor\` | Optional endpoint monitor publish output (desktop-AI process monitoring). |
| `Logs\` | Installer transcripts (`mvp-install-*.log`, `setup-*.log`). Attach these when reporting a problem. |
| `approval-events.json` | The event store the dashboard reads (AI-site visits, blocks, redactions). **No prompt text is stored.** |
| `activity-storage.json` | Activity/queue state for the collector. |
| `local-service-token` | **Secret.** Per-user credential the browsers use to talk to the collector. Never copy or share it. |

**Outside this folder, the installer also creates:**

- `C:\Users\<you>\VerifAI\EVENT LOGS\<yyyy>\<Mon-yyyy>\` — daily `AI_Activity_Logs_dd-MMM-yyyy.json/.pdf` and `Redacted_PII_Logs_dd-MMM-yyyy.json/.pdf`.
- Startup shortcut `…\Start Menu\Programs\Startup\VerifAI.lnk` — starts the collector at sign-in.
- Native-messaging registrations (per-user, no admin) for host **`com.verifai.bridge`**:
  `HKCU\Software\Google\Chrome\NativeMessagingHosts`, `…\Microsoft\Edge\…`, `…\BraveSoftware\Brave-Browser\…`, `…\Mozilla\…`.

---

## 2. Requirements

- 64-bit Windows 10 or 11 (ARM64 works via built-in emulation).
- Windows PowerShell 5.1 or newer (built in). **No admin rights, no internet, no Node.js** required.
- At least one of: Google Chrome, Microsoft Edge, Brave, Mozilla Firefox.

---

## 3. Install on a new PC (USB / standalone)

1. Copy the `VerifAI-MVP-USB` folder to a USB drive (or any local folder).
2. Double-click **`Install-VerifAI.cmd`**.
3. The installer, in order:
   1. **Checks this computer** — Windows version, 64-bit, PowerShell, free port 43821.
   2. **Verifies the package** — every file is checked against `SHA256.json` (61 files).
   3. **Installs the runtime** — copies `node.exe` to `%LOCALAPPDATA%\VerifAI\Runtime`.
   4. **Stages the extension** — copies to `%LOCALAPPDATA%\VerifAI\Extensions\chromium` and `\firefox`.
   5. **Detects browsers** and opens each one's extensions page with a step-by-step pop-up (see §4).
   6. **Installs the collector, native bridge and startup shortcut**, registers the detected extension IDs
      in `native-allowed.json`, and configures the daily-log folder.
   7. **Health check** — confirms the collector answers on `127.0.0.1:43821` and prints a finish summary.
4. When you see **"VerifAI MVP is installed. You can remove the USB drive."** you are done.

> **Enterprise (Intune / Jamf / GPO):** use the `VerifAI-Enterprise` package instead. It pushes the
> signed CRX through `ExtensionInstallForcelist`, registers the native host, and needs no browser pop-ups.

---

## 4. Add VerifAI to each browser (guided pop-ups)

The installer puts the exact path on your clipboard for every step.

### Chrome / Edge / Brave
1. The extensions page opens (`chrome://extensions`, `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. In the folder picker click the address bar, **paste** (Ctrl+V) and press Enter:
   `C:\Users\<you>\AppData\Local\VerifAI\Extensions\chromium`
   You must be *inside* the `chromium` folder and see `manifest.json`, then click **Select Folder**.
   - ❌ Stopping at `VerifAI` or `Extensions` gives *"Manifest file is missing or unreadable"*.
   - ❌ Do not pick the `extension-chromium` folder on the USB — it breaks when the drive is removed.
5. **VerifAI Approval Gate** appears; make sure its switch is **on**.
6. *(Recommended)* Click **Details** → enable **Allow in Incognito / InPrivate / Private** so private
   windows are covered too.
7. Return to the installer window — it waits up to 30 s and shows the detected 32-letter extension ID.

### Firefox
1. `about:debugging#/runtime/this-firefox` opens.
2. Click **Load Temporary Add-on…**, paste
   `C:\Users\<you>\AppData\Local\VerifAI\Extensions\firefox\manifest.json` and open it.
3. In `about:addons` → VerifAI → **Run in Private Windows: Allow** (optional but recommended).

---

## 5. Verify it works

1. Click the puzzle-piece icon and **pin VerifAI**. Click the icon once — the **SOC dashboard** opens
   already signed in (the extension mints a one-time ticket through the native bridge).
2. **Blocking:** open `https://claude.ai` → you get the VerifAI block page offering approved alternatives;
   the dashboard **AI Activities** tab shows *Blocked AI website*.
3. **JIT PII redaction:** open `gemini.google.com`, `copilot.microsoft.com` or `perplexity.ai`, type a
   synthetic line such as
   `SIN: 123-456-789  BANK_TRANSIT: 04122  BANK_ACCOUNT: 88301924` and press Enter.
   The text is replaced with `[REDACTED: …]` before sending and appears on the **Redacted PII** tab.
4. **Daily logs:** check `C:\Users\<you>\VerifAI\EVENT LOGS\<yyyy>\<Mon-yyyy>\` for today's JSON and PDF.

Manual health check (PowerShell):
```powershell
Invoke-WebRequest http://127.0.0.1:43821/health -UseBasicParsing | Select-Object StatusCode
```

---

## 6. Repair, upgrade, uninstall

| Task | Action |
|---|---|
| Browser says *"Access to the specified native messaging host is forbidden"* | The extension ID is not yet in `native-allowed.json`. Run **`Repair-VerifAI.cmd`** (or re-run the installer), then reload the extension. |
| Dashboard shows *"Dashboard login expired"* | Open it again from the VerifAI toolbar icon (tickets are one-time). |
| Collector not running after sign-in | Check `Startup\VerifAI.lnk` exists; run `Repair-VerifAI.cmd`. |
| Upgrade to a newer version | Run the newer `Install-VerifAI.cmd`. Records in `approval-events.json` are preserved; the running extension picks up the new version from `Extensions\chromium`. |
| Add another browser later | Re-run `Install-VerifAI.cmd`; already-installed browsers are detected and skipped. |
| Uninstall | Run **`Uninstall-VerifAI.cmd`** — removes the startup shortcut and native-host registrations. Then remove the extension from each browser. Delete `%LOCALAPPDATA%\VerifAI` and `%USERPROFILE%\VerifAI\EVENT LOGS` if you also want the data gone. |

Installer transcripts for troubleshooting: `%LOCALAPPDATA%\VerifAI\Logs\`.

---

## 7. Privacy and security notes

- Everything runs on this computer; the collector listens only on loopback `127.0.0.1:43821`.
- Only metadata is recorded (hostname, browser, event type, PII **categories and counts**). Prompt text
  and the redacted values themselves are never stored or transmitted.
- `local-service-token` and `native-allowed.json` are machine-specific — do not copy them between PCs
  or commit them to source control.
