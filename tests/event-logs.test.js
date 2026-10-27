const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { logPaths, writeDailyLogs, renderPdf, migrateLegacyLogs } = require("../event-logs.js");
const { eventLogsDirectory, configureEventLogs, activityFile } = require("../activity-storage.js");
const { createServiceServer } = require("../local-service.js");

function at(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour, 30, 0);
}

const records = [
  { id: "a1", timestamp: at(2026, 10, 25, 9).toISOString(), site: "gemini.google.com", browser: "Edge",
    eventType: "AI site visit", status: "visited", approvedAgent: "Gemini" },
  { id: "p1", timestamp: at(2026, 10, 25, 10).toISOString(), site: "www.perplexity.ai", browser: "Chrome",
    eventType: "PII redaction", status: "redacted", categories: ["name", "Social Insurance number"], redactionCount: 2, editApplied: true },
  { id: "p2", timestamp: at(2026, 10, 25, 11).toISOString(), site: "copilot.microsoft.com", browser: "Brave",
    eventType: "PII redaction", status: "redaction_failed", categories: ["email address"], redactionCount: 1, editApplied: false,
    prompt: "must never reach a log" },
  { id: "a2", timestamp: at(2026, 10, 24, 9).toISOString(), site: "claude.ai", browser: "Firefox",
    eventType: "Blocked AI website", status: "blocked" },
  { id: "a3", timestamp: at(2026, 11, 1, 9).toISOString(), site: "claude.ai", browser: "Edge",
    eventType: "Blocked AI website", status: "blocked" }
];

test("daily logs use dd-MMM-yyyy names inside a <yyyy>\<MMM-yyyy> folder and contain only that day's records per type", (context) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-logs-"));
  context.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const result = writeDailyLogs(base, records, at(2026, 10, 25, 20));
  assert.equal(result.directory, path.join(base, "2026", "Oct-2026"));
  assert.deepEqual(result.counts, { activity: 1, redaction: 2 });
  assert.deepEqual(fs.readdirSync(result.directory).sort(), [
    "AI_Activity_Logs_25-Oct-2026.json", "AI_Activity_Logs_25-Oct-2026.pdf",
    "Redacted_PII_Logs_25-Oct-2026.json", "Redacted_PII_Logs_25-Oct-2026.pdf"
  ]);
  const activity = JSON.parse(fs.readFileSync(path.join(result.directory, "AI_Activity_Logs_25-Oct-2026.json"), "utf8"));
  assert.equal(activity.report, "AI Activity Logs");
  assert.deepEqual(activity.records.map((record) => record.id), ["a1"]);
  const redaction = JSON.parse(fs.readFileSync(path.join(result.directory, "Redacted_PII_Logs_25-Oct-2026.json"), "utf8"));
  assert.deepEqual(redaction.records.map((record) => record.id), ["p1", "p2"]);
  assert.equal(redaction.count, 2);
  const pdf = fs.readFileSync(path.join(result.directory, "Redacted_PII_Logs_25-Oct-2026.pdf"));
  assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert.match(pdf.toString("latin1"), /%%EOF\n$/);
  assert.match(pdf.toString("latin1"), /Redacted PII Logs - 25-Oct-2026/);
  assert.match(pdf.toString("latin1"), /editor edit NOT VERIFIED/);
  // Only one file per type per day: a rewrite replaces, never appends a new file.
  writeDailyLogs(base, [...records, { id: "p3", timestamp: at(2026, 10, 25, 12).toISOString(), site: "gemini.google.com",
    browser: "Edge", eventType: "PII redaction", status: "redacted", categories: ["phone number"], redactionCount: 1, editApplied: true }],
  at(2026, 10, 25, 21));
  assert.equal(fs.readdirSync(result.directory).length, 4);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory, "Redacted_PII_Logs_25-Oct-2026.json"), "utf8")).count, 3);
});

