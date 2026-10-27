const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServiceServer } = require("../local-service.js");

const sharedToken = "verifai-test-token-with-at-least-thirty-two-characters";

async function post(baseUrl, route, payload) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(payload)
  });
}

test("shares and updates browser events through the local service", async (context) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-service-test-"));
  const dataFile = path.join(dataDirectory, "events.json");
  const server = createServiceServer({ token: sharedToken, dataFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => {
      fs.rmSync(dataDirectory, { recursive: true, force: true });
      error ? reject(error) : resolve();
    });
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dashboard = await fetch(`${baseUrl}/`);
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Shadow AI Monitoring Tool/);

  const event = {
    eventId: "cross-browser-claude-1",
    site: "claude.ai",
    action: "prompt"
  };

  const denied = await post(baseUrl, "/api/events", { token: "wrong", event });
  assert.equal(denied.status, 401);

  const prompt = await post(baseUrl, "/api/events", { token: sharedToken, event });
  assert.equal(prompt.status, 200);

  const resolved = await post(baseUrl, "/api/events", {
    token: sharedToken,
    event: {
      ...event,
      action: "resolve",
      outcome: "opened",
      agentName: "Gemini"
    }
  });
  assert.equal(resolved.status, 200);

  const query = await post(baseUrl, "/api/events/query", { token: sharedToken });
  const result = await query.json();
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].site, "claude.ai");
  assert.equal(result.events[0].status, "opened");
  assert.equal(result.events[0].approvedAgent, "Gemini");
  assert.equal(JSON.parse(fs.readFileSync(dataFile, "utf8")).length, 1);

  const visit = await post(baseUrl, "/api/events", {
    token: sharedToken,
    event: {
      eventId: "gemini-visit-1",
      site: "gemini.google.com",
      action: "visit",
      agentName: "Gemini",
      browser: "Brave"
    }
  });
  assert.equal(visit.status, 200);
  const updatedQuery = await post(baseUrl, "/api/events/query", { token: sharedToken });
  const updatedResult = await updatedQuery.json();
  assert.equal(updatedResult.events.length, 2);
  assert.equal(updatedResult.events[1].eventType, "AI site visit");
  assert.equal(updatedResult.events[1].browser, "Brave");
  assert.equal(updatedResult.events[0].browser, "Unknown (legacy)");

  const blockedAgent = await post(baseUrl, "/api/events", {
    token: sharedToken,
    event: {
      eventId: "askaichat-visit-1",
      site: "askaichat.app",
      action: "prompt"
    }
  });
  assert.equal(blockedAgent.status, 200);
  for (const site of ["claude.com", "www.askaichat.app", "auth.anthropic.com", "lovable.dev", "aichatapp.ai"]) {
    const response = await post(baseUrl, "/api/events", {
      token: sharedToken,
      event: { eventId: `blocked-${site.replaceAll(".", "-")}`, site, action: "block" }
    });
    assert.equal(response.status, 200, site);
  }
  const approved = await post(baseUrl, "/api/events", {
    token: sharedToken,
    event: { eventId: "perplexity-visit", site: "www.perplexity.ai", action: "visit", agentName: "Perplexity" }
  });
  assert.equal(approved.status, 200);
  const forbiddenVisit = await post(baseUrl, "/api/events", {
    token: sharedToken,
    event: { eventId: "lovable-old-policy", site: "lovable.dev", action: "visit", agentName: "Lovable" }
  });
  assert.equal(forbiddenVisit.status, 400);
  const finalEvents = (await (await post(baseUrl, "/api/events/query", { token: sharedToken })).json()).events;
  assert.equal(finalEvents.filter((event) => event.status === "blocked").length, 5);
  assert.equal(finalEvents.find((event) => event.site === "aichatapp.ai").site, "aichatapp.ai");
});
