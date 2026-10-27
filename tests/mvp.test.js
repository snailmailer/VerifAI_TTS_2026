const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { build } = require("../build-mvp.js");

const windowsNode = process.platform === "win32" && path.basename(process.execPath).toLowerCase() === "node.exe";

test("MVP USB package is self-contained, verifiable and excludes secrets", { skip: !windowsNode }, (context) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-mvp-"));
  context.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const output = path.join(base, "usb");
  const result = build(output);
  assert.match(result.nodeVersion, /^v(2[2-9]|[3-9]\d)\./);

  for (const file of ["Install-VerifAI.cmd", "Repair-VerifAI.cmd", "Uninstall-VerifAI.cmd", "README.txt", "SHA256.json",
    "runtime/node.exe", "runtime/NODE-LICENSE.txt",
    "app/mvp-install.ps1", "app/install-windows.ps1", "app/browser-inventory.js", "app/local-service.js",
    "app/native-host.js", "app/native-config.js", "app/event-logs.js", "app/activity-storage.js",
    "extension-chromium/manifest.json", "extension-chromium/redaction.js", "extension-firefox/manifest.json"]) {
    assert.ok(fs.existsSync(path.join(output, file)), `missing ${file}`);
  }
  const firefox = JSON.parse(fs.readFileSync(path.join(output, "extension-firefox", "manifest.json"), "utf8"));
  assert.equal(firefox.browser_specific_settings.gecko.id, "verifai-approval-gate@example.com");
  assert.ok(Array.isArray(firefox.background.scripts));
  const chromium = JSON.parse(fs.readFileSync(path.join(output, "extension-chromium", "manifest.json"), "utf8"));
  assert.ok(chromium.background.service_worker);
  assert.equal(chromium.version, result.extensionVersion);

  // Every shipped file is covered by the checksum manifest and the hashes are correct.
  const checksums = JSON.parse(fs.readFileSync(path.join(output, "SHA256.json"), "utf8"));
  const all = fs.readdirSync(output, { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, "/"))
    .filter((entry) => fs.statSync(path.join(output, entry)).isFile() && entry !== "SHA256.json");
  assert.deepEqual(Object.keys(checksums).sort(), all.sort());
  for (const [file, hash] of Object.entries(checksums)) {
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(output, file))).digest("hex"), hash, file);
  }
  assert.equal(all.some((entry) => entry.endsWith(".pem") || entry.includes("local-service-token") || entry.includes("approval-events")), false);
  assert.equal(all.some((entry) => entry.startsWith("data/") || entry.startsWith("EVENT LOGS/")), false);

  // Installer refuses to run on an altered package (tamper check path is real, not decorative).
  const script = fs.readFileSync(path.join(output, "app", "mvp-install.ps1"), "utf8");
  assert.match(script, /SHA256\.json/);
  assert.match(script, /missing or altered/);
  assert.match(script, /-NodePath \$node/);
  assert.match(script, /Wait-ForRecords/);
  assert.match(script, /loaded from the USB drive/);
  assert.match(script, /Checking this computer/);
  assert.match(script, /32-bit Windows/);
  assert.match(script, /Unblock-File/);
  assert.match(fs.readFileSync(path.join(output, "README.txt"), "utf8"), /NOT the extension-chromium folder on this USB/);
  assert.throws(() => build(output), /Output exists/);
});

test("install-windows.ps1 accepts a bundled runtime and no longer requires the same node binary", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "install-windows.ps1"), "utf8");
  assert.match(script, /\[string\]\$NodePath/);
  assert.match(script, /Node\.js 22 or newer is required/);
  assert.match(script, /Split-Path \$owner\.ExecutablePath -Leaf\) -ne 'node\.exe'/);
  assert.match(script, /runtime\.json/);
  assert.match(script, /GetFolderPath\('Startup'\)/);
  assert.match(script, /IsNullOrEmpty\(\$startupDir\)/);
  assert.doesNotMatch(script, /\$owner\.ExecutablePath -ne \$node/);
});
