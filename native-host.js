const fs = require("node:fs");
const path = require("node:path");
const { createTokenFile } = require("./local-service.js");

let buffer = Buffer.alloc(0);
let queue = Promise.resolve();
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length > 65536) {
      process.stderr.write("VerifAI native request exceeds size limit.\n");
      process.exit(1);
    }
    if (buffer.length < length + 4) return;
    const payload = buffer.subarray(4, length + 4);
    buffer = buffer.subarray(length + 4);
    queue = queue.then(async () => {
      try {
        const request = JSON.parse(payload.toString("utf8"));
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, "native-allowed.json"), "utf8"));
        const caller = process.argv.slice(2);
        if (!caller.some((value) => config.includes(value))) {
          throw new Error("Unregistered browser extension.");
        }
        if (request.action === "check-update") {
          const targetFile = path.join(__dirname, "extension-update-targets.json");
          const targets = fs.existsSync(targetFile) ? JSON.parse(fs.readFileSync(targetFile, "utf8")) : [];
          const expectedPath = path.resolve(__dirname, "..", "Extensions", "chromium", "manifest.json");
          const target = targets.find((entry) => caller.includes(entry.caller) &&
            path.resolve(entry.manifestPath) === expectedPath);
          const version = target ? JSON.parse(fs.readFileSync(expectedPath, "utf8")).version : null;
          reply({ ok: true, stagedVersion: version });
          return;
        }
        if (request.action !== "connect") throw new Error("Unsupported native request.");
        const { token } = createTokenFile();
        const response = await fetch("http://127.0.0.1:43821/api/session", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) throw new Error("Local collector is unavailable.");
        const session = await response.json();
        reply({ ok: true, token, dashboardUrl: session.dashboardUrl });
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        reply({ ok: false, error: error.message });
      }
    });
  }
});

function reply(value) {
  const data = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length);
  process.stdout.write(Buffer.concat([header, data]));
}
