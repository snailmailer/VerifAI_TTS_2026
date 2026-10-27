const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const policy = require("./ai-policy.js");
const redactionMetadata = require("./redaction-metadata.js");
const { activityFile, eventLogsDirectory } = require("./activity-storage.js");
const { writeDailyLogs, migrateLegacyLogs } = require("./event-logs.js");

const HOST = "127.0.0.1";
const PORT = 43821;
const MAX_EVENTS = 5000;
const MAX_BODY_BYTES = 16_384;
const APPROVED_AGENTS = new Set(policy.approved.map((agent) => agent.name));
const STATIC_FILES = new Map([
  ["/", ["dashboard.html", "text/html; charset=utf-8"]],
  ["/dashboard.html", ["dashboard.html", "text/html; charset=utf-8"]],
  ["/dashboard.js", ["dashboard.js", "text/javascript; charset=utf-8"]],
  ["/redaction-dashboard.js", ["redaction-dashboard.js", "text/javascript; charset=utf-8"]],
  ["/dashboard.css", ["dashboard.css", "text/css; charset=utf-8"]],
  ["/VerifAI%20Logo.png", ["VerifAI Logo.png", "image/png"]]
]);

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function loadEvents(dataFile) {
  if (!dataFile || !fs.existsSync(dataFile)) return [];
  try {
    const records = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(records)) throw new Error("Event store must contain an array.");
    return records.slice(-MAX_EVENTS);
  } catch (error) {
    throw new Error(`Could not read event store ${dataFile}: ${error.message}`);
  }
}

