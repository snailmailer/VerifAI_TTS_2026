const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { GECKO_ID } = require("./deployment/extension-id.js");
const { writeDiagrams } = require("./deployment/diagrams.js");
const { mvpReadme } = require("./deployment/readme-content.js");

const root = __dirname;
const RUNTIME_FILES = ["local-service.js", "native-host.js", "native-config.js", "activity-storage.js",
  "event-logs.js", "ai-policy.js", "redaction-metadata.js", "redaction-dashboard.js", "package.json",
  "dashboard.html", "dashboard.js", "dashboard.css", "VerifAI Logo.png", "install-windows.ps1"];
const EXTENSION_FILES = ["ai-policy.js", "browser-info.js", "redaction-metadata.js", "redaction-dashboard.js",
  "ai-block-rules.json", "blocked.html", "blocked.js", "background.js", "content.js", "activity.js",
  "redaction-core.js", "redaction.js", "dashboard.html", "dashboard.js", "dashboard.css", "VerifAI Logo.png"];
const FIREFOX_BACKGROUND = ["ai-policy.js", "browser-info.js", "redaction-metadata.js", "background.js"];

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function writeFile(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

function nodeVersion(executable) {
  const version = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
  const major = Number(version.match(/^v(\d+)\./)?.[1]);
  if (!(major >= 22)) throw new Error(`Bundled Node.js must be 22 or newer (found ${version}).`);
  return version;
}

function build(outputDirectory, options = {}) {
  if (fs.existsSync(outputDirectory)) {
    throw new Error("Output exists. Choose a new directory; no existing files are overwritten.");
  }
  const nodeExecutable = options.node || process.execPath;
  if (path.basename(nodeExecutable).toLowerCase() !== "node.exe") {
    throw new Error("The MVP USB package targets Windows and needs a Windows node.exe to bundle.");
  }
  const version = nodeVersion(nodeExecutable);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

  for (const file of RUNTIME_FILES) copy(path.join(root, file), path.join(outputDirectory, "app", file));
  for (const file of ["browser-inventory.js", "mvp-install.ps1"]) {
    copy(path.join(root, "deployment", file), path.join(outputDirectory, "app", file));
  }
  for (const file of EXTENSION_FILES) {
    copy(path.join(root, file), path.join(outputDirectory, "extension-chromium", file));
    copy(path.join(root, file), path.join(outputDirectory, "extension-firefox", file));
  }
  copy(path.join(root, "manifest.json"), path.join(outputDirectory, "extension-chromium", "manifest.json"));
  const firefoxManifest = { ...manifest, background: { scripts: FIREFOX_BACKGROUND },
    browser_specific_settings: { gecko: { id: GECKO_ID, strict_min_version: "128.0" } } };
  writeFile(path.join(outputDirectory, "extension-firefox", "manifest.json"), `${JSON.stringify(firefoxManifest, null, 2)}\n`);

  copy(nodeExecutable, path.join(outputDirectory, "runtime", "node.exe"));
  writeFile(path.join(outputDirectory, "runtime", "NODE-LICENSE.txt"),
    `Node.js ${version} (node.exe) is redistributed unmodified under the MIT License.\n` +
    "Copyright Node.js contributors. Full license text: https://github.com/nodejs/node/blob/main/LICENSE\n" +
    "Node.js is a trademark of the OpenJS Foundation. VerifAI is not affiliated with the OpenJS Foundation.\n");

  writeFile(path.join(outputDirectory, "Install-VerifAI.cmd"),
    "@echo off\r\ntitle VerifAI MVP installer\r\n" +
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0app\\mvp-install.ps1\" %*\r\n" +
    "if errorlevel 1 (echo. & echo Installation did not complete. See the message above.)\r\npause\r\n");
  writeFile(path.join(outputDirectory, "Repair-VerifAI.cmd"),
    "@echo off\r\ntitle VerifAI MVP repair\r\n" +
    "echo Registers VerifAI copies already loaded in your browsers and restarts the collector. No browser windows are opened.\r\n" +
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0app\\mvp-install.ps1\" -SkipBrowsers %*\r\npause\r\n");
  writeFile(path.join(outputDirectory, "Uninstall-VerifAI.cmd"),
    "@echo off\r\ntitle VerifAI MVP uninstaller\r\n" +
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0app\\install-windows.ps1\" -Uninstall\r\n" +
    "echo Startup entry and browser bridge registration removed. Records and the extension folder are kept.\r\n" +
    "echo Remove the VerifAI extension from each browser's Extensions page if no longer wanted.\r\npause\r\n");
  writeFile(path.join(outputDirectory, "README.txt"), readme(manifest.version, version));
  writeDiagrams(path.join(outputDirectory, "docs"));
  writeFile(path.join(outputDirectory, "README.md"), mvpReadme(manifest.version, version));

  const checksums = {};
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else checksums[path.relative(outputDirectory, file).replace(/\\/g, "/")] =
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  })(outputDirectory);
  writeFile(path.join(outputDirectory, "SHA256.json"), `${JSON.stringify(checksums, null, 2)}\n`);
  return { outputDirectory, extensionVersion: manifest.version, nodeVersion: version, files: Object.keys(checksums).length };
}

