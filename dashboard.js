const EVENTS_KEY = "approvalEvents";
const SERVICE_URL = "http://127.0.0.1:43821";
let events = [];
let sortField = "timestamp";
let sortAscending = false;
let hasLoadedSharedEvents = false;
let announcementTimeout;
let automaticConnection;
let dashboardSignInRequired = false;
let dashboardInitializing = true;
let activityStream;
const isExtensionPage =
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

const body = document.getElementById("events-body");
const emptyState = document.getElementById("empty-state");
const filterInput = document.getElementById("filter-site");
const connectionForm = document.getElementById("connection-form");
const connectionStatus = document.getElementById("connection-status");
const liveAnnouncement = document.getElementById("live-announcement");

// "Chrome (private)" when the browser reported the event from an Incognito/InPrivate/Private window.
function browserLabel(event) {
  const name = event.browser || "Unknown (legacy)";
  return event.privateWindow === true ? `${name} (private)` : name;
}

function visibleEvents() {
  const query = filterInput.value.trim().toLowerCase();
  return events
    .filter((event) => event.eventType !== "PII redaction")
    .filter((event) => !query || `${event.site} ${browserLabel(event)}`.toLowerCase().includes(query))
    .sort((left, right) => {
      const comparison = String(sortValue(left)).localeCompare(
        String(sortValue(right)),
        undefined,
        { numeric: true }
      );
      return sortAscending ? comparison : -comparison;
    });

}

function exportEvents() {
  if (!document.getElementById("redaction-panel").hidden) {
    const query = document.getElementById("redaction-filter").value.trim().toLowerCase();
    return events.filter((event) => event.eventType === "PII redaction" &&
      `${event.site} ${event.browser || "Unknown (legacy)"} ${(event.categories || []).join(" ")}`.toLowerCase().includes(query))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }
  return visibleEvents();
}

function sortValue(event) {
  if (sortField === "status") return event.status || event.decision || "";
  return event[sortField] || "";
}

function displayStatus(event) {
  if (event.eventType === "PII redaction") {
    return { label: event.editApplied ? "Editor edit verified" : "Editor edit not verified", className: event.editApplied ? "visited" : "left" };
  }
  if (event.status === "blocked") {
    return { label: "AI website blocked", className: "left" };
  }
  if (event.status === "visited") {
    return { label: "AI site opened", className: "visited" };
  }
  if (event.status === "opened" || event.decision === "continued") {
    return { label: "Historical redirect", className: "opened" };
  }
  if (event.status === "left" || event.decision === "returned") {
    return { label: "Left site", className: "left" };
  }
  if (event.status === "timed_out") {
    return { label: "Timed out; tab closed", className: "timed-out" };
  }
  return { label: "Prompt shown", className: "prompted" };
}

function render() {
  window.VerifAIRedactionDashboard?.render(events);
  const shown = visibleEvents();
  body.replaceChildren();
  for (const event of shown) {
    const row = document.createElement("tr");
    const timestamp = document.createElement("td");
    const typeCell = document.createElement("td");
    const site = document.createElement("td");
    const browserCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const agentCell = document.createElement("td");
    const badge = document.createElement("span");
    const status = displayStatus(event);

    timestamp.textContent = new Date(event.timestamp).toLocaleString();
    typeCell.textContent = event.eventType || "JIT approval prompt";
    site.textContent = event.site;
    browserCell.textContent = browserLabel(event);
    badge.className = `decision ${status.className}`;
    badge.textContent = status.label;
    statusCell.append(badge);
    agentCell.textContent = event.approvedAgent || "—";
    row.append(timestamp, typeCell, site, browserCell, statusCell, agentCell);
    body.append(row);
  }

  emptyState.hidden = shown.length > 0;
  document.getElementById("event-count").textContent = String(events.length);
  document.getElementById("visit-count").textContent = String(
    events.filter((event) => event.status === "visited").length
  );
  document.getElementById("blocked-count").textContent = String(
    events.filter((event) => event.status === "blocked").length
  );
  document.getElementById("left-count").textContent = String(
    events.filter((event) =>
      ["left", "timed_out"].includes(event.status) || event.decision === "returned"
    ).length
  );
}

