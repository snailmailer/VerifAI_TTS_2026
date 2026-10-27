const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("signed-out dashboard explains authentication and pauses polling", async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { addEventListener() {}, textContent: "" });
    return elements.get(id);
  };
  let poll;
  let requests = 0;
  const context = vm.createContext({
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
      hidden: false
    },
    window: {
      location: { hash: "" },
      addEventListener() {},
      setInterval(callback) { poll = callback; }
    },
    URLSearchParams,
    fetch: async () => {
      requests++;
      return { status: 401, ok: false, json: async () => ({ error: "Invalid service token." }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "dashboard.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.match(element("connection-status").textContent, /Dashboard sign-in required or expired/);
  await poll();
  await poll();
  assert.equal(requests, 1);
  context.clearTimeout = () => {};
  context.window.setTimeout = () => 1;
  vm.runInContext(`hasLoadedSharedEvents = true; events = [];
    announceNewEvents([{id: "jit-test", eventType: "PII redaction", editApplied: false}]);`, context);
  assert.match(element("live-announcement").textContent, /JIT PII alert/);
  assert.match(element("live-announcement").textContent, /1 editor edit/);
  assert.equal(element("live-announcement").hidden, false);
});
