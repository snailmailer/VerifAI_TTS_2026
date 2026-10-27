const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inventory } = require("../deployment/browser-inventory.js");

test("inventory tolerates case-distinct unrelated Edge keys and merges extension metadata", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-profile-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "Default");
  fs.mkdirSync(directory);
  const id = "a".repeat(32);
  fs.writeFileSync(path.join(directory, "Preferences"), JSON.stringify({
    unrelated: { key: 1, Key: 2 },
    extensions: { settings: { [id]: { manifest: { name: "VerifAI Approval Gate", version: "0.4.1" } } } }
  }));
  fs.writeFileSync(path.join(directory, "Secure Preferences"), JSON.stringify({
    extensions: { settings: { [id]: { state: 1, path: "unpacked" } } }
  }));
  const records = inventory("Edge", root);
  assert.equal(records.length, 1);
  assert.equal(records[0].Id, id);
  assert.equal(records[0].Enabled, true);
  assert.equal(records[0].Version, "0.4.1");
  assert.equal(records[0].Error, undefined);
  assert.equal(records[0].Incognito, false, "no incognito flag means private windows are not covered");
});

test("inventory reports the per-extension private-window permission for Chromium and Firefox", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-incognito-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const chrome = path.join(root, "chrome", "Profile 1");
  fs.mkdirSync(chrome, { recursive: true });
  const id = "b".repeat(32);
  fs.writeFileSync(path.join(chrome, "Preferences"), "{}");
  fs.writeFileSync(path.join(chrome, "Secure Preferences"), JSON.stringify({
    extensions: { settings: { [id]: { state: 1, path: "unpacked", incognito: true, manifest: { name: "VerifAI Approval Gate", version: "0.5.5" } } } }
  }));
  const chromeRecords = inventory("Chrome", path.join(root, "chrome"));
  assert.equal(chromeRecords[0].Incognito, true);

  const firefox = path.join(root, "firefox", "abc.default-release");
  fs.mkdirSync(firefox, { recursive: true });
  fs.writeFileSync(path.join(firefox, "extensions.json"), JSON.stringify({ addons: [
    { id: "verifai-approval-gate@example.com", version: "0.5.5", active: true, userDisabled: false, appDisabled: false, incognito: "spanning" }
  ] }));
  const firefoxRecords = inventory("Firefox", path.join(root, "firefox"));
  assert.equal(firefoxRecords[0].Incognito, true);
  fs.writeFileSync(path.join(firefox, "extensions.json"), JSON.stringify({ addons: [
    { id: "verifai-approval-gate@example.com", version: "0.5.5", active: true, userDisabled: false, appDisabled: false, incognito: "not_allowed" }
  ] }));
  assert.equal(inventory("Firefox", path.join(root, "firefox"))[0].Incognito, false);
});
