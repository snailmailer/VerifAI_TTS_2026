// Dependency-free SVG architecture diagrams embedded in every package README.
const fs = require("node:fs");
const path = require("node:path");

const FONT = "font-family='Segoe UI, Helvetica, Arial, sans-serif'";
const COLORS = {
  browser: "#dbeafe", extension: "#dcfce7", bridge: "#fef9c3", collector: "#fde68a",
  storage: "#e9d5ff", soc: "#fecaca", mdm: "#cffafe", user: "#f3f4f6", border: "#1f2937"
};

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

function box(x, y, w, h, fill, title, lines = []) {
  const titleY = y + 22;
  const body = lines.map((line, index) =>
    `<text x="${x + w / 2}" y="${titleY + 18 + index * 15}" text-anchor="middle" font-size="11" fill="#374151" ${FONT}>${escape(line)}</text>`).join("");
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${COLORS.border}" stroke-width="1.5"/>` +
    `<text x="${x + w / 2}" y="${titleY}" text-anchor="middle" font-size="13" font-weight="bold" fill="#111827" ${FONT}>${escape(title)}</text>${body}`;
}

function arrow(x1, y1, x2, y2, label = "", dashed = false) {
  const vertical = Math.abs(x1 - x2) < 1;
  // Vertical arrows get their label to the right of the line so text never overlaps it.
  const midX = vertical ? x1 + 10 : (x1 + x2) / 2;
  const midY = (y1 + y2) / 2 + (vertical ? 4 : -6);
  const anchor = vertical ? "start" : "middle";
  const dash = dashed ? ' stroke-dasharray="6 4"' : "";
  const text = label ? `<text x="${midX}" y="${midY}" text-anchor="${anchor}" font-size="10.5" fill="#1f2937" ${FONT}>${escape(label)}</text>` : "";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.border}" stroke-width="1.6" marker-end="url(#arrow)"${dash}/>${text}`;
}

function svg(width, height, title, content) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
  <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${COLORS.border}"/></marker></defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${width / 2}" y="28" text-anchor="middle" font-size="18" font-weight="bold" fill="#111827" ${FONT}>${escape(title)}</text>
  ${content}
