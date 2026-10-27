const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.join(__dirname, "..", "deployment", "auto-install-extension.ps1");
const windows = process.platform === "win32";

function run(packageRoot, extra = []) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    "-PackageRoot", packageRoot, "-NonInteractive", "-Browsers", "Chrome", ...extra], { encoding: "utf8", timeout: 120000 });
  const lines = (result.stdout || "").trim().split(/\r?\n/);
  let outcome = [];
  try { outcome = JSON.parse(lines[lines.length - 1]); if (!Array.isArray(outcome)) outcome = [outcome]; } catch { /* no JSON */ }
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", outcome };
}

function makePackage(context, ids) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-autoinstall-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "release-assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "release-assets", "verifai-chromium.crx"), Buffer.from("Cr24"));
  fs.writeFileSync(path.join(root, "release-assets", "extension-ids.json"), JSON.stringify(ids));
  return root;
}

const selfHosted = "pbbebilmaanfeihfgeeknjhilehjemga";
const baseIds = {
  version: "0.5.4",
  distribution: { chrome: "self-hosted", edge: "self-hosted", brave: "self-hosted", firefox: "self-hosted" },
  chromium: { selfHostedId: selfHosted, policyIds: { chrome: selfHosted, edge: selfHosted, brave: selfHosted } }
};

function enrolled() {
  // The script's own detection; this test host is expected to be unmanaged, but do not assume it.
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "$d=(Get-CimInstance Win32_ComputerSystem).PartOfDomain; $e=((dsregcmd /status) -join \"`n\") -match 'AzureAdJoined\\s*:\\s*YES'; Write-Output ($d -or $e)"],
  { encoding: "utf8" });
  return /True/.test(probe.stdout);
}

test("auto-install refuses an off-store package on an unmanaged PC and writes no policy", { skip: !windows }, (context) => {
  if (enrolled()) { context.skip("host is enrolled; the off-store path would legitimately proceed here"); return; }
  const root = makePackage(context, baseIds);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AUTOMATIC INSTALL NOT POSSIBLE HERE/);
  assert.match(result.stdout, /Nothing was changed/);
  assert.deepEqual(result.outcome.map((entry) => entry.Status), ["not-possible-unmanaged"]);
  const key = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "Test-Path 'HKCU:\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist'"], { encoding: "utf8" });
  assert.match(key.stdout, /False/);
});

test("auto-install -Undo is safe when nothing was installed", { skip: !windows }, (context) => {
  const root = makePackage(context, baseIds);
  const result = run(root, ["-Undo"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.outcome.map((entry) => entry.Status), ["policy-removed"]);
});

test("store mode is planned for any machine (dry check of the plan text)", { skip: !windows }, (context) => {
  // A store ID differs from the self-hosted ID; the script must choose the store route regardless of enrollment.
  const storeId = "abcdefghijklmnopabcdefghijklmnop";
  const ids = { ...baseIds, distribution: { ...baseIds.distribution, chrome: "store" },
    chromium: { ...baseIds.chromium, policyIds: { ...baseIds.chromium.policyIds, chrome: storeId } } };
  const root = makePackage(context, ids);
  // -TimeoutSeconds 3 keeps the wait short; the store install cannot succeed for a fake ID, and we undo after.
  const result = run(root, ["-TimeoutSeconds", "3"]);
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /will auto-install from the store \(ID abcdefghijklmnopabcdefghijklmnop\) - works on any computer/);
    assert.match(result.stdout, /ExtensionInstallForcelist, store/);
    assert.ok(result.outcome.some((entry) => ["pending-restart", "installed"].includes(entry.Status)));
  } finally {
    run(root, ["-Undo"]);
  }
  const key = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "Test-Path 'HKCU:\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist'"], { encoding: "utf8" });
  assert.match(key.stdout, /False/, "undo must remove the forcelist again");
});
