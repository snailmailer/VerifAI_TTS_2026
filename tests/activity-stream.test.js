const test = require("node:test");
const assert = require("node:assert/strict");
const { createServiceServer } = require("../local-service.js");

test("JIT stream requires a dashboard session and notifies only after metadata is stored", async (context) => {
  const token = "jit-stream-test-token-at-least-32-characters";
  const server = createServiceServer({ token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, headers = {}) => fetch(base + route, {
    method: "POST", headers: { "Content-Type": "text/plain", ...headers }, body: JSON.stringify(body)
  });
  assert.equal((await fetch(base + "/api/events/stream")).status, 401);
  const session = await (await post("/api/session", { token })).json();
  const ticket = new URL(session.dashboardUrl).hash.slice(8);
  const exchange = await post("/api/session/exchange", { ticket }, { Origin: base });
  const Cookie = exchange.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(base + "/api/events/stream", { headers: { Cookie, Origin: "https://other.example" } })).status, 401);
  const abort = new AbortController();
  context.after(() => abort.abort());
  const stream = await fetch(base + "/api/events/stream", { headers: { Cookie, Origin: base }, signal: abort.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  assert.equal((await post("/api/events", { token, event: {
    eventId: "jit-pii", site: "gemini.google.com", action: "redact",
    categories: ["email address"], redactionCount: 1, editApplied: true
  } })).status, 200);
  const notice = new TextDecoder().decode((await reader.read()).value);
  assert.match(notice, /event: activity/);
  assert.equal(notice.includes("email"), false);
  const query = await (await post("/api/events/query", { token })).json();
  assert.equal(query.events[0].eventType, "PII redaction");
  await reader.cancel();
});