</svg>
`;
}

function systemArchitecture() {
  const parts = [];
  // Row 1: browsers
  const browsers = ["Chrome", "Edge", "Brave", "Firefox"];
  browsers.forEach((name, index) => {
    const x = 40 + index * 150;
    parts.push(box(x, 60, 130, 70, COLORS.browser, name, ["approved AI sites:", "Copilot, Gemini, Perplexity"]));
    parts.push(arrow(x + 65, 130, x + 65, 170));
  });
  parts.push(box(40, 170, 580, 90, COLORS.extension, "VerifAI browser extension (Manifest V3)",
    ["content scripts: PII redaction in the chat editor, site visit events",
      "background worker: domain blocking (declarativeNetRequest), event queue, browser name",
      "no prompt text leaves the browser - categories, counts and hostnames only"]));
  parts.push(arrow(330, 260, 330, 300, "native messaging (per-browser allowlist of extension IDs)"));
  parts.push(box(180, 300, 300, 70, COLORS.bridge, "Native host  com.verifai.bridge",
    ["validates the calling extension ID", "returns the local credential + dashboard ticket"]));
  parts.push(arrow(330, 370, 330, 410, "HTTPS-free loopback: http://127.0.0.1:43821"));
  parts.push(box(130, 410, 400, 90, COLORS.collector, "Local collector (Node.js, per user)",
    ["authenticated event ingest, validation (no free-text fields)",
      "server-sent events -> dashboard refreshes instantly (JIT)",
      "writes daily JSON + PDF logs after every persisted event"]));
  parts.push(arrow(230, 500, 160, 540));
  parts.push(arrow(430, 500, 500, 540));
  parts.push(box(40, 540, 250, 95, COLORS.storage, "Activity store + daily logs",
    ["approval-events.json", "EVENT LOGS\\<yyyy>\\<MMM-yyyy>\\", "AI_Activity_Logs_dd-MMM-yyyy.json/.pdf", "Redacted_PII_Logs_dd-MMM-yyyy.json/.pdf"]));
  parts.push(box(380, 540, 250, 95, COLORS.soc, "SOC dashboard (local web UI)",
    ["AI Activities tab | Redacted PII tab", "sort/filter, CSV/JSON/PDF export", "opened signed-in from the toolbar icon"]));
  parts.push(box(660, 170, 220, 120, COLORS.user, "Blocked AI sites", ["claude.ai, chatgpt.com, deepseek,", "huggingface, poe, ... (catalogued)", "top-level navigations redirect", "to the VerifAI block page"]));
  parts.push(arrow(620, 215, 660, 215, "", true));
  parts.push(box(660, 410, 220, 90, COLORS.user, "Runtime", ["Windows: bundled node.exe (USB)", "macOS: LaunchAgent", "Linux: systemd --user service"]));
  parts.push(box(660, 520, 220, 115, COLORS.mdm, "Private windows", ["Chromium: user toggle only", "(no policy can force it);", "Enterprise default disables", "Incognito/InPrivate by policy.", "Firefox: private_browsing policy."]));
  return svg(920, 660, "VerifAI - system architecture", parts.join("\n"));
}

function jitFlow() {
  const steps = [
    ["User types or pastes in an approved AI chat", "content script checks text on submit/paste"],
    ["Sensitive text replaced in the editor", "[REDACTED: ...] placeholders; send is cancelled until clean"],
    ["Metadata event -> background worker", "categories, count, hostname, browser; no values"],
    ["Worker -> native host -> collector", "credential cached per worker; retry in 30 s on failure"],
    ["Collector persists, then pushes SSE", "dashboard fetches at once; JIT PII banner shows"],
    ["Daily logs rewritten", "<yyyy>\\<MMM-yyyy>\\*_dd-MMM-yyyy.json/.pdf"]
  ];
  const parts = [];
  steps.forEach(([title, detail], index) => {
    const y = 60 + index * 90;
    parts.push(box(120, y, 560, 60, index === 1 ? COLORS.extension : index === 4 ? COLORS.soc : COLORS.user, `${index + 1}. ${title}`, [detail]));
    if (index < steps.length - 1) parts.push(arrow(400, y + 60, 400, y + 90));
  });
  parts.push(`<text x="400" y="620" text-anchor="middle" font-size="11" fill="#374151" ${FONT}>Typical end-to-end latency on the same computer: well under one second. Same path on Windows, macOS and Linux and in Chrome, Edge, Brave and Firefox.</text>`);
  return svg(800, 640, "VerifAI - JIT redaction and activity flow", parts.join("\n"));
}

function standaloneFlow() {
  const steps = [
    ["1. Run the setup", "Windows: Install-VerifAI.cmd / Setup.cmd   macOS-Linux: sh setup.sh"],
    ["2. Checks", "OS, 64-bit, package integrity (SHA256), port 43821, runtime"],
    ["3. Stage the extension", "stable per-user folder (survives removing the USB)"],
    ["4. Guided browser steps (pop-up per browser)", "Developer mode -> Load unpacked -> paste path -> enable"],
    ["5. Detect the extension IDs", "waits up to 30 s for the browser to save them"],
    ["6. Install collector + native bridge + startup", "registers IDs; daily log folder configured"],
    ["7. Health check and finish pop-up", "dashboard from the toolbar icon; test with synthetic PII"]
  ];
  const parts = [];
  steps.forEach(([title, detail], index) => {
    const y = 60 + index * 78;
    parts.push(box(100, y, 600, 56, index === 3 ? COLORS.browser : COLORS.user, title, [detail]));
    if (index < steps.length - 1) parts.push(arrow(400, y + 56, 400, y + 78));
  });
  return svg(800, 620, "VerifAI - standalone installation flow", parts.join("\n"));
}

function enterpriseFlow() {
  const parts = [];
  parts.push(box(40, 60, 240, 80, COLORS.mdm, "Publish once", ["Store IDs (recommended) or", "self-hosted CRX/XPI + update.xml", "on the GitHub release"]));
  parts.push(arrow(280, 100, 330, 100));
  parts.push(box(330, 60, 240, 80, COLORS.mdm, "Build Enterprise package", ["npm run build:distribution", "policies carry the extension IDs", "per OS folder + chooser"]));
  parts.push(arrow(570, 100, 620, 100));
  parts.push(box(620, 60, 240, 80, COLORS.mdm, "Deploy with your MDM", ["Intune / Jamf / Linux policy", "iOS MDM / Android EMM", "force_installed + auto-update"]));
  const targets = [
    ["Windows", "Intune Win32 app or policy", "ExtensionSettings: force_installed"],
    ["macOS", ".mobileconfig per browser", "Safari needs a signed app"],
    ["Linux", "/etc/<browser>/policies/managed", "install-linux.sh as root"],
    ["iOS", "signed Safari app via MDM", "only Safari runs extensions"],
    ["Android", "managed Firefox (AMO-signed)", "Chrome/Edge/Brave: none"]
  ];
  targets.forEach(([title, a, b], index) => {
    const x = 20 + index * 176;
    parts.push(arrow(740, 140, x + 86, 200, "", true));
    parts.push(box(x, 200, 172, 80, COLORS.browser, title, [a, b]));
    parts.push(arrow(x + 86, 280, x + 86, 320));
  });
  parts.push(box(40, 320, 820, 70, COLORS.collector, "Per-user collector on each device (logged-on user context)",
    ["Windows: install-windows.ps1 (not as SYSTEM)   macOS: jamf-install-bridge.sh   Linux: install-linux.js",
      "events, dashboard and daily logs stay on the device; nothing is sent to a cloud"]));
  parts.push(`<text x="450" y="420" text-anchor="middle" font-size="11" fill="#374151" ${FONT}>Browsers update the extension themselves from the store / update.xml. Follow PUBLISH-CHECKLIST.md before deploying.</text>`);
  return svg(900, 440, "VerifAI - enterprise deployment flow", parts.join("\n"));
}

const DIAGRAMS = {
  "architecture.svg": systemArchitecture,
  "jit-flow.svg": jitFlow,
  "standalone-flow.svg": standaloneFlow,
  "enterprise-flow.svg": enterpriseFlow
};

function writeDiagrams(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const written = [];
  for (const [name, render] of Object.entries(DIAGRAMS)) {
    const file = path.join(directory, name);
    fs.writeFileSync(file, render());
    written.push(file);
  }
  return written;
}

if (require.main === module) {
  const output = process.argv[2] || path.join(__dirname, "..", "docs", "diagrams");
  for (const file of writeDiagrams(output)) console.log(file);
}

module.exports = { writeDiagrams, DIAGRAMS };
