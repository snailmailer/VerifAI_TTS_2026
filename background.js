if (typeof importScripts === "function") importScripts("ai-policy.js", "browser-info.js", "redaction-metadata.js");
const EVENTS_KEY = "approvalEvents";
const PENDING_KEY = "pendingSharedEvents";
const MAX_EVENTS = 1000;
const MAX_PENDING = 5000;
const APPROVED_AGENTS = new Set(VerifAIPolicy.approved.map((agent) => agent.name));
const SHARED_SERVICE_URL = "http://127.0.0.1:43821";
let eventQueue = Promise.resolve();
let flushQueue = Promise.resolve();
let blockingError = "";
// The native-host credential is reused while this worker is alive so each JIT event
// does not pay for a fresh native-host process; a 401 clears it and reconnects once.
let cachedConnection = null;
const RETRY_ALARM = "verifai:retry";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "verifai:diagnostics") {
    if (!sender.url?.startsWith(chrome.runtime.getURL("dashboard.html"))) return false;
    getDiagnostics().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (!["verifai:approval-event", "verifai:ai-activity", "verifai:blocked-activity", "verifai:redaction-event"].includes(message?.type)) {
    return false;
  }

  const event = message.event;
  const isActivity = message.type === "verifai:ai-activity";
  const isBlocked = message.type === "verifai:blocked-activity";
  const isRedaction = message.type === "verifai:redaction-event";
  let senderHost = "";
  try {
    if (isBlocked) {
      const senderUrl = new URL(sender.url);
      const blockedUrl = new URL(chrome.runtime.getURL("blocked.html"));
      if (senderUrl.origin !== blockedUrl.origin || senderUrl.protocol !== blockedUrl.protocol ||
          senderUrl.host !== blockedUrl.host || senderUrl.pathname !== blockedUrl.pathname ||
          !VerifAIPolicy.blockedHost(event?.site || "")) {
        throw new Error("Invalid blocked page sender.");
      }
      senderHost = event.site;
    } else {
      senderHost = new URL(sender.url).hostname.replace(/^www\./, "");
    }
  } catch (error) {
    sendResponse({ ok: false, error: "Invalid sender URL." });
    return false;
  }

  if (
    !event ||
    typeof event.eventId !== "string" ||
    !/^[\w-]{1,80}$/.test(event.eventId) ||
    event.eventId.length > 80 ||
    event.site !== senderHost ||
    !(isRedaction ? event.action === "redact" && Boolean(approvedAgentForHost(senderHost)) &&
      VerifAIRedactionMetadata.valid(event) : isBlocked ? event.action === "block" : isActivity
      ? event.action === "visit" && Boolean(approvedAgentForHost(senderHost)) && approvedAgentForHost(senderHost) === event.agentName
      : ["prompt", "resolve"].includes(event.action) && VerifAIPolicy.blockedHost(senderHost)) ||
    (event.action === "resolve" &&
      (!["opened", "left", "timed_out"].includes(event.outcome) ||
        (event.outcome === "opened" &&
          !APPROVED_AGENTS.has(event.agentName))))
  ) {
    sendResponse({ ok: false, error: "Invalid approval event." });
    return false;
  }

  eventQueue = eventQueue.then(async () => {
    const browserName = await VerifAIBrowser.detectBrowser();
    const stored = await chrome.storage.local.get({
      [EVENTS_KEY]: [],
      [PENDING_KEY]: []
    });
    const events = Array.isArray(stored[EVENTS_KEY])
      ? stored[EVENTS_KEY]
      : [];
    const pending = Array.isArray(stored[PENDING_KEY])
      ? stored[PENDING_KEY]
      : [];
    let record = events.find((item) => item.id === event.eventId);

    if (event.action === "redact" && !record) {
      events.push({
        id: event.eventId, timestamp: new Date().toISOString(), site: senderHost,
        status: event.editApplied ? "redacted" : "redaction_failed",
        eventType: "PII redaction", categories: event.categories,
        redactionCount: event.redactionCount, editApplied: event.editApplied
      });
    } else if (event.action === "block" && !record) {
      events.push({
        id: event.eventId,
        timestamp: new Date().toISOString(),
        site: senderHost,
        status: "blocked",
        eventType: "Blocked AI website",
        approvedAgent: ""
      });
    } else if (event.action === "prompt" && !record) {
      record = {
        id: event.eventId,
        timestamp: new Date().toISOString(),
        site: senderHost,
        status: "prompted",
        eventType: "JIT approval prompt",
        approvedAgent: ""
      };
      events.push(record);
    } else if (event.action === "visit" && !record) {
      events.push({
        id: event.eventId,
        timestamp: new Date().toISOString(),
        site: senderHost,
        status: "visited",
        eventType: "AI site visit",
        approvedAgent: event.agentName
      });
    } else if (event.action === "resolve") {
      if (!record) {
        record = {
          id: event.eventId,
          timestamp: new Date().toISOString(),
          site: senderHost,
          eventType: "JIT approval prompt"
        };
        events.push(record);
      }
      record.status = event.outcome;
      record.approvedAgent = event.outcome === "opened" ? event.agentName : "";
      record.resolvedAt = new Date().toISOString();
    }
    const savedRecord = events.find((item) => item.id === event.eventId);
    // sender.tab.incognito is set by the browser, never by page content.
    const privateWindow = sender.tab?.incognito === true;
    if (savedRecord) {
      savedRecord.browser = browserName;
      savedRecord.privateWindow = privateWindow;
    }

    const sharedEvent = {
      eventId: event.eventId,
      site: event.site,
      action: event.action,
      outcome: event.outcome,
      agentName: event.agentName,
      browser: browserName,
      privateWindow
    };
    if (isRedaction) {
      delete sharedEvent.agentName;
      delete sharedEvent.outcome;
      sharedEvent.categories = event.categories;
      sharedEvent.redactionCount = event.redactionCount;
      sharedEvent.editApplied = event.editApplied;
    }
    if (!pending.some((item) =>
      item.eventId === event.eventId && item.action === event.action
    )) {
      pending.push(sharedEvent);
    }
    await chrome.storage.local.set({
      [EVENTS_KEY]: events.slice(-MAX_EVENTS),
      [PENDING_KEY]: pending.slice(-MAX_PENDING)
    });
    const localResult = await flushSharedEvents();
    let closed = false;
    if (
      event.action === "resolve" &&
      ["left", "timed_out"].includes(event.outcome) &&
      Number.isInteger(sender.tab?.id)
    ) {
      try {
        await chrome.tabs.remove(sender.tab.id);
        closed = true;
      } catch (error) {
        console.error("VerifAI could not close the unapproved-site tab.", error);
      }
    }
    sendResponse({
      ok: true,
      closed,
      shared: localResult.shared,
      sharedError: localResult.error?.message
    });
  }).catch((error) => {
    console.error("VerifAI could not save the approval event.", error);
    sendResponse({ ok: false, error: "Could not save approval event." });
  });

  return true;
});

