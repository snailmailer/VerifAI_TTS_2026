const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createWorker({ nativeResponse, fetchResponse } = {}) {
  let messageListener;
  let stored = { approvalEvents: [] };
  const chrome = {
    runtime: {
      getURL: (file) => `chrome-extension://${"a".repeat(32)}/${file}`,
      ...(nativeResponse ? {
        sendNativeMessage(host, request, callback) {
          assert.equal(host, "com.verifai.bridge");
          assert.equal(request.action, "connect");
          callback(nativeResponse);
        }
      } : {}),
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    storage: {
      local: {
        async get(defaults) {
          return structuredClone({ ...defaults, ...stored });
        },
        async set(values) {
          stored = structuredClone({ ...stored, ...values });
        }
      }
    },
    tabs: {
      async remove() {}
    }
  };

  vm.runInNewContext(
    fs.readFileSync(require.resolve("../background.js"), "utf8"),
    {
      chrome, URL, Promise, Set, AbortSignal, VerifAIPolicy: require("../ai-policy.js"),
      VerifAIBrowser: { detectBrowser: async () => "Brave" },
      VerifAIRedactionMetadata: require("../redaction-metadata.js"),
      fetch: fetchResponse,
      console: { ...console, error() {} }
    }
  );

  return {
    async send(message, sender) {
      return new Promise((resolve, reject) => {
        const asynchronous = messageListener(message, sender, (response) => {
          if (response?.ok) resolve(response);
          else reject(new Error(response?.error || "No response"));
        });

        if (asynchronous !== true) reject(new Error("Listener did not keep the channel open"));
      });
    },
    getEvents() {
      return stored.approvalEvents;
    },
    getPendingEvents() {
      return stored.pendingSharedEvents;
    }
  };
}

test("queues only redaction category metadata, never prompt text or matched values", async () => {
  const worker = createWorker();
  await worker.send({
    type: "verifai:redaction-event",
    event: {
      eventId: "redact-1", site: "gemini.google.com", action: "redact",
      categories: ["email address"], redactionCount: 2, editApplied: true,
      prompt: "private input must not be retained", matchedValue: "private"
    }
  }, { url: "https://gemini.google.com/app" });
  const record = worker.getEvents()[0];
  assert.equal(record.eventType, "PII redaction");
  assert.equal(record.browser, "Brave");
  assert.equal(record.redactionCount, 2);
  const metadata = JSON.stringify([worker.getEvents(), worker.getPendingEvents()]);
  assert.equal(metadata.includes("private input must not be retained"), false);
  assert.equal(metadata.includes("matchedValue"), false);
  assert.equal(metadata.includes('"prompt"'), false);
  await assert.rejects(worker.send({
    type: "verifai:redaction-event",
    event: { eventId: "redact-2", site: "gemini.google.com", action: "redact", categories: ["secret-value"], redactionCount: 1, editApplied: true }
  }, { url: "https://gemini.google.com/app" }), /Invalid approval event/);
});

test("stores a JIT prompt event for a Claude visit", async () => {
  const worker = createWorker();
  const eventId = "claude-visit-1";

  const response = await worker.send({
    type: "verifai:approval-event",
    event: {
      action: "prompt",
      eventId,
      site: "claude.ai"
    }
  }, {
    url: "https://claude.ai/new",
    tab: { id: 7 }
  });

  assert.deepEqual(worker.getEvents(), [{
    id: eventId,
    timestamp: worker.getEvents()[0].timestamp,
    site: "claude.ai",
    status: "prompted",
    eventType: "JIT approval prompt",
    approvedAgent: "",
    browser: "Brave",
    privateWindow: false
  }]);
  assert.equal(worker.getPendingEvents().length, 1);
  assert.equal(worker.getPendingEvents()[0].action, "prompt");
  assert.equal(response.ok, true);
  assert.equal(response.shared, false);
  assert.match(response.sharedError, /Native bridge unavailable/);
});

test("stores and queues approved AI site visits without page content", async () => {
  const worker = createWorker();
  await worker.send({
    type: "verifai:ai-activity",
    event: {
      eventId: "gemini-visit-1",
      site: "gemini.google.com",
      action: "visit",
      agentName: "Gemini"
    }
  }, {
    url: "https://gemini.google.com/app",
    tab: { id: 8 }
  });

  test("records hard-block attempts only from the extension block page", async () => {
    const worker = createWorker();
    const message = {
      type: "verifai:blocked-activity",
      event: { eventId: "blocked-claude", site: "claude.ai", action: "block" }
    };
    await assert.rejects(worker.send(message, { url: "https://claude.ai/" }), /Invalid sender URL/);
    const response = await worker.send(message, {
      url: `chrome-extension://${"a".repeat(32)}/blocked.html?site=claude.ai`
    });
    assert.equal(response.ok, true);
    assert.equal(worker.getEvents()[0].status, "blocked");
    assert.equal(worker.getPendingEvents()[0].action, "block");
  });

  test("Perplexity is approved and Lovable is no longer an approved visit", async () => {
    const worker = createWorker();
    const message = (site, agentName) => ({
      type: "verifai:ai-activity",
      event: { eventId: "policy-visit", site, action: "visit", agentName }
    });
    await worker.send(message("perplexity.ai", "Perplexity"), { url: "https://www.perplexity.ai/" });
    await assert.rejects(worker.send(message("lovable.dev", "Lovable"), { url: "https://lovable.dev/" }), /Invalid approval event/);
  });

  test("automatically authenticates queued events through native messaging", async () => {
    let received;
    const worker = createWorker({
      nativeResponse: { ok: true, token: "test-only-native-credential" },
      fetchResponse: async (url, options) => {
        assert.equal(url, "http://127.0.0.1:43821/api/events");
        received = JSON.parse(options.body);
        return { ok: true, json: async () => ({ ok: true }) };
      }
    });
    const response = await worker.send({
      type: "verifai:approval-event",
      event: { eventId: "native-1", action: "prompt", site: "claude.ai" }
    }, { url: "https://claude.ai/new", tab: { id: 9 } });
    assert.equal(response.shared, true);
    assert.equal(received.token, "test-only-native-credential");
    assert.equal(received.event.browser, "Brave");
    assert.equal(worker.getPendingEvents().length, 0);
  });

  assert.equal(worker.getEvents().length, 1);
  assert.equal(worker.getEvents()[0].eventType, "AI site visit");
  assert.equal(worker.getEvents()[0].site, "gemini.google.com");
  assert.equal(worker.getPendingEvents()[0].action, "visit");
});
