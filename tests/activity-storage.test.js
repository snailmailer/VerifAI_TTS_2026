const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { activityFile, configureStorage } = require("../activity-storage.js");

test("migrates activity records without moving the private credential or deleting originals", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-storage-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "data");
  const records = [{ id: "old", site: "claude.ai" }];
  fs.writeFileSync(path.join(root, "approval-events.json"), JSON.stringify(records));
  fs.writeFileSync(path.join(root, "local-service-token"), "test-only");
  assert.equal(configureStorage(root, target), 1);
  assert.equal(activityFile(root), path.join(target, "approval-events.json"));
  assert.deepEqual(JSON.parse(fs.readFileSync(activityFile(root))), records);
  assert.equal(fs.existsSync(path.join(target, "local-service-token")), false);
  assert.equal(fs.existsSync(path.join(root, "approval-events.json")), true);
  assert.equal(configureStorage(root, target), 1);
});

test("rejects conflicting migrations without changing active storage configuration", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-storage-conflict-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "data");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(root, "approval-events.json"), '[{"id":"a","site":"claude.ai"}]');
  fs.writeFileSync(path.join(target, "approval-events.json"), '[{"id":"a","site":"other.ai"}]');
  assert.throws(() => configureStorage(root, target), /Conflicting/);
  assert.equal(activityFile(root), path.join(root, "approval-events.json"));
});