function approvedAgentForHost(host) {
  return VerifAIPolicy.approvedAgent(host);
}

async function flushSharedEvents() {
  const task = flushQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get({
      [PENDING_KEY]: []
    });
    const pending = Array.isArray(stored[PENDING_KEY])
      ? stored[PENDING_KEY]
      : [];
    if (pending.length === 0) return { shared: true };
    let connection = cachedConnection || await connectNative();
    cachedConnection = connection;

    const remaining = pending.slice();
    let rejected = 0;
    let reconnected = false;
    while (remaining.length > 0) {
      const event = remaining[0];
      const response = await fetch(`${SHARED_SERVICE_URL}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          token: connection.token,
          event
        }),
        signal: AbortSignal.timeout(5000)
      });
      if (response.status === 401 && !reconnected) {
        // The collector restarted with a new credential; refresh once and retry this event.
        cachedConnection = null;
        connection = await connectNative();
        cachedConnection = connection;
        reconnected = true;
        continue;
      }
      if (!response.ok) {
        if (response.status === 400) {
          console.error("VerifAI collector rejected a queued activity; removing invalid entry.", event);
          rejected++;
          remaining.shift();
          await chrome.storage.local.set({ [PENDING_KEY]: remaining });
          continue;
        }
        scheduleFastRetry();
        return {
          shared: false,
          error: new Error(`Shared service returned HTTP ${response.status}.`)
        };
      }
      const result = await response.json();
      if (!result.ok) {
        return {
          shared: false,
          error: new Error(result.error || "Shared service rejected the event.")
        };
      }

      remaining.shift();
      await chrome.storage.local.set({ [PENDING_KEY]: remaining });
    }
    return rejected
      ? { shared: false, error: new Error(`${rejected} queued activities were rejected by the collector; see the extension console.`) }
      : { shared: true };
  }).catch((error) => {
    console.error("VerifAI could not send queued events to the shared service.", error);
    cachedConnection = null;
    scheduleFastRetry();
    return { shared: false, error };
  });
  flushQueue = task;
  return task;
}

// Chrome's minimum alarm delay is 30 seconds; this retries well before the 1-minute flush.
function scheduleFastRetry() {
  try {
    chrome.alarms?.create(RETRY_ALARM, { delayInMinutes: 0.5 });
  } catch (error) {
    console.error("VerifAI could not schedule a fast retry.", error);
  }
}

function connectNative() {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime.sendNativeMessage) {
      reject(new Error("Native bridge unavailable. Standalone local monitoring is active."));
      return;
    }
    chrome.runtime.sendNativeMessage("com.verifai.bridge", { action: "connect" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok || !response.token) {
        reject(new Error(chrome.runtime.lastError?.message || response?.error || "Native bridge connection failed."));
      } else {
        resolve(response);
      }
    });
  });
}

function scheduleFlush() {
  eventQueue = eventQueue.then(() => flushSharedEvents()).catch((error) => {
    console.error("VerifAI automatic connection failed.", error);
  });
}

chrome.runtime.onStartup?.addListener(scheduleFlush);

chrome.runtime.onInstalled?.addListener(scheduleFlush);

// Alarms survive worker suspension, so queued events retry without another site visit.
chrome.alarms?.create("verifai:flush", { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "verifai:flush") {
    scheduleFlush();
    checkStagedUpdate();
  }
  if (alarm.name === RETRY_ALARM) scheduleFlush();
  if (alarm.name === "verifai:updates") checkForUpdates();
});
chrome.alarms?.create("verifai:updates", { periodInMinutes: 60 });

async function checkForUpdates() {
  try {
    if (!chrome.runtime.requestUpdateCheck) return;
    const result = await chrome.runtime.requestUpdateCheck();
    await chrome.storage.local.set({
      extensionUpdateStatus: {
        status: result.status,
        checkedAt: new Date().toISOString(),
        note: "Browser-managed updates only. Unpacked copies require the installer and reload."
      }
    });
  } catch (error) {
    console.error("VerifAI browser-managed update check failed.", error);
    await chrome.storage.local.set({ extensionUpdateStatus: { error: error.message } });
  }
}

chrome.runtime.onUpdateAvailable?.addListener(() => chrome.runtime.reload());

async function checkStagedUpdate() {
  if (!chrome.runtime.sendNativeMessage || !chrome.runtime.getManifest) return;
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendNativeMessage("com.verifai.bridge", { action: "check-update" }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          reject(new Error(chrome.runtime.lastError?.message || response?.error || "Staged update check failed."));
        } else resolve(response);
      });
    });
    const target = result.stagedVersion;
    const current = chrome.runtime.getManifest().version;
    if (!target || target === current) {
      await chrome.storage.local.set({ stagedUpdateError: null });
      return;
    }
    if (!/^\d+(?:\.\d+){0,3}$/.test(target)) throw new Error("Invalid staged version.");
    const stored = await chrome.storage.local.get({ lastReloadTargetVersion: null });
    if (stored.lastReloadTargetVersion === target) {
      throw new Error(`Reload did not activate staged version ${target}. Reload manually and approve new permissions.`);
    }
    await chrome.storage.local.set({ lastReloadTargetVersion: target });
    chrome.runtime.reload();
  } catch (error) {
    const stored = await chrome.storage.local.get({ stagedUpdateError: null });
    const message = /forbidden|not found/i.test(error.message)
      ? `${error.message} This browser's VerifAI copy is not registered with the local bridge yet: run the repair script from your VerifAI package (Repair-VerifAI.cmd on Windows, repair.sh on macOS/Linux) or re-run the installer, then reload the extension.`
      : error.message;
    // The check repeats every minute; log each distinct problem once instead of flooding the console.
    if (stored.stagedUpdateError !== message) console.error("VerifAI staged update could not activate.", message);
    await chrome.storage.local.set({ stagedUpdateError: message });
  }
}

checkStagedUpdate();

// Whether the browser lets this extension run in Incognito / InPrivate / Private windows.
// Chromium browsers expose this only as a per-extension user toggle; null = API unavailable.
function isIncognitoAllowed() {
  return new Promise((resolve) => {
    try {
      const api = chrome.extension?.isAllowedIncognitoAccess;
      if (!api) { resolve(null); return; }
      const maybePromise = api((allowed) => resolve(allowed === true));
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((allowed) => resolve(allowed === true), () => resolve(null));
      }
    } catch { resolve(null); }
  });
}

