#!/usr/bin/env node
// VerifAI Standalone setup: one entry point for Windows, macOS and Linux.
// Detects the OS and installed browsers, guides the user through loading the
// extension with precise numbered steps, waits for each browser to save the
// extension ID, installs the per-user collector and native bridge, registers the
// IDs and verifies health. Nothing is force-installed; no browser preferences are edited.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");
const { spawnSync } = require("node:child_process");
const { detect, profileRoots } = require("./deployment/detect-extension-ids.js");
const { BROWSER_PAGES, PRIVATE_TOGGLE, stepsFor, privateWindowSteps, finishSteps, showDialog, setClipboard } = require("./deployment/setup-guide.js");

const here = __dirname;
const platform = process.platform;
const osName = { win32: "Windows", darwin: "macOS", linux: "Linux" }[platform] || platform;

const BROWSERS = {
  Chrome: { win: ["Google\\Chrome\\Application\\chrome.exe"], mac: "Google Chrome", linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] },
  Edge: { win: ["Microsoft\\Edge\\Application\\msedge.exe"], mac: "Microsoft Edge", linux: ["microsoft-edge", "microsoft-edge-stable"] },
  Brave: { win: ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"], mac: "Brave Browser", linux: ["brave-browser", "brave"] },
  Firefox: { win: ["Mozilla Firefox\\firefox.exe"], mac: "Firefox", linux: ["firefox", "firefox-esr"] },
  Safari: { mac: "Safari" }
};

function which(command) {
  const result = spawnSync(platform === "win32" ? "where" : "which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/)[0].trim() : null;
}

function installedBrowsers() {
  const found = {};
  for (const [name, spec] of Object.entries(BROWSERS)) {
    let executable = null;
    if (platform === "win32") {
      const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
      for (const rootDir of roots) for (const relative of spec.win || []) {
        const candidate = path.join(rootDir, relative);
        if (fs.existsSync(candidate)) { executable = candidate; break; }
      }
    } else if (platform === "darwin") {
      if (!spec.mac) continue;
      for (const base of ["/Applications", path.join(os.homedir(), "Applications")]) {
        const app = path.join(base, `${spec.mac}.app`);
        if (fs.existsSync(app)) { executable = app; break; }
      }
    } else {
      for (const command of spec.linux || []) { executable = which(command); if (executable) break; }
    }
    if (executable) found[name] = { executable, page: BROWSER_PAGES[name] || null, profiles: profileRoots()[name] };
  }
  return found;
}

function openExtensionsPage(name, browser) {
  if (!browser.page) return false;
  try {
    if (platform === "darwin") spawnSync("open", ["-a", BROWSERS[name].mac, browser.page], { stdio: "ignore" });
    else spawnSync(browser.executable, [browser.page], { detached: true, stdio: "ignore" });
    return true;
  } catch { return false; }
}

function stagedFolders() {
  // Stable per-user folders: the extension keeps working after the USB/package is removed
  // and the running extension can detect staged updates from here.
  const base = platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "VerifAI", "Extensions")
    : path.join(os.homedir(), ".local", "share", "VerifAI", "Extensions");
  return { chromium: path.join(base, "chromium"), firefox: path.join(base, "firefox") };
}

function stageExtension(folders) {
  for (const [kind, target] of Object.entries(folders)) {
    const source = path.join(here, `extension-${kind}`);
    if (!fs.existsSync(source)) throw new Error(`Package is incomplete: ${source} is missing.`);
    fs.mkdirSync(target, { recursive: true });
    const files = fs.readdirSync(source).sort((left, right) => (left === "manifest.json") - (right === "manifest.json"));
    for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
}

function verifaiRecords() {
  return detect().installed.filter((record) => /^[a-p]{32}$/.test(record.Id || ""));
}

async function waitForNewRecords(knownIds, seconds) {
  const deadline = Date.now() + seconds * 1000;
  do {
    const fresh = verifaiRecords().filter((record) => !knownIds.has(record.Id));
    if (fresh.length) return fresh;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (Date.now() < deadline);
  return [];
}

function isRemovable(filePath) {
  if (!filePath) return false;
  if (platform === "darwin") return filePath.startsWith("/Volumes/");
  if (platform === "linux") return /^\/(media|mnt|run\/media)\//.test(filePath);
  return false;
}

function runInstaller(ids, eventLogsDirectory, nodeExecutable) {
  const runtime = path.join(here, "runtime");
  if (platform === "win32") {
    const script = path.join(runtime, "install-windows.ps1");
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    let command = `& ${quote(script)} -UpgradeInstalledCollector -NodePath ${quote(nodeExecutable)}`;
    if (ids.length) command += ` -ChromiumExtensionIds @(${ids.map(quote).join(",")})`;
    if (eventLogsDirectory) command += ` -EventLogsDirectory ${quote(eventLogsDirectory)}`;
    return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "inherit" }).status === 0;
  }
  const script = path.join(here, "deployment", platform === "darwin" ? "install-macos.js" : "install-linux.js");
  return spawnSync(nodeExecutable, [script, ...ids], { stdio: "inherit", env: { ...process.env, VERIFAI_EVENT_LOGS: eventLogsDirectory || "" } }).status === 0;
}

