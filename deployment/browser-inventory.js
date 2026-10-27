const fs = require("node:fs");
const path = require("node:path");

function inventory(browser, root) {
  if (!fs.existsSync(root)) return [];
  const records = [];
  for (const profile of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const directory = path.join(root, profile.name);
    const preferenceFile = path.join(directory, browser === "Firefox" ? "extensions.json" : "Preferences");
    const secureFile = path.join(directory, "Secure Preferences");
    if (!fs.existsSync(preferenceFile) && (browser === "Firefox" || !fs.existsSync(secureFile))) continue;
    const base = { Browser: browser, Profile: profile.name, Id: null, Enabled: false, Version: null, Path: null, Incognito: null };
    try {
      const read = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) : {};
      const preferences = read(preferenceFile);
      let found = false;
      if (browser === "Firefox") {
        for (const addon of preferences.addons || []) {
          if (addon.id !== "verifai-approval-gate@example.com") continue;
          records.push({ ...base, Id: addon.id, Version: addon.version,
            Enabled: addon.active === true && !addon.userDisabled && !addon.appDisabled,
            Incognito: addon.incognito === "spanning" || addon.incognito === "split" });
          found = true;
        }
      } else {
        const ordinary = preferences.extensions?.settings || {};
        const secure = read(secureFile).extensions?.settings || {};
        for (const id of new Set([...Object.keys(ordinary), ...Object.keys(secure)])) {
          if (!/^[a-p]{32}$/.test(id)) continue;
          const entry = { ...ordinary[id], ...secure[id] };
          const extensionPath = entry.path
            ? path.isAbsolute(entry.path) ? entry.path : path.join(directory, "Extensions", entry.path)
            : null;
          const manifest = entry.manifest || (extensionPath ? read(path.join(extensionPath, "manifest.json")) : {});
          if (manifest.name !== "VerifAI Approval Gate") continue;
          // Chromium stores the per-extension "Allow in Incognito" toggle as settings.<id>.incognito.
          records.push({ ...base, Id: id, Version: manifest.version, Path: extensionPath, Enabled: entry.state === 1,
            Incognito: entry.incognito === true });
          found = true;
        }
      }
      if (!found) records.push(base);
    } catch (error) {
      records.push({ ...base, Error: `Could not inspect ${browser}/${profile.name}: ${error.message}` });
    }
  }
  return records;
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(inventory(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { inventory };