async function getDiagnostics() {
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
  const stored = await chrome.storage.local.get({ [PENDING_KEY]: [], extensionUpdateStatus: null, stagedUpdateError: null });
  let bridge = "Connected";
  try { await connectNative(); } catch (error) { bridge = error.message; }
  return {
    ok: true,
    browser: await VerifAIBrowser.detectBrowser(),
    version: chrome.runtime.getManifest().version,
    incognitoAllowed: await isIncognitoAllowed(),
    staticBlockingEnabled: enabled.includes("ai_blocklist"),
    blockPageRules: dynamic.length,
    expectedBlockPageRules: VerifAIPolicy.blocked.length,
    pendingEvents: stored[PENDING_KEY].length,
    bridge,
    blockingError,
    updates: stored.extensionUpdateStatus,
    stagedUpdateError: stored.stagedUpdateError
  };
}

async function configureBlocking() {
  const rules = VerifAIPolicy.blocked.map((domain, index) => ({
    id: index + 100,
    priority: 2,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: `${chrome.runtime.getURL("blocked.html")}?site=\\1`
      }
    },
    condition: {
      regexFilter: `^https?://((?:[^./:]+\\.)*${domain.replaceAll(".", "\\.")})(?::[0-9]+)?(?:[/?#].*)?$`,
      resourceTypes: ["main_frame"]
    }
  }));
  const previous = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: previous.map((rule) => rule.id), addRules: rules
  });
  if (chrome.tabs.query) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id) || !tab.url) continue;
      const url = new URL(tab.url);
      if (["https:", "http:"].includes(url.protocol) && VerifAIPolicy.blockedHost(url.hostname)) {
        await chrome.tabs.update(tab.id, {
          url: `${chrome.runtime.getURL("blocked.html")}?site=${encodeURIComponent(url.hostname)}`
        });
      }
    }
  }
}

if (chrome.declarativeNetRequest) {
  configureBlocking().catch((error) => {
    blockingError = error.message;
    console.error("VerifAI block-page routing failed. Static network blocks remain active.", error);
    chrome.action?.setBadgeText({ text: "ERR" });
  });
}

chrome.action?.onClicked.addListener(async () => {
  try {
    const connection = await connectNative();
    cachedConnection = connection;
    await chrome.tabs.create({ url: connection.dashboardUrl });
  } catch (error) {
    const hint = /forbidden|not found/i.test(error.message)
      ? " This browser's VerifAI copy is not registered with the local bridge. Run the repair script from your VerifAI package (Repair-VerifAI.cmd on Windows, repair.sh on macOS/Linux), then RELOAD the extension on the Extensions page - browsers only re-read the native-host registration when the extension loads."
      : "";
    console.error(`VerifAI is using the standalone dashboard. ${error.message}${hint}`);
    await chrome.storage.local.set({ bridgeError: `${error.message}${hint}` });
    await chrome.runtime.openOptionsPage();
  }
});