test("a new month creates a new folder and previous days are left untouched", (context) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-logs-month-"));
  context.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeDailyLogs(base, records, at(2026, 10, 24));
  const before = fs.statSync(path.join(base, "2026", "Oct-2026", "AI_Activity_Logs_24-Oct-2026.json")).mtimeMs;
  const november = writeDailyLogs(base, records, at(2026, 11, 1));
  assert.equal(november.directory, path.join(base, "2026", "Nov-2026"));
  assert.deepEqual(november.counts, { activity: 1, redaction: 0 });
  assert.deepEqual(fs.readdirSync(base).sort(), ["2026"]);
  assert.deepEqual(fs.readdirSync(path.join(base, "2026")).sort(), ["Nov-2026", "Oct-2026"]);
  assert.equal(fs.statSync(path.join(base, "2026", "Oct-2026", "AI_Activity_Logs_24-Oct-2026.json")).mtimeMs, before);
  assert.match(fs.readFileSync(path.join(base, "2026", "Nov-2026", "Redacted_PII_Logs_01-Nov-2026.pdf"), "latin1"), /No events were recorded/);
  assert.equal(logPaths(base, at(2026, 1, 5)).redaction.pdf, path.join(base, "2026", "Jan-2026", "Redacted_PII_Logs_05-Jan-2026.pdf"));
});

test("legacy <MMM>_<yyyy> logs are moved once into the <yyyy>/<MMM-yyyy> layout", (context) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-logs-legacy-"));
  context.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const legacy = path.join(base, "Oct_2026");
  fs.mkdirSync(legacy);
  for (const name of ["AI_Activity_Logs_25_Oct_2026.json", "AI_Activity_Logs_25_Oct_2026.pdf",
    "Redacted_PII_Logs_25_Oct_2026.json", "Redacted_PII_Logs_25_Oct_2026.pdf", "unrelated.txt"]) {
    fs.writeFileSync(path.join(legacy, name), name);
  }
  const moved = migrateLegacyLogs(base);
  assert.equal(moved.length, 4);
  const target = path.join(base, "2026", "Oct-2026");
  assert.deepEqual(fs.readdirSync(target).sort(), [
    "AI_Activity_Logs_25-Oct-2026.json", "AI_Activity_Logs_25-Oct-2026.pdf",
    "Redacted_PII_Logs_25-Oct-2026.json", "Redacted_PII_Logs_25-Oct-2026.pdf"
  ]);
  assert.equal(fs.readFileSync(path.join(target, "AI_Activity_Logs_25-Oct-2026.json"), "utf8"), "AI_Activity_Logs_25_Oct_2026.json");
  // Unrecognised files stay put and the old folder is kept because it is not empty.
  assert.deepEqual(fs.readdirSync(legacy), ["unrelated.txt"]);
  assert.deepEqual(migrateLegacyLogs(base), []);
  // A rewrite for that day lands on the migrated file, not a second copy.
  writeDailyLogs(base, records, at(2026, 10, 25));
  assert.equal(fs.readdirSync(target).length, 4);
});

test("PDF renderer paginates, escapes delimiters and has a valid cross-reference table", () => {
  const lines = Array.from({ length: 140 }, (_, index) => `line ${index} with (parens) and \\ backslash and é`);
  const pdf = renderPdf("Title", "Subtitle", lines).toString("latin1");
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 3);
  assert.match(pdf, /\\\(parens\\\)/);
  const startxref = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const firstOffset = Number(pdf.match(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/)[1]);
  assert.equal(pdf.slice(firstOffset, firstOffset + 7), "1 0 obj");
});

test("collector rewrites the day's logs after each persisted event without storing prompt fields", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-logs-service-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logsDirectory = configureEventLogs(root, path.join(root, "EVENT LOGS"));
  assert.equal(eventLogsDirectory(root), logsDirectory);
  assert.equal(activityFile(root), path.join(root, "approval-events.json"));
  const token = "event-log-service-test-token-at-least-32-characters";
  const server = createServiceServer({ token, dataFile: path.join(root, "approval-events.json"), logsDirectory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ token, ...body })
  });
  assert.equal((await post({ event: { eventId: "visit-1", site: "gemini.google.com", browser: "Edge", action: "visit", agentName: "Gemini" } })).status, 200);
  assert.equal((await post({ event: { eventId: "redact-1", site: "gemini.google.com", browser: "Edge", action: "redact",
    categories: ["health card number"], redactionCount: 1, editApplied: true, prompt: "OHIP value must not be logged" } })).status, 200);
  const today = logPaths(logsDirectory, new Date());
  const activity = JSON.parse(fs.readFileSync(today.activity.json, "utf8"));
  const redaction = JSON.parse(fs.readFileSync(today.redaction.json, "utf8"));
  assert.equal(activity.count, 1);
  assert.equal(redaction.count, 1);
  assert.deepEqual(redaction.records[0].categories, ["health card number"]);
  for (const file of today.files ?? [today.activity.json, today.activity.pdf, today.redaction.json, today.redaction.pdf]) {
    assert.equal(fs.readFileSync(file, "latin1").includes("must not be logged"), false, file);
  }
});