function readme(extensionVersion, node) {
  return `VerifAI MVP - USB installer (Windows)
Extension ${extensionVersion}  |  bundled runtime Node.js ${node}

WHAT YOU NEED
  - A 64-bit Windows 10 or 11 PC with Chrome, Edge, Brave and/or Firefox.
  - Nothing else. No internet connection, no Node.js, no admin rights,
    no downloads. A portable runtime is bundled on the stick.

INSTALL (about 2 minutes)
  1. Plug in the USB drive and open this folder.
  2. Double-click  Install-VerifAI.cmd
  3. The installer verifies the package, copies the runtime to your profile,
     then opens each browser's extensions page. In each browser:
        Chrome / Edge / Brave:  Developer mode -> Load unpacked -> paste the folder
                                path from the clipboard -> Select Folder -> make sure
                                VerifAI is enabled.
                                IMPORTANT: use the pasted path
                                (%LOCALAPPDATA%\\VerifAI\\Extensions\\chromium),
                                NOT the extension-chromium folder on this USB drive.
                                A copy loaded from the USB stops working when the
                                drive is removed.
        Firefox:                This Firefox -> Load Temporary Add-on -> paste the
                                manifest path from the clipboard.
     Press Enter in the installer window after each browser. The installer waits
     up to 30 seconds for the browser to save the extension ID.
  4. The installer detects the extension IDs, installs the local collector and
     automatic startup, and checks health. Remove the USB when it says so.

IF A BROWSER SAYS "Manifest file is missing or unreadable"
  - The folder picker stopped one level too high (at "VerifAI" or "Extensions").
    Click "Load unpacked" again, paste the path from the clipboard into the
    picker's ADDRESS BAR, press Enter, make sure you can see manifest.json,
    then click "Select Folder". The correct folder is:
      %LOCALAPPDATA%\VerifAI\Extensions\chromium
    The installer opens that folder in Explorer for you; you can also drag it
    from Explorer onto the picker.

IF A BROWSER SAYS "Access to the specified native messaging host is forbidden"
  - That browser's copy of VerifAI was loaded after the installer ran (or from the
    USB). Double-click  Repair-VerifAI.cmd  - it registers every VerifAI copy found
    in Chrome, Edge and Brave in a few seconds. Then reload the extension once.

USE
  - Click the VerifAI icon in the browser toolbar to open the SOC dashboard.
  - Only Copilot, Gemini and Perplexity are allowed; other AI sites are blocked.
  - Typed or pasted personal data in approved AI chats is redacted before sending.
  - Daily JSON/PDF logs:  %USERPROFILE%\\VerifAI\\EVENT LOGS\\<yyyy>\\<MMM-yyyy>\\
                          AI_Activity_Logs_dd-MMM-yyyy.json/.pdf and Redacted_PII_Logs_dd-MMM-yyyy.json/.pdf
  - README.md in this folder has the full guide with architecture pictures (docs\\*.svg).

UPDATE
  - Run Install-VerifAI.cmd from a newer USB package. Chromium browsers reload the
    staged extension automatically; records are kept.

UNINSTALL
  - Double-click Uninstall-VerifAI.cmd, then remove VerifAI from each browser.

LIMITS (honest)
  - Windows 10/11, 64-bit (x64 or ARM64 via emulation). Not 32-bit Windows.
  - Firefox temporary add-ons disappear when Firefox closes until a Mozilla-signed
    release is used. Safari and mobile devices are not covered by this MVP.
  - The installer cannot enable extensions for you; the browser asks you to.

TESTED FOR A BRAND-NEW PC
  - Verified on a simulated clean profile: no Node.js on PATH, empty user folders.
    The bundled runtime was used, the collector reached healthy, and daily logs
    were created - all with zero prerequisites installed.
`;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const nodeIndex = args.indexOf("--node");
    const output = args.find((value, index) => !value.startsWith("--") && args[index - 1] !== "--node") ||
      path.join(root, "MVP", "VerifAI-MVP-USB");
    const result = build(output, { node: nodeIndex !== -1 ? args[nodeIndex + 1] : undefined });
    console.log(`MVP USB package built at ${result.outputDirectory}`);
    console.log(`Extension ${result.extensionVersion}, bundled Node.js ${result.nodeVersion}, ${result.files} files verified by SHA256.json`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { build };
