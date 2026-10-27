const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inventory } = require("./browser-inventory.js");
const { GECKO_ID, chromiumIdFromKeyPem } = require("./extension-id.js");

// Per-platform profile roots where installed browser extensions can be inspected.
function profileRoots() {
  const home = os.homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return {
      Chrome: path.join(local, "Google", "Chrome", "User Data"),
      Edge: path.join(local, "Microsoft", "Edge", "User Data"),
      Brave: path.join(local, "BraveSoftware", "Brave-Browser", "User Data"),
      Firefox: path.join(roaming, "Mozilla", "Firefox", "Profiles")
    };
  }
  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return {
      Chrome: path.join(support, "Google", "Chrome"),
      Edge: path.join(support, "Microsoft Edge"),
      Brave: path.join(support, "BraveSoftware", "Brave-Browser"),
      Firefox: path.join(support, "Firefox", "Profiles")
    };
  }
  return {
    Chrome: path.join(home, ".config", "google-chrome"),
    Edge: path.join(home, ".config", "microsoft-edge"),
    Brave: path.join(home, ".config", "BraveSoftware", "Brave-Browser"),
    Firefox: path.join(home, ".mozilla", "firefox")
  };
}

function installed() {
  const roots = profileRoots();
  const records = [];
  for (const [browser, root] of Object.entries(roots)) {
    try {
      for (const record of inventory(browser, root)) {
        if (record.Id) records.push(record);
      }
    } catch (error) {
      records.push({ Browser: browser, Error: error.message });
    }
  }
  return records;
}

function detect({ keyPath, safariBundleId } = {}) {
  const result = {
    platform: process.platform,
    chromium: { selfHostId: null, source: "pack key not found" },
    gecko: { id: GECKO_ID, note: "Fixed Gecko ID; force-install requires a Mozilla-signed XPI." },
    safari: {
      bundleId: safariBundleId || null,
      note: "Safari extension IDs are assigned at Xcode build/sign time inside a signed app."
    },
    installed: installed()
  };
  if (keyPath && fs.existsSync(keyPath)) {
    result.chromium = {
      selfHostId: chromiumIdFromKeyPem(fs.readFileSync(keyPath, "utf8")),
      source: path.basename(keyPath),
      note: "Deterministic ID for the self-hosted CRX across Chrome, Edge and Brave."
    };
  }
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const keyIndex = args.indexOf("--key");
  const safariIndex = args.indexOf("--safari-bundle-id");
  process.stdout.write(JSON.stringify(detect({
    keyPath: keyIndex !== -1 ? args[keyIndex + 1] : undefined,
    safariBundleId: safariIndex !== -1 ? args[safariIndex + 1] : undefined
  }), null, 2));
}

module.exports = { detect, profileRoots, installed };