// --repair: register every VerifAI copy already loaded in the browsers and restart the collector,
// without opening browsers or asking questions. Used after loading the extension in a new browser.
async function repair() {
  console.log(`\nVerifAI repair - ${osName}\n`);
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Node.js 22+ is required (running ${process.versions.node}).`);
  const folders = stagedFolders();
  if (fs.existsSync(path.join(here, "extension-chromium"))) stageExtension(folders);
  const records = verifaiRecords();
  const ids = [...new Set(records.map((record) => record.Id))];
  for (const record of records) {
    console.log(`Found: ${record.Browser}/${record.Profile} -> ${record.Id} (v${record.Version}) at ${record.Path || "?"}`);
    if (isRemovable(record.Path) || (record.Path && record.Path.startsWith(here))) {
      console.log(`  WARNING: loaded from ${record.Path}; it stops working when that folder/drive is removed. Load ${folders.chromium} instead.`);
    }
  }
  if (!ids.length) {
    console.log("No VerifAI extension found in Chrome, Edge or Brave yet. Load it from:");
    console.log(`  ${folders.chromium}`);
    console.log("then run this repair again.");
  }
  console.log("\nRegistering with the local bridge and restarting the collector...");
  if (!runInstaller(ids, null, process.execPath)) throw new Error("Installer reported a failure; see the output above.");
  console.log(`\nDone. Registered ${ids.length} browser extension ID(s). Reload the VerifAI extension once in each browser.`);
}

async function main() {
  if (process.argv.includes("--repair")) return repair();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question, fallback) => ((await rl.question(`${question} [${fallback}] `)).trim() || fallback);
  try {
    console.log(`\nVerifAI Standalone setup - ${osName}\n`);
    if (!["win32", "darwin", "linux"].includes(platform)) throw new Error("Standalone setup supports Windows, macOS and Linux. Use the Enterprise package for iOS/Android.");
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 22) throw new Error(`Node.js 22+ is required (running ${process.versions.node}). See README.md for the one-line install command for ${osName}.`);

    const browsers = installedBrowsers();
    const names = Object.keys(browsers);
    if (!names.length) throw new Error("No supported browser was detected (Chrome, Edge, Brave, Firefox, Safari). Install one and re-run.");
    console.log("Detected browsers:");
    names.forEach((name, index) => console.log(`  ${index + 1}. ${name}`));
    const pick = await ask("Which browsers to set up? (comma-separated numbers or 'all')", "all");
    const selected = pick === "all" ? names : pick.split(",").map((value) => names[Number(value.trim()) - 1]).filter(Boolean);
    if (!selected.length) throw new Error("No browser selected.");

    const logs = await ask("Folder for daily JSON/PDF event logs", path.join(os.homedir(), "VerifAI", "EVENT LOGS"));

    const folders = stagedFolders();
    stageExtension(folders);
    console.log(`\nExtension staged in ${path.dirname(folders.chromium)}`);

    const known = new Set(verifaiRecords().map((record) => record.Id));
    const ids = new Set(known);
    for (const record of verifaiRecords()) {
      console.log(`Already present: ${record.Browser}/${record.Profile} -> ${record.Id} (v${record.Version})`);
    }

    // Windows: try the automatic (policy-based) install first. It installs by itself on enrolled
    // machines or when store IDs are configured; otherwise it reports why and we fall back to the
    // guided Load-unpacked steps for those browsers. The user watches and can cancel in its window.
    const autoDone = new Set();
    const autoPs1 = path.join(here, "deployment", "auto-install-extension.ps1");
    const chromiumSelected = selected.filter((name) => ["Chrome", "Edge", "Brave"].includes(name));
    if (platform === "win32" && chromiumSelected.length && fs.existsSync(autoPs1)) {
      console.log("\nTrying automatic installation (browser policy) first...");
      const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
      const command = `& ${quote(autoPs1)} -PackageRoot ${quote(here)} -Browsers @(${chromiumSelected.map(quote).join(",")})`;
      const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      const lastLine = (run.stdout || "").trim().split(/\r?\n/).pop() || "[]";
      let outcome = [];
      try { outcome = JSON.parse(lastLine); if (!Array.isArray(outcome)) outcome = [outcome]; } catch { outcome = []; }
      for (const entry of outcome) {
        if (["installed", "already-installed", "pending-restart"].includes(entry.Status)) {
          autoDone.add(entry.Browser);
          if (/^[a-p]{32}$/.test(entry.Id || "")) ids.add(entry.Id);
        }
      }
      if (autoDone.size) console.log(`Automatically installed in: ${[...autoDone].join(", ")}`);
      const remaining = chromiumSelected.filter((name) => !autoDone.has(name));
      if (remaining.length) console.log(`Guided steps will follow for: ${remaining.join(", ")}`);
    }

    for (const [index, name] of selected.entries()) {
      if (autoDone.has(name)) continue;
      const browser = browsers[name];
      const steps = stepsFor(name, { chromiumFolder: folders.chromium, firefoxManifest: path.join(folders.firefox, "manifest.json") });
      if (name === "Safari") { showDialog(`Step ${index + 1} of ${selected.length} - Safari`, steps); continue; }
      setClipboard(name === "Firefox" ? path.join(folders.firefox, "manifest.json") : folders.chromium);
      openExtensionsPage(name, browser);
      showDialog(`Step ${index + 1} of ${selected.length} - ${name}`, steps);
      await rl.question(`Press Enter after VerifAI is loaded and enabled in ${name}... `);
      if (name === "Firefox") continue;
      process.stdout.write(`Waiting for ${name} to save the extension ID`);
      const fresh = await waitForNewRecords(ids, 30);
      console.log("");
      if (fresh.length) {
        for (const record of fresh) {
          ids.add(record.Id);
          console.log(`  ${record.Browser}/${record.Profile}: ID ${record.Id}`);
          if (isRemovable(record.Path) || (record.Path && record.Path.startsWith(here))) {
            console.log(`  WARNING: loaded from ${record.Path}. It will stop working when that drive/folder is removed.`);
            console.log(`  Fix: Remove it on the extensions page, then Load unpacked -> ${folders.chromium} and re-run setup.`);
          }
        }
      } else {
        const typed = await ask(`${name}: no new ID detected. Paste the 32-letter ID shown under VerifAI (or leave blank to skip)`, "");
        if (/^[a-p]{32}$/.test(typed)) ids.add(typed); else console.log(`  ${name}: skipped.`);
      }
    }

    // Private-window coverage: browsers require the user to allow it per extension; verify and guide.
    const coverage = [];
    const chromiumNames = selected.filter((name) => ["Chrome", "Edge", "Brave"].includes(name));
    for (const name of chromiumNames) {
      const records = () => verifaiRecords().filter((record) => record.Browser === name);
      if (!records().length) { coverage.push({ browser: name, covered: null }); continue; }
      let covered = records().every((record) => record.Incognito === true);
      for (let attempt = 0; attempt < 3 && !covered; attempt += 1) {
        openExtensionsPage(name, browsers[name]);
        showDialog(`Private windows - ${name}`, privateWindowSteps(name));
        await rl.question(`Press Enter after "${PRIVATE_TOGGLE[name]}" is ON in ${name} (or Enter to skip)... `);
        process.stdout.write(`Checking ${name}`);
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          covered = records().every((record) => record.Incognito === true);
          if (covered) break;
          process.stdout.write(".");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        console.log("");
        if (covered) { console.log(`  ${name}: private windows covered.`); break; }
        const again = await ask(`  ${name}: still not allowed in private windows. R = re-check, Enter = continue without it`, "");
        if (!/^r$/i.test(again)) break;
      }
      coverage.push({ browser: name, covered });
    }
    if (selected.includes("Firefox")) {
      const firefox = verifaiRecords().filter((record) => record.Browser === "Firefox");
      coverage.push({ browser: "Firefox", covered: firefox.length ? firefox.every((record) => record.Incognito === true) : null });
    }

    console.log("\nInstalling the local collector and native bridge...");
    if (!runInstaller([...ids], logs, process.execPath)) throw new Error("Installer reported a failure; see the output above.");

    showDialog("VerifAI - finished", finishSteps(`Daily logs: ${logs}  (one JSON + one PDF per day, in <year>/<Mon-year> folders).`, coverage));
    console.log("Re-run this setup any time to add browsers or apply a newer version; existing records are kept.");
  } finally {
    rl.close();
  }
}

main().catch((error) => { console.error(`\n${error.message}`); process.exitCode = 1; });