function download(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

filterInput.addEventListener("input", render);
document.querySelectorAll(".sort").forEach((button) => {
  button.addEventListener("click", () => {
    const nextField = button.dataset.sort;
    sortAscending = nextField === sortField ? !sortAscending : true;
    sortField = nextField;
    render();
  });
});

document.getElementById("export-json").addEventListener("click", () => {
  download(
    "verifai-approval-events.json",
    "application/json",
    JSON.stringify(exportEvents().map((event) => ({ ...event, browser: event.browser || "Unknown (legacy)" })), null, 2)
  );
});

document.getElementById("export-csv").addEventListener("click", () => {
  const rows = [
    ["timestamp", "eventType", "site", "browser", "privateWindow", "outcome", "approvedAgent", "categories", "redactionCount", "editApplied"],
    ...exportEvents().map((event) => [
      event.timestamp,
      event.eventType || "JIT approval prompt",
      event.site,
      event.browser || "Unknown (legacy)",
      event.privateWindow === true ? "yes" : event.privateWindow === false ? "no" : "",
      displayStatus(event).label,
      event.approvedAgent || "",
      (event.categories || []).join("; "), event.redactionCount ?? "", event.editApplied ?? ""
    ])
  ];
  download(
    "verifai-approval-events.csv",
    "text/csv;charset=utf-8",
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
});

document.getElementById("save-pdf").addEventListener("click", () => {
  window.print();
});

async function loadEvents() {
  if (!isExtensionPage && (dashboardInitializing || dashboardSignInRequired)) return;
  try {
    const token = isExtensionPage ? (await nativeConnection()).token : undefined;
    const response = await fetch(`${SERVICE_URL}/api/events/query`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ token }),
      cache: "no-store"
    });
    const result = await response.json();
    if (response.status === 401 && !isExtensionPage) {
      dashboardSignInRequired = true;
      setConnectionStatus(
        "Dashboard sign-in required or expired. In a paired browser, click the VerifAI extension toolbar icon to open an authenticated dashboard. Opening the localhost address directly does not sign you in.",
        "error"
      );
      return;
    }
    if (!response.ok || !result.ok || !Array.isArray(result.events)) {
      throw new Error(result.error || `Service returned HTTP ${response.status}.`);
    }
    announceNewEvents(result.events);
    events = result.events;
    render();
    setConnectionStatus("Connected. Receiving events shared by this computer's configured browsers.", "connected");
    startActivityStream();
  } catch (error) {
    const hint = /forbidden|not found/i.test(error.message)
      ? " Fix: run the repair script from your VerifAI package (Repair-VerifAI.cmd on Windows, repair.sh on macOS/Linux), then reload this extension on the browser's Extensions page and click the VerifAI icon again."
      : "";
    setConnectionStatus(`Service unavailable: ${error.message}${hint}`, "error");
    await loadLocalEvents();
  }
}

function nativeConnection() {
  if (automaticConnection) return automaticConnection;
  automaticConnection = new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage("com.verifai.bridge", { action: "connect" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        reject(new Error(chrome.runtime.lastError?.message || response?.error || "Bridge not installed."));
      } else resolve(response);
    });
  }).catch((error) => {
    automaticConnection = undefined;
    throw error;
  });
  return automaticConnection;
}

async function loadLocalEvents() {
  if (!isExtensionPage) {
    events = [];
    render();
    return;
  }
  try {
    const stored = await chrome.storage.local.get({ [EVENTS_KEY]: [] });
    const nextEvents = Array.isArray(stored[EVENTS_KEY]) ? stored[EVENTS_KEY] : [];
    announceNewEvents(nextEvents);
    events = nextEvents;
    render();
  } catch (error) {
    console.error("VerifAI could not load local approval events.", error);
    emptyState.textContent = "Could not load local events. See the browser console for details.";
    emptyState.hidden = false;
  }
}

function setConnectionStatus(message, state) {
  connectionStatus.textContent = message;
  connectionStatus.className = `connection-status ${state}`;
}

