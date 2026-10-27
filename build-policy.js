const fs = require("node:fs");
const path = require("node:path");
const policy = require("./ai-policy.js");

function writeJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function buildPolicy(outputDirectory = __dirname) {
  const manifestPath = path.join(__dirname, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const domains = [...new Set([
    ...policy.blocked,
    ...policy.approved.flatMap((agent) => agent.domains)
  ])];
  const matches = domains.map((domain) => `*://*.${domain}/*`);
  manifest.version = "0.5.5";
  // One shared worker for normal and private windows; private-window events arrive with sender.tab.incognito.
  manifest.incognito = "spanning";
  manifest.description = "Blocks catalogued unapproved AI sites and records approved visits and blocked attempts.";
  manifest.permissions = [...new Set([...manifest.permissions, "declarativeNetRequest", "alarms"])];
  manifest.host_permissions = ["http://127.0.0.1/*", ...matches];
  manifest.content_scripts = [{
    matches: policy.approved.flatMap((agent) => agent.domains.map((domain) => `*://*.${domain}/*`)),
    js: ["ai-policy.js", "redaction-core.js", "redaction.js", "activity.js"],
    run_at: "document_start",
    all_frames: true
  }];
  manifest.declarative_net_request = {
    rule_resources: [{ id: "ai_blocklist", enabled: true, path: "ai-block-rules.json" }]
  };
  manifest.web_accessible_resources = [{
    resources: ["blocked.html"],
    matches: ["http://*/*", "https://*/*"]
  }];
  writeJson(path.join(outputDirectory, "manifest.json"), manifest);
  writeJson(path.join(outputDirectory, "ai-block-rules.json"), [{
    id: 1,
    priority: 1,
    action: { type: "block" },
    condition: { requestDomains: policy.blocked, excludedResourceTypes: [] }
  }]);
}

if (require.main === module) buildPolicy(process.argv[2] ? path.resolve(process.argv[2]) : __dirname);
module.exports = { buildPolicy };