function createServiceServer({ token, dataFile, logsDirectory }) {
  if (typeof token !== "string" || token.length < 32) {
    throw new Error("The shared-service token must contain at least 32 characters.");
  }
  let events = loadEvents(dataFile);
  events = events.map((event) => ({ ...event, browser: event.browser || "Unknown (legacy)" }));
  let writeQueue = Promise.resolve();
  const tickets = new Map();
  const sessions = new Map();
  const subscribers = new Map();
  const localOrigin = () => `http://${HOST}:${server.address().port}`;
  function updateDailyLogs(date) {
    if (!logsDirectory) return;
    // Daily logs are derived from the persisted store; a logging failure must not
    // reject an event that has already been saved.
    try {
      writeDailyLogs(logsDirectory, events, date);
    } catch (error) {
      console.error("Daily event logs could not be written.", error.message);
    }
  }
  if (logsDirectory) {
    try {
      const moved = migrateLegacyLogs(logsDirectory);
      if (moved.length) console.log(`Moved ${moved.length} daily log file(s) into the <yyyy>\\<MMM-yyyy> layout.`);
    } catch (error) {
      console.error("Legacy daily logs could not be migrated.", error.message);
    }
  }
  updateDailyLogs(new Date());
  function cookieSession(request) {
    const cookie = request.headers.cookie?.match(/(?:^|; )verifai_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    return { cookie, expiry: sessions.get(cookie) || 0 };
  }
  function notifySubscribers() {
    for (const [response, expiry] of subscribers) {
      if (expiry <= Date.now()) {
        response.end();
        subscribers.delete(response);
      } else response.write("event: activity\ndata: changed\n\n");
    }
  }

  const server = http.createServer(async (request, response) => {
    if (!isLoopback(request.socket.remoteAddress)) {
      sendJson(response, 403, { ok: false, error: "Loopback connections only." });
      return;
    }

    const origin = request.headers.origin || "";
    if (request.headers.host !== `${HOST}:${server.address().port}`) {
      sendJson(response, 403, { ok: false, error: "Invalid local service host." });
      return;
    }
    if (/^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    if (request.method === "GET" && requestUrl.pathname === "/api/events/stream") {
      const { expiry } = cookieSession(request);
      if (expiry <= Date.now() || (origin && origin !== localOrigin())) {
        sendJson(response, 401, { ok: false, error: "Dashboard sign-in required." });
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "Connection": "keep-alive"
      });
      subscribers.set(response, expiry);
      response.write("event: ready\ndata: connected\n\n");
      const expiryTimer = setTimeout(() => response.end(), Math.max(1, expiry - Date.now()));
      expiryTimer.unref();
      request.on("close", () => { clearTimeout(expiryTimer); subscribers.delete(response); });
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/session") {
      try {
        const body = await readBody(request);
        if (!safeTokenEqual(body?.token, token)) {
          sendJson(response, 401, { ok: false, error: "Authentication required." });
          return;
        }
        const ticket = crypto.randomBytes(32).toString("hex");
        for (const [key, expiry] of tickets) if (expiry < Date.now()) tickets.delete(key);
        tickets.set(ticket, Date.now() + 60000);
        sendJson(response, 200, {
          dashboardUrl: `http://${HOST}:${server.address().port}/#ticket=${ticket}`
        });
      } catch (error) {
        console.error("Could not create dashboard ticket.", error);
        sendJson(response, 400, { ok: false, error: "Invalid session request." });
      }
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/session/exchange") {
      if (origin !== `http://${HOST}:${server.address().port}`) {
        sendJson(response, 403, { ok: false, error: "Same-origin session exchange required." });
        return;
      }
      try {
        const body = await readBody(request);
        const expiry = tickets.get(body?.ticket);
        tickets.delete(body?.ticket);
        if (!expiry || expiry < Date.now()) {
          sendJson(response, 401, { ok: false, error: "Expired or invalid dashboard ticket." });
          return;
        }
        const session = crypto.randomBytes(32).toString("hex");
        for (const [key, expires] of sessions) if (expires < Date.now()) sessions.delete(key);
        sessions.set(session, Date.now() + 8 * 60 * 60 * 1000);
        response.setHeader("Set-Cookie", `verifai_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        console.error("Could not exchange dashboard ticket.", error);
        sendJson(response, 400, { ok: false, error: "Invalid session exchange." });
      }
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    const staticFile = STATIC_FILES.get(requestUrl.pathname);
    if (request.method === "GET" && staticFile) {
      const [filename, contentType] = staticFile;
      try {
        const contents = fs.readFileSync(path.join(__dirname, filename));
        response.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'"
        });
        response.end(contents);
      } catch (error) {
        console.error("Could not serve dashboard asset.", error);
        sendJson(response, 500, { ok: false, error: "Dashboard asset unavailable." });
      }
      return;
    }

    if (
      request.method !== "POST" ||
      !["/api/events", "/api/events/query"].includes(requestUrl.pathname)
    ) {
      sendJson(response, 404, { ok: false, error: "Not found." });
      return;
    }

    try {
      if (!request.headers["content-type"]?.startsWith("text/plain")) {
        sendJson(response, 415, { ok: false, error: "Use text/plain requests." });
        return;
      }
      const body = await readBody(request);
      const cookie = request.headers.cookie?.match(/(?:^|; )verifai_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const dashboardSession = requestUrl.pathname === "/api/events/query" &&
        origin === `http://${HOST}:${server.address().port}` &&
        (sessions.get(cookie) || 0) > Date.now();
      if (!dashboardSession && !safeTokenEqual(body?.token, token)) {
        sendJson(response, 401, {
          ok: false,
          error: requestUrl.pathname === "/api/events/query" && origin === `http://${HOST}:${server.address().port}`
            ? "Dashboard sign-in required or expired. Open the dashboard from the VerifAI extension toolbar."
            : "Invalid service token."
        });
        return;
      }

      if (requestUrl.pathname === "/api/events/query") {
        sendJson(response, 200, { ok: true, events });
        return;
      }

      const event = body.event;
      if (!isValidEvent(event)) {
        sendJson(response, 400, { ok: false, error: "Invalid activity event." });
        return;
      }

      const writeTask = writeQueue.catch(() => {}).then(async () => {
        const nextEvents = events.slice();
        const index = nextEvents.findIndex((record) => record.id === event.eventId);
        if (index !== -1 && nextEvents[index].site !== event.site) {
          throw new Error("Activity event site does not match the existing record.");
        }
        if (event.action === "redact" && index === -1) {
          nextEvents.push({
            id: event.eventId, timestamp: new Date().toISOString(), site: event.site,
            status: event.editApplied ? "redacted" : "redaction_failed",
            eventType: "PII redaction", categories: event.categories,
            redactionCount: event.redactionCount, editApplied: event.editApplied
          });
        } else if (event.action === "block" && index === -1) {
          nextEvents.push({
            id: event.eventId,
            timestamp: new Date().toISOString(),
            site: event.site,
            status: "blocked",
            eventType: "Blocked AI website",
            approvedAgent: ""
          });
        } else if (event.action === "prompt" && index === -1) {
          nextEvents.push({
            id: event.eventId,
            timestamp: new Date().toISOString(),
            site: event.site,
            status: "prompted",
            eventType: "JIT approval prompt",
            approvedAgent: ""
          });
        } else if (event.action === "visit" && index === -1) {
          nextEvents.push({
            id: event.eventId,
            timestamp: new Date().toISOString(),
            site: event.site,
            status: "visited",
            eventType: "AI site visit",
            approvedAgent: event.agentName
          });
        } else if (event.action === "resolve") {
          const record = index === -1
            ? {
                id: event.eventId,
                timestamp: new Date().toISOString(),
                site: event.site,
                eventType: "JIT approval prompt"
              }
            : { ...events[index] };
          record.status = event.outcome;
          record.approvedAgent = event.outcome === "opened" ? event.agentName : "";
          record.resolvedAt = new Date().toISOString();
          if (index === -1) {
            nextEvents.push(record);
          } else {
            nextEvents[index] = record;
          }
        }
        const savedRecord = nextEvents.find((record) => record.id === event.eventId);
        if (savedRecord) {
          savedRecord.browser = event.browser || savedRecord.browser || "Unknown (legacy)";
          if (typeof event.privateWindow === "boolean") savedRecord.privateWindow = event.privateWindow;
        }
        const limitedEvents = nextEvents.slice(-MAX_EVENTS);

        if (dataFile) {
          await fs.promises.mkdir(path.dirname(dataFile), { recursive: true });
          const temporaryFile = `${dataFile}.tmp`;
          await fs.promises.writeFile(temporaryFile, JSON.stringify(limitedEvents), {
            encoding: "utf8",
            mode: 0o600
          });
          await fs.promises.rename(temporaryFile, dataFile);
        }
        events = limitedEvents;
        notifySubscribers();
        if (savedRecord) updateDailyLogs(new Date(savedRecord.timestamp));
      });
      writeQueue = writeTask;
      await writeTask;
      sendJson(response, 200, { ok: true });
    } catch (error) {
      console.error("Local service request failed.", error);
      sendJson(response, 500, { ok: false, error: "Local service could not process the request." });
    }
  });

  return server;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });
    request.on("error", reject);
  });
}

