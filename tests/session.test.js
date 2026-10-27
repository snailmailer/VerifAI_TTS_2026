const test = require("node:test");
const assert = require("node:assert/strict");
const { createServiceServer } = require("../local-service.js");

test("dashboard ticket is authenticated, single-use, and grants read-only cookie access", async (context) => {
  const token = "test-native-session-token-at-least-32-characters";
  const server = createServiceServer({ token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, headers = {}) => fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", ...headers },
    body: JSON.stringify(body)
  });
  const signedOut = await post("/api/events/query", {}, { Origin: base });
  assert.equal(signedOut.status, 401);
  assert.match((await signedOut.json()).error, /Dashboard sign-in required or expired/);
  const invalidWriter = await post("/api/events", { token: "wrong" }, { Origin: base });
  assert.equal(invalidWriter.status, 401);
  assert.equal((await invalidWriter.json()).error, "Invalid service token.");
  assert.equal((await post("/api/session", {})).status, 401);
  const ticketResponse = await post("/api/session", { token });
  assert.equal(ticketResponse.status, 200);
  const { dashboardUrl } = await ticketResponse.json();
  const ticket = new URLSearchParams(new URL(dashboardUrl).hash.slice(1)).get("ticket");
  assert.ok(ticket);
  assert.equal((await post("/api/session/exchange", { ticket }, { Origin: "https://untrusted.example" })).status, 403);
  const exchange = await post("/api/session/exchange", { ticket }, { Origin: base });
  assert.equal(exchange.status, 200);
  const cookieHeader = exchange.headers.get("set-cookie");
  assert.match(cookieHeader, /HttpOnly; SameSite=Strict/);
  const Cookie = cookieHeader.split(";")[0];
  assert.equal((await post("/api/session/exchange", { ticket }, { Origin: base })).status, 401);
  assert.equal((await post("/api/events/query", {}, { Cookie, Origin: base })).status, 200);
  assert.equal((await post("/api/events/query", {}, { Cookie, Origin: "https://untrusted.example" })).status, 401);
  assert.equal((await post("/api/events", {}, { Cookie, Origin: base })).status, 401);
});
