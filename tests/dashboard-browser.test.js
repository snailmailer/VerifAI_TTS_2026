const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("dashboard displays browser on every row and export, replacing the old metric", async () => {
  const elements = new Map();
  const createElement = () => ({
    value: "", children: [], textContent: "", hidden: false,
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    click() {}
  });
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    if (id === "redaction-panel") elements.get(id).hidden = true;
    return elements.get(id);
  };
  const records = [
    { id: "a", site: "huggingface.co", status: "blocked", browser: "Brave", timestamp: "2026-10-25T12:00:00Z" },
    { id: "b", site: "claude.ai", status: "opened", timestamp: "2026-10-24T12:00:00Z" }
  ];
  let csv;
  const context = vm.createContext({
    document: {
      getElementById: get, createElement, querySelectorAll: () => [], addEventListener() {}
    },
    window: { location: { hash: "" }, setInterval() {}, addEventListener() {} },
    URLSearchParams,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, events: records }) }),
    URL: { createObjectURL(blob) { csv = blob.content; return "blob:test"; }, revokeObjectURL() {} },
    Blob: class { constructor(parts) { this.content = parts.join(""); } }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../dashboard.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  const rows = get("events-body").children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[3].textContent, "Brave");
  assert.equal(rows[1].children[3].textContent, "Unknown (legacy)");
  assert.equal(get("blocked-count").textContent, "1");
  assert.equal(elements.has("opened-count"), false);
  get("export-csv").listeners.click();
  assert.match(csv, /"site","browser","privateWindow","outcome"/);
  assert.match(csv, /"Brave"/);
  assert.match(csv, /"Unknown \(legacy\)"/);
  assert.doesNotMatch(csv, /Opened approved agent/);
  get("filter-site").value = "brave";
  get("filter-site").listeners.input();
  assert.equal(get("events-body").children.length, 1);
});
