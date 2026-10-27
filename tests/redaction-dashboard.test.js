const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("SWC tab switches by mouse/keyboard and renders metadata-only records", () => {
  const nodes = new Map();
  const make = () => ({
    hidden: false, value: "", textContent: "", children: [], listeners: {}, attributes: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    focus() {}
  });
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../redaction-dashboard.js"), "utf8"), {
    window, document: { getElementById: get, createElement: make }
  });
  window.VerifAIRedactionDashboard.render([
    { id: "a", timestamp: "2026-10-25T22:00:00Z", eventType: "PII redaction", site: "gemini.google.com", browser: "Edge", categories: ["email address"], redactionCount: 2, editApplied: true },
    { id: "b", timestamp: "2026-10-25T21:00:00Z", eventType: "PII redaction", site: "copilot.com", categories: ["name"], redactionCount: 1, editApplied: false },
    { id: "c", eventType: "AI site visit" }
  ]);
  assert.equal(get("redaction-total").textContent, "2");
  assert.equal(get("redaction-events-body").children.length, 2);
  assert.equal(get("redaction-events-body").children[0].children[2].textContent, "Edge");
  assert.match(get("redaction-events-body").children[1].children[5].textContent, /do not send/);
  get("redaction-tab").listeners.click();
  assert.equal(get("activity-panel").hidden, true);
  assert.equal(get("redaction-panel").hidden, false);
  get("redaction-filter").value = "edge";
  get("redaction-filter").listeners.input();
  assert.equal(get("redaction-events-body").children.length, 1);
  get("redaction-tab").listeners.keydown({ key: "ArrowLeft", preventDefault() {} });
  assert.equal(get("activity-panel").hidden, false);
});
