const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createServiceServer } = require("../local-service.js");

function createWorker({ incognitoAllowed } = {}) {
  let messageListener;
  let stored = { approvalEvents: [] };
  const posted = [];
  const chrome = {
    runtime: {
      getURL: (file) => `chrome-extension://${"a".repeat(32)}/${file}`,
      getManifest: () => ({ version: "0.5.5" }),
      sendNativeMessage(host, request, callback) { callback({ ok: true, token: "t".repeat(40), dashboardUrl: "http://127.0.0.1:43821/#ticket=x" }); },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    extension: incognitoAllowed === undefined ? undefined : {
      isAllowedIncognitoAccess: (callback) => callback(incognitoAllowed)
    },
    declarativeNetRequest: { getEnabledRulesets: async () => ["ai_blocklist"], getDynamicRules: async () => [], updateDynamicRules: async () => {} },
    storage: { local: {
      async get(defaults) { return structuredClone({ ...defaults, ...stored }); },
      async set(values) { stored = structuredClone({ ...stored, ...values }); }
    } },
    tabs: { async remove() {}, query: async () => [], update: async () => {} }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), {
    chrome, URL, Promise, Set, AbortSignal, VerifAIPolicy: require("../ai-policy.js"),
    VerifAIBrowser: { detectBrowser: async () => "Edge" },
    VerifAIRedactionMetadata: require("../redaction-metadata.js"),
    fetch: async (url, options) => { posted.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
    console: { ...console, error() {} }
  });
  return {
    send: (message, sender) => new Promise((resolve) => messageListener(message, sender, resolve)),
    events: () => stored.approvalEvents,
    posted
  };
}

test("events from a private window carry privateWindow=true from the browser-supplied tab flag, never from content", async () => {
  const worker = createWorker({ incognitoAllowed: true });
  await worker.send({ type: "verifai:ai-activity", event: { eventId: "v-private", site: "gemini.google.com", action: "visit", agentName: "Gemini", privateWindow: false } },
    { url: "https://gemini.google.com/app", tab: { id: 1, incognito: true } });
  await worker.send({ type: "verifai:ai-activity", event: { eventId: "v-normal", site: "gemini.google.com", action: "visit", agentName: "Gemini", privateWindow: true } },
    { url: "https://gemini.google.com/app", tab: { id: 2, incognito: false } });
  const byId = Object.fromEntries(worker.events().map((event) => [event.id, event]));
  assert.equal(byId["v-private"].privateWindow, true);
  assert.equal(byId["v-normal"].privateWindow, false, "a page cannot claim to be private");
  assert.deepEqual(worker.posted.map((body) => body.event.privateWindow), [true, false]);
});

test("diagnostics report whether the browser allows VerifAI in private windows", async () => {
  for (const [allowed, expected] of [[true, true], [false, false], [undefined, null]]) {
    const worker = createWorker({ incognitoAllowed: allowed });
    const result = await worker.send({ type: "verifai:diagnostics" }, { url: `chrome-extension://${"a".repeat(32)}/dashboard.html` });
    assert.equal(result.incognitoAllowed, expected, `allowed=${allowed}`);
  }
});

test("collector stores the private-window flag, rejects non-boolean values and keeps legacy records untouched", async (context) => {
  const token = "private-window-test-token-at-least-32-characters-long";
  const server = createServiceServer({ token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ token, ...body }) });
  assert.equal((await post({ event: { eventId: "p1", site: "claude.ai", browser: "Chrome", action: "block", privateWindow: true } })).status, 200);
  assert.equal((await post({ event: { eventId: "p2", site: "claude.ai", browser: "Chrome", action: "block" } })).status, 200);
  assert.equal((await post({ event: { eventId: "p3", site: "claude.ai", browser: "Chrome", action: "block", privateWindow: "yes" } })).status, 400);
  const data = await (await fetch(`${base}/api/events/query`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ token }) })).json();
  const byId = Object.fromEntries(data.events.map((event) => [event.id, event]));
  assert.equal(byId.p1.privateWindow, true);
  assert.equal("privateWindow" in byId.p2, false);
});

test("manifest declares spanning incognito mode so one worker serves normal and private windows", () => {
  const manifest = require("../manifest.json");
  assert.equal(manifest.incognito, "spanning");
});
