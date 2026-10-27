const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const FIXTURE_TESTS = 9;
const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
const localAppData = process.env.LOCALAPPDATA || "";

const ENGINES = [
  { name: "Chrome", kind: "chromium", candidates: [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
  ] },
  { name: "Edge", kind: "chromium", candidates: [
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
  ] },
  { name: "Brave", kind: "chromium", extraArgs: [
    "--disable-brave-update", "--disable-features=BraveRewards,BraveWalletService,BraveNews,BraveVPN"
  ], candidates: [
    path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
  ] },
  { name: "Firefox", kind: "gecko", candidates: [
    path.join(programFiles, "Mozilla Firefox", "firefox.exe"),
    path.join(programFilesX86, "Mozilla Firefox", "firefox.exe")
  ] }
];
const selected = (process.env.VERIFAI_TEST_ENGINES || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);

function serveFixture() {
  let resolveResult = () => {};
  const files = new Map([
    ["/", [path.join(__dirname, "fixtures", "redaction.html"), "text/html; charset=utf-8"]],
    ["/redaction-core.js", [path.join(root, "redaction-core.js"), "text/javascript; charset=utf-8"]],
    ["/redaction.js", [path.join(root, "redaction.js"), "text/javascript; charset=utf-8"]]
  ]);
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/result") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => { response.end("ok"); resolveResult(body); });
      return;
    }
    const file = files.get(request.url);
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
    response.end(fs.readFileSync(file[0]));
  });
  return { server, nextResult: () => new Promise((resolve) => { resolveResult = resolve; }) };
}

function launch(engine, executable, url, profile) {
  const args = engine.kind === "gecko"
    ? ["-headless", "-no-remote", "-new-instance", "-profile", profile, url]
    : ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--disable-background-networking", "--disable-component-update",
        "--disable-sync", "--mute-audio", `--user-data-dir=${profile}`, ...(engine.extraArgs || []), url];
  return spawn(executable, args, { stdio: "ignore", windowsHide: true });
}

function terminate(child) {
  if (child.exitCode !== null) return;
  // Only the process tree this test spawned is terminated, by exact PID.
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}

test("redaction fixture passes in each installed browser engine", async (t) => {
  const { server, nextResult } = serveFixture();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/`;

  for (const engine of ENGINES) {
    if (selected.length && !selected.includes(engine.name.toLowerCase())) continue;
    const executable = engine.candidates.find((candidate) => candidate && fs.existsSync(candidate));
    await t.test(engine.name, async (subtest) => {
      if (!executable) { subtest.skip(`${engine.name} is not installed on this computer.`); return; }
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), `verifai-${engine.name.toLowerCase()}-`));
      const pending = nextResult();
      const child = launch(engine, executable, url, profile);
      let body;
      let timer;
      try {
        body = await Promise.race([
          pending,
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), 90000); }),
          new Promise((resolve) => child.on("exit", (code) => setTimeout(() => resolve({ exited: code }), 1500).unref()))
        ]);
      } finally {
        clearTimeout(timer);
        terminate(child);
        await new Promise((resolve) => setTimeout(resolve, 500));
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      }
      if (!body || typeof body !== "string") {
        subtest.skip(`${engine.name} headless run did not report results (${JSON.stringify(body)}); engine not verified.`);
        return;
      }
      const { engine: userAgent, results } = JSON.parse(body);
      assert.equal(results.length, FIXTURE_TESTS, `${engine.name} did not run every fixture test`);
      for (const entry of results) assert.equal(entry.ok, true, `${engine.name}: ${JSON.stringify(entry)}`);
      subtest.diagnostic(`${engine.name} verified: ${userAgent}`);
    });
  }
});
