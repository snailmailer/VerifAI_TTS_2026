const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = __dirname;
const output = process.env.VERIFAI_FIREFOX_BUILD_DIR ||
  path.join(os.tmpdir(), "VerifAI", "FirefoxExtension");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
);

delete manifest.background.service_worker;
manifest.background.scripts = ["ai-policy.js", "browser-info.js", "redaction-metadata.js", "background.js"];
manifest.browser_specific_settings = {
  gecko: {
    id: "verifai-approval-gate@example.com",
    strict_min_version: "128.0"
  }
};

const files = [
  "ai-policy.js", "browser-info.js", "redaction-metadata.js", "redaction-dashboard.js", "ai-block-rules.json", "blocked.html", "blocked.js",
  "background.js",
  "content.js",
  "activity.js",
  "redaction-core.js",
  "redaction.js",
  "dashboard.html",
  "dashboard.css",
  "dashboard.js",
  "VerifAI Logo.png"
];

fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.writeFileSync(
  path.join(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(`Firefox extension build created at ${output}`);
