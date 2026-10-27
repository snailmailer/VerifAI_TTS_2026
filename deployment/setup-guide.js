// Precise, numbered on-screen instructions shared by the standalone and enterprise
// setup tools. Text is kept identical across OSes except for the OS-specific paths.
const { spawnSync } = require("node:child_process");

const BROWSER_PAGES = {
  Chrome: "chrome://extensions",
  Edge: "edge://extensions",
  Brave: "brave://extensions",
  Firefox: "about:debugging#/runtime/this-firefox"
};

function chromiumSteps(browser, folder) {
  return [
    `${browser} has opened its Extensions page (${BROWSER_PAGES[browser]}).`,
    `1. Top-right corner: switch "Developer mode" ON.`,
    `2. Click the "Load unpacked" button that appears.`,
    `3. In the folder picker, paste this path into the address bar and press Enter:`,
    `      ${folder}`,
    `   (It is already on your clipboard. Do NOT pick a folder on the USB drive.)`,
    `4. Click "Select Folder". "VerifAI Approval Gate" appears in the list.`,
    `5. Make sure its switch is ON (blue). If a permission prompt appears, click "Allow".`,
    `6. If VerifAI was already listed: click its "Reload" (circular arrow) instead of adding a second copy.`,
    `7. Return to this window and press Enter. Setup then waits up to 30 seconds while ${browser} saves the extension ID.`
  ];
}

function firefoxSteps(manifest) {
  return [
    `Firefox has opened about:debugging (This Firefox).`,
    `1. Click "Load Temporary Add-on...".`,
    `2. In the file picker, paste this path and press Enter:`,
    `      ${manifest}`,
    `   (It is already on your clipboard.)`,
    `3. Click "Open". "VerifAI Approval Gate" appears under Temporary Extensions.`,
    `4. Return to this window and press Enter.`,
    `Note: Firefox removes temporary add-ons when it closes. Repeat these steps after restarting Firefox,`,
    `or use the Enterprise package with a Mozilla-signed add-on for a permanent install.`
  ];
}

function safariSteps() {
  return [
    `Safari cannot load this extension directly.`,
    `Apple requires Safari extensions to ship inside a signed App Store app.`,
    `Setup installs the local collector now; the Safari extension must come from your organisation's signed app.`
  ];
}

const PRIVATE_TOGGLE = {
  Chrome: "Allow in Incognito",
  Edge: "Allow in InPrivate",
  Brave: "Allow in Private",
  Firefox: "Run in Private Windows"
};

// Browsers keep extensions out of private windows until the user allows it; no installer or policy
// can switch this on for Chrome, Edge or Brave. These steps get the user to do it and we verify after.
function privateWindowSteps(browser) {
  const toggle = PRIVATE_TOGGLE[browser] || "Allow in Incognito";
  if (browser === "Firefox") {
    return [
      `Firefox: VerifAI is not yet active in Private Windows.`,
      `1. Open about:addons (Add-ons Manager) > Extensions > click "VerifAI Approval Gate".`,
      `2. Under "${toggle}" choose "Allow".`,
      `3. Return to this window and press Enter.`
    ];
  }
  return [
    `${browser}: VerifAI is installed but NOT yet active in private windows (${toggle}).`,
    `Without it, Incognito/InPrivate/Private windows are not blocked or redacted. ${browser} does not let any installer turn this on for you.`,
    `1. On the Extensions page find "VerifAI Approval Gate" and click "Details".`,
    `2. Scroll to "${toggle}" and switch it ON.`,
    `3. Return to this window and press Enter. Setup re-checks for up to 30 seconds.`
  ];
}

function finishSteps(dashboardHint, coverage = []) {
  const lines = [
    `Installation complete.`,
    `1. In each browser click the puzzle-piece (Extensions) icon and pin "VerifAI".`,
    `2. Click the VerifAI icon once: the SOC dashboard opens already signed in.`,
    `3. Open gemini.google.com, copilot.microsoft.com or perplexity.ai and type a test line such as`,
    `      "SIN: 123-456-789"  -  it is replaced before sending and appears on the Redacted PII tab.`,
    `4. Any other AI site (for example claude.ai) is blocked and appears under AI Activities.`,
    dashboardHint
  ];
  if (coverage.length) {
    lines.push("Private-window coverage:");
    for (const entry of coverage) {
      lines.push(`   ${entry.browser}: ${entry.covered === true ? "covered" : entry.covered === false
        ? `NOT covered - turn on "${PRIVATE_TOGGLE[entry.browser] || "Allow in Incognito"}" on its Extensions page` : "not verified"}`);
    }
  }
  return lines.filter(Boolean);
}

function stepsFor(browser, { chromiumFolder, firefoxManifest }) {
  if (browser === "Firefox") return firefoxSteps(firefoxManifest);
  if (browser === "Safari") return safariSteps();
  return chromiumSteps(browser, chromiumFolder);
}

// Shows a modal dialog where the OS offers one; always echoes the text to the console.
function showDialog(title, lines) {
  const text = lines.join("\n");
  console.log(`\n${"=".repeat(72)}\n${title}\n${"-".repeat(72)}\n${text}\n${"=".repeat(72)}\n`);
  try {
    if (process.platform === "darwin") {
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      spawnSync("osascript", ["-e", `display dialog "${escaped}" with title "${title}" buttons {"OK"} default button "OK"`], { stdio: "ignore", timeout: 120000 });
    } else if (process.platform === "linux") {
      const zenity = spawnSync("which", ["zenity"], { encoding: "utf8" });
      if (zenity.status === 0) {
        spawnSync("zenity", ["--info", "--no-wrap", `--title=${title}`, `--text=${text}`], { stdio: "ignore", timeout: 120000 });
      }
    } else if (process.platform === "win32") {
      const escaped = text.replace(/'/g, "''");
      spawnSync("powershell.exe", ["-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('${escaped}', '${title.replace(/'/g, "''")}')`],
      { stdio: "ignore", timeout: 120000 });
    }
  } catch { /* console text already shown */ }
}

function setClipboard(text) {
  try {
    if (process.platform === "darwin") spawnSync("pbcopy", { input: text });
    else if (process.platform === "win32") spawnSync("powershell.exe", ["-NoProfile", "-Command", "Set-Clipboard -Value $input"], { input: text });
    else {
      for (const [command, args] of [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]]) {
        if (spawnSync("which", [command], { encoding: "utf8" }).status === 0) { spawnSync(command, args, { input: text }); break; }
      }
    }
    return true;
  } catch { return false; }
}

module.exports = { BROWSER_PAGES, PRIVATE_TOGGLE, stepsFor, privateWindowSteps, finishSteps, showDialog, setClipboard };