function safeTokenEqual(candidate, expected) {
  if (typeof candidate !== "string") return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(candidateBytes, expectedBytes);
}

function isValidEvent(event) {
  if (
    !event ||
    typeof event.eventId !== "string" ||
    !/^[\w-]{1,80}$/.test(event.eventId) ||
    typeof event.site !== "string" ||
    event.site.length > 253 ||
    (event.browser !== undefined && !["Chrome", "Edge", "Brave", "Firefox", "Safari", "Opera", "Unknown"].includes(event.browser)) ||
    (event.privateWindow !== undefined && typeof event.privateWindow !== "boolean") ||
    !/^[a-z0-9.-]+$/i.test(event.site) ||
    !(policy.blockedHost(event.site) || policy.approvedAgent(event.site)) ||
    !["prompt", "resolve", "visit", "block", "redact"].includes(event.action)
  ) {
    return false;
  }
  if (event.action === "redact") return Boolean(policy.approvedAgent(event.site)) && redactionMetadata.valid(event);
  if (event.action === "visit") {
    const expectedAgent = policy.approvedAgent(event.site);
    return Boolean(expectedAgent) && expectedAgent === event.agentName;
  }
  if (!policy.blockedHost(event.site)) return false;
  if (["prompt", "block"].includes(event.action)) return true;
  return ["opened", "left", "timed_out"].includes(event.outcome) &&
    (event.outcome !== "opened" || APPROVED_AGENTS.has(event.agentName));
}

function createTokenFile() {
  const defaultDataRoot = process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Local")
    : path.join(os.homedir(), ".local", "share");
  const dataDirectory = path.join(
    process.env.LOCALAPPDATA || defaultDataRoot,
    "VerifAI"
  );
  fs.mkdirSync(dataDirectory, { recursive: true });
  const tokenFile = path.join(dataDirectory, "local-service-token");
  if (!fs.existsSync(tokenFile)) {
    fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString("hex"), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  }
  return {
    token: fs.readFileSync(tokenFile, "utf8").trim(),
    dataFile: activityFile(dataDirectory),
    logsDirectory: eventLogsDirectory(dataDirectory)
  };
}

if (require.main === module) {
  try {
    const { token, dataFile, logsDirectory } = createTokenFile();
    const server = createServiceServer({ token, dataFile, logsDirectory });
    server.listen(PORT, HOST, () => {
      console.log(`VerifAI local event service running at http://${HOST}:${PORT}`);
      console.log("Dashboard: http://127.0.0.1:43821/");
      console.log(`Daily event logs: ${logsDirectory}`);
      console.log("Open the dashboard from the extension toolbar for an authenticated session.");
    });
    server.on("error", (error) => {
      console.error("VerifAI local service failed to start.", error);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error("VerifAI local service setup failed.", error);
    process.exitCode = 1;
  }
}

module.exports = { createServiceServer, createTokenFile };
