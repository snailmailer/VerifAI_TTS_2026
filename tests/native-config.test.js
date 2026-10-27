const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeConfiguration } = require("../native-config.js");

test("repairs PowerShell wrappers into native host string arrays and preserves registered callers", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-native-config-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const origin = `chrome-extension://${"a".repeat(32)}/`;
  const firefox = "verifai-approval-gate@example.com";
  fs.writeFileSync(path.join(directory, "native-allowed.json"),
    JSON.stringify([{ value: [origin, firefox], Count: 2 }, firefox]));
  const warnings = [];
  writeConfiguration(directory, ["b".repeat(32)], (warning) => warnings.push(warning));
  const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
  assert.equal(warnings.length, 1);
  assert.deepEqual(read("native-chromium.json").allowed_origins, [origin, `chrome-extension://${"b".repeat(32)}/`]);
  assert.deepEqual(read("native-firefox.json").allowed_extensions, [firefox]);
  assert.ok(read("native-allowed.json").every((entry) => typeof entry === "string"));
  writeConfiguration(directory, []);
  assert.equal(read("native-chromium.json").allowed_origins.length, 2);
});

test("rejects unrecognized allowlist entries before overwriting configuration", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-native-invalid-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "native-allowed.json");
  fs.writeFileSync(file, '["https://untrusted.example/"]');
  assert.throws(() => writeConfiguration(directory, []), /invalid entry/);
  assert.equal(fs.readFileSync(file, "utf8"), '["https://untrusted.example/"]');
});
