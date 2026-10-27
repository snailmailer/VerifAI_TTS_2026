const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function createHost(caller, stagedVersion) {
  const stdin = new EventEmitter();
  const chunks = [];
  const errors = [];
  vm.runInNewContext(fs.readFileSync(require.resolve("../native-host.js"), "utf8"), {
    Buffer,
    Promise,
    AbortSignal,
    __dirname,
    require(name) {
      if (name === "node:fs") return {
        existsSync: () => Boolean(stagedVersion),
        readFileSync(filename) {
          if (filename.endsWith("extension-update-targets.json")) {
            return JSON.stringify([{
              caller: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
              manifestPath: require("node:path").resolve(__dirname, "..", "Extensions", "chromium", "manifest.json")
            }]);
          }
          if (filename.endsWith("manifest.json")) return JSON.stringify({ version: stagedVersion });
          return JSON.stringify(["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]);
        }
      };
      if (name === "./local-service.js") return {
        createTokenFile: () => ({ token: "test-secret" })
      };
      return require(name);
    },
    process: {
      stdin,
      stdout: { write: (chunk) => chunks.push(chunk) },
      stderr: { write: (message) => errors.push(message) },
      argv: ["node", "native-host.js", caller],
      exit: () => { throw new Error("Host exited."); }
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ dashboardUrl: "http://127.0.0.1:43821/#ticket=test" })
    })
  });
  return {
    async request(value) {
      const data = Buffer.from(JSON.stringify(value));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(data.length);
      stdin.emit("data", header.subarray(0, 2));
      stdin.emit("data", Buffer.concat([header.subarray(2), data]));
      await new Promise((resolve) => setImmediate(resolve));
      const output = Buffer.concat(chunks);
      assert.equal(output.readUInt32LE(0), output.length - 4);
      return JSON.parse(output.subarray(4).toString());
    },
    errors
  };
}

test("native protocol authenticates registered callers and handles fragmented frames", async () => {
  const host = createHost("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/");
  const response = await host.request({ action: "connect" });
  assert.equal(response.ok, true);
  assert.equal(response.token, "test-secret");
  assert.match(response.dashboardUrl, /#ticket=/);
});

test("native protocol rejects unrelated extension callers without returning a credential", async () => {
  const host = createHost("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/");
  const response = await host.request({ action: "connect" });
  assert.equal(response.ok, false);
  assert.equal(response.token, undefined);
  assert.match(response.error, /Unregistered/);
});

test("native staged-update check returns no credential and requires registration", async () => {
  const host = createHost("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/");
  const result = await host.request({ action: "check-update" });
  assert.equal(result.ok, true);
  assert.equal(result.stagedVersion, null);
  assert.equal(result.token, undefined);
});

test("native staged-update check reads only the installer-mapped stable manifest", async () => {
  const host = createHost("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", "0.4.2");
  const result = await host.request({ action: "check-update" });
  assert.equal(result.ok, true);
  assert.equal(result.stagedVersion, "0.4.2");
  assert.equal(result.token, undefined);
});
