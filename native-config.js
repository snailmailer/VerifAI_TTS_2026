const fs = require("node:fs");
const path = require("node:path");

const firefoxId = "verifai-approval-gate@example.com";
const originPattern = /^chrome-extension:\/\/[a-p]{32}\/$/;

function normalizeAllowed(value, warn) {
  if (!Array.isArray(value)) throw new Error("Native allowlist must be an array.");
  const result = [];
  function add(entry) {
    if (typeof entry === "string" && (entry === firefoxId || originPattern.test(entry))) {
      result.push(entry);
    } else if (entry && typeof entry === "object" && Array.isArray(entry.value) &&
        Object.keys(entry).every((key) => ["value", "Count"].includes(key))) {
      warn("Repairing legacy PowerShell-wrapped native allowlist.");
      entry.value.forEach(add);
    } else {
      throw new Error("Native allowlist contains an invalid entry; it was not silently discarded.");
    }
  }
  value.forEach(add);
  return [...new Set(result)];
}

function writeConfiguration(directory, ids, warn = console.warn) {
  for (const id of ids) {
    if (!/^[a-p]{32}$/.test(id)) throw new Error("Invalid Chromium extension ID.");
  }
  const file = path.join(directory, "native-allowed.json");
  const previous = fs.existsSync(file)
    ? normalizeAllowed(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")), warn)
    : [];
  const allowed = [...new Set([...previous, ...ids.map((id) => `chrome-extension://${id}/`), firefoxId])];
  const origins = allowed.filter((entry) => originPattern.test(entry));
  const common = {
    name: "com.verifai.bridge", description: "VerifAI authenticated local bridge",
    path: path.join(directory, "native-host.cmd"), type: "stdio"
  };
  const files = {
    "native-allowed.json": allowed,
    "native-firefox.json": { ...common, allowed_extensions: [firefoxId] }
  };
  if (origins.length) files["native-chromium.json"] = { ...common, allowed_origins: origins };
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(directory, name);
    const temporary = `${target}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return origins;
}

if (require.main === module) {
  try {
    const directory = process.argv[2];
    if (!directory) throw new Error("Native configuration directory required.");
    const origins = writeConfiguration(directory, process.argv.slice(3));
    console.log(`Validated native configuration: ${origins.length} Chromium origin(s), Firefox registered.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { normalizeAllowed, writeConfiguration };
