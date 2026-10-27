const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createWorker({ statuses }) {
  let messageListener;
  let stored = { approvalEvents: [] };
  const calls = { native: 0, fetch: 0, alarms: [] };
  const chrome = {
    runtime: {
      getURL: (file) => `chrome-extension://${"a".repeat(32)}/${file}`,
      sendNativeMessage(host, request, callback) {
        calls.native += 1;
        callback({ ok: true, token: `token-${calls.native}`, dashboardUrl: "http://127.0.0.1:43821/#ticket=x" });
      },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    storage: { local: {
      async get(defaults) { return structuredClone({ ...defaults, ...stored }); },
      async set(values) { stored = structuredClone({ ...stored, ...values }); }
    } },
    alarms: { create(name, info) { calls.alarms.push({ name, ...info }); }, onAlarm: { addListener() {} } },
    tabs: { async remove() {} }
  };
  const fetch = async (url, options) => {
    calls.fetch += 1;
    const status = statuses.length ? statuses.shift() : 200;
    const body = JSON.parse(options.body);
    calls.lastToken = body.token;
    return { ok: status === 200, status, json: async () => ({ ok: status === 200 }) };
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), {
    chrome, URL, Promise, Set, AbortSignal, VerifAIPolicy: require("../ai-policy.js"),
    VerifAIBrowser: { detectBrowser: async () => "Chrome" },
    VerifAIRedactionMetadata: require("../redaction-metadata.js"),
    fetch, console: { ...console, error() {} }
  });
  const send = (eventId) => new Promise((resolve) => messageListener({
    type: "verifai:ai-activity",
    event: { eventId, site: "gemini.google.com", action: "visit", agentName: "Gemini" }
  }, { url: "https://gemini.google.com/app", tab: { id: 1 } }, resolve));
  return { send, calls, pending: () => stored.pendingSharedEvents || [] };
}

test("JIT events reuse one native connection per worker lifetime and deliver immediately", async () => {
  const worker = createWorker({ statuses: [] });
  for (let index = 0; index < 5; index += 1) {
    const response = await worker.send(`visit-${index}`);
    assert.equal(response.shared, true, "each event is delivered before the content script gets its reply");
  }
  assert.equal(worker.calls.fetch, 5);
  assert.equal(worker.calls.native, 1, "native host spawned once, not once per event");
  assert.equal(worker.pending().length, 0);
  assert.deepEqual(worker.calls.alarms.filter((alarm) => alarm.name === "verifai:retry"), []);
});

test("a 401 after a collector restart refreshes the credential once and still delivers", async () => {
  const worker = createWorker({ statuses: [200, 401, 200] });
  assert.equal((await worker.send("a")).shared, true);
  assert.equal((await worker.send("b")).shared, true);
  assert.equal(worker.calls.native, 2);
  assert.equal(worker.calls.lastToken, "token-2");
  assert.equal(worker.pending().length, 0);
});

test("a failed delivery schedules a 30-second fast retry and keeps the event queued", async () => {
  const worker = createWorker({ statuses: [503] });
  const response = await worker.send("c");
  assert.equal(response.shared, false);
  assert.equal(worker.pending().length, 1);
  const retry = worker.calls.alarms.find((alarm) => alarm.name === "verifai:retry");
  assert.ok(retry);
  assert.equal(retry.delayInMinutes, 0.5);
});
