const test = require("node:test");
const assert = require("node:assert/strict");
const { createServiceServer } = require("../local-service.js");

test("collector validates bounded redaction metadata and never stores extra prompt fields", async (context) => {
  const token = "redaction-event-test-token-at-least-32-characters";
  const server = createServiceServer({ token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(base + route, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ token, ...body })
  });
  const event = {
    eventId: "redact-1", site: "gemini.google.com", browser: "Edge", action: "redact",
    categories: ["email address"], redactionCount: 1, editApplied: false,
    prompt: "never store this"
  };
  assert.equal((await post("/api/events", { event })).status, 200);
  const data = await (await post("/api/events/query", {})).json();
  assert.equal(data.events[0].status, "redaction_failed");
  assert.equal(data.events[0].browser, "Edge");
  assert.equal(data.events[0].prompt, undefined);
  assert.equal(JSON.stringify(data).includes("never store this"), false);
  for (const invalid of [
    { ...event, categories: ["actual secret"] },
    { ...event, redactionCount: -1 },
    { ...event, editApplied: "true" },
    { ...event, site: "claude.ai" }
  ]) assert.equal((await post("/api/events", { event: invalid })).status, 400);
  assert.equal((await fetch(base + "/redaction-dashboard.js")).status, 200);
});

test("collector accepts Canadian redaction categories without retaining identifier values", async (context) => {
  const token = "canadian-redaction-test-token-at-least-32-characters";
  const server = createServiceServer({ token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(base + route, {
    method: "POST", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ token, ...body })
  });
  const categories = ["name", "Social Insurance number", "health card number",
    "driver's license number", "street address"];
  for (const [index, site] of ["gemini.google.com", "copilot.microsoft.com", "www.perplexity.ai"].entries()) {
    assert.equal((await post("/api/events", { event: {
      eventId: `canadian-${index}`, site, browser: "Chrome", action: "redact",
      categories, redactionCount: 5, editApplied: true, prompt: "never retain this resident record"
    } })).status, 200);
  }
  const data = await (await post("/api/events/query", {})).json();
  assert.equal(data.events.length, 3);
  for (const event of data.events) {
    assert.deepEqual(event.categories, categories);
    assert.equal(event.redactionCount, 5);
  }
  assert.equal(JSON.stringify(data).includes("never retain"), false);
});