function announceNewEvents(nextEvents) {
  if (hasLoadedSharedEvents) {
    const currentIds = new Set(events.map((event) => event.id));
    const added = nextEvents.filter((event) => !currentIds.has(event.id));
    const addedCount = added.length;
    if (addedCount > 0) {
      const pii = added.filter((event) => event.eventType === "PII redaction");
      const failed = pii.filter((event) => !event.editApplied).length;
      liveAnnouncement.textContent = pii.length > 0
        ? `JIT PII alert: ${pii.length} new redaction event${pii.length === 1 ? "" : "s"} received${failed ? `; ${failed} editor edit(s) not verified` : ""}. Open Redacted PII for details.`
        : `${addedCount} new AI activity event${addedCount === 1 ? "" : "s"} received.`;
      liveAnnouncement.hidden = false;
      clearTimeout(announcementTimeout);
      announcementTimeout = window.setTimeout(() => {
        liveAnnouncement.hidden = true;
      }, 6000);
    }
  }
  hasLoadedSharedEvents = true;
}

connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (isExtensionPage) {
      document.getElementById("extension-diagnostics").hidden = false;
      const refreshDiagnostics = () => {
        chrome.runtime.sendMessage({ type: "verifai:diagnostics" }, (result) => {
          const status = document.getElementById("extension-diagnostics-status");
          if (chrome.runtime.lastError || !result?.ok) {
            status.textContent = `Diagnostics failed: ${chrome.runtime.lastError?.message || result?.error}`;
            return;
          }
          status.textContent = `${result.browser}, version ${result.version}. Static blocking: ${result.staticBlockingEnabled ? "enabled" : "NOT ENABLED"}. ` +
            `Block-page rules: ${result.blockPageRules}/${result.expectedBlockPageRules}. Queued events: ${result.pendingEvents}. ` +
            `Native bridge: ${result.bridge}. ` +
            `Private windows: ${result.incognitoAllowed === true ? "covered" : result.incognitoAllowed === false
              ? "NOT COVERED - open this browser's Extensions page, click VerifAI > Details and turn on \"Allow in Incognito\" (Edge: \"Allow in InPrivate\", Brave: \"Allow in Private\")."
              : "unknown"}. ` +
            `${result.blockingError ? `Blocking error: ${result.blockingError}.` : ""} ` +
            `Updates: ${result.updates ? JSON.stringify(result.updates) : "No browser-managed check recorded."} ` +
            `${result.stagedUpdateError || ""}`;
        });

      };
      document.getElementById("refresh-diagnostics").addEventListener("click", refreshDiagnostics);
      refreshDiagnostics();
      automaticConnection = undefined;
      const connection = await nativeConnection();
      window.location.assign(connection.dashboardUrl);
    } else {
      setConnectionStatus("Click the VerifAI extension icon in your browser toolbar (under Extensions if hidden). That opens a signed-in dashboard. This web page cannot access the native connection directly.", "error");
    }
  } catch (error) {
    setConnectionStatus(`Standalone mode: ${error.message}`, "error");
  }
});

function startActivityStream() {
  if (isExtensionPage || activityStream || typeof EventSource === "undefined") return;
  activityStream = new EventSource(`${SERVICE_URL}/api/events/stream`);
  activityStream.addEventListener("activity", loadEvents);
  activityStream.addEventListener("error", () => {
    console.warn("VerifAI live event stream interrupted; polling remains active.");
  });
}

async function initializeDashboard() {
  const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
  if (ticket && !isExtensionPage) {
    history.replaceState(null, "", "/");
    try {
      const response = await fetch(`${SERVICE_URL}/api/session/exchange`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ ticket })
      });
      if (!response.ok) throw new Error("Dashboard login expired. Open it again from the extension.");
    } catch (error) {
      dashboardSignInRequired = true;
      setConnectionStatus(error.message, "error");
      dashboardInitializing = false;
      return;
    }
  }
  dashboardInitializing = false;
  await loadEvents();
}

initializeDashboard();
window.addEventListener("focus", loadEvents);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadEvents();
});

window.setInterval(() => {
  if (!document.hidden) loadEvents();
}, 3000);

if (isExtensionPage) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[EVENTS_KEY]) {
      events = Array.isArray(changes[EVENTS_KEY].newValue)
        ? changes[EVENTS_KEY].newValue
        : [];
      render();
    }
  });
}
