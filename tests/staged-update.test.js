const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("stable-folder update reloads once then reports an activation failure instead of looping", async () => {
  const stored = {};
  let reloads = 0;
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        getManifest: () => ({ version: "0.4.1" }),
        sendNativeMessage(host, request, callback) {
          assert.equal(request.action, "check-update");
          callback({ ok: true, stagedVersion: "0.4.2" });
        },
        reload: () => { reloads++; }
      },
      storage: { local: {
        get: async (defaults) => ({ ...defaults, ...stored }),
        set: async (values) => Object.assign(stored, values)
      } }
    },
    VerifAIPolicy: require("../ai-policy.js"),
    console: { error() {} }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloads, 1);
  await vm.runInContext("checkStagedUpdate()", context);
  assert.equal(reloads, 1);
  assert.match(stored.stagedUpdateError, /approve new permissions/);
});

test("an unregistered browser copy gets repair guidance and is logged once, not every minute", async () => {
  const stored = {};
  const logged = [];
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        getManifest: () => ({ version: "0.5.4" }),
        lastError: null,
        sendNativeMessage(host, request, callback) {
          context.chrome.runtime.lastError = { message: "Access to the specified native messaging host is forbidden." };
          callback(undefined);
          context.chrome.runtime.lastError = null;
        },
        reload: () => { throw new Error("must not reload"); }
      },
      storage: { local: {
        get: async (defaults) => ({ ...defaults, ...stored }),
        set: async (values) => Object.assign(stored, values)
      } }
    },
    VerifAIPolicy: require("../ai-policy.js"),
    console: { error: (...args) => logged.push(args.join(" ")) }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  await vm.runInContext("checkStagedUpdate()", context);
  await vm.runInContext("checkStagedUpdate()", context);
  assert.match(stored.stagedUpdateError, /forbidden/);
  assert.match(stored.stagedUpdateError, /Repair-VerifAI\.cmd/);
  assert.match(stored.stagedUpdateError, /repair\.sh/);
  assert.equal(logged.filter((line) => line.includes("staged update could not activate")).length, 1);
});

test("toolbar click falls back to the local dashboard with repair + reload guidance when the bridge refuses", async () => {
  const stored = {};
  const logged = [];
  let clickHandler;
  let optionsOpened = 0;
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        getManifest: () => ({ version: "0.5.4" }),
        lastError: null,
        sendNativeMessage(host, request, callback) {
          context.chrome.runtime.lastError = { message: "Access to the specified native messaging host is forbidden." };
          callback(undefined);
          context.chrome.runtime.lastError = null;
        },
        openOptionsPage: async () => { optionsOpened += 1; }
      },
      action: { onClicked: { addListener(handler) { clickHandler = handler; } } },
      tabs: { create: async () => { throw new Error("must not open a dashboard tab"); } },
      storage: { local: {
        get: async (defaults) => ({ ...defaults, ...stored }),
        set: async (values) => Object.assign(stored, values)
      } }
    },
    VerifAIPolicy: require("../ai-policy.js"),
    console: { error: (...args) => logged.push(args.join(" ")) }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  await clickHandler();
  assert.equal(optionsOpened, 1);
  assert.match(stored.bridgeError, /forbidden/);
  assert.match(stored.bridgeError, /RELOAD the extension/);
  assert.match(stored.bridgeError, /repair\.sh/);
  assert.ok(logged.some((line) => line.includes("standalone dashboard") && line.includes("Repair-VerifAI.cmd")));
});
