const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const policy = require("../ai-policy.js");
const manifest = require("../manifest.json");
const staticRules = require("../ai-block-rules.json");

test("only the three approved services are allowed, without suffix impersonation", () => {
  assert.deepEqual(policy.approved.map((agent) => agent.name), ["Copilot", "Gemini", "Perplexity"]);
  assert.equal(policy.approvedAgent("www.perplexity.ai"), "Perplexity");
  assert.equal(policy.approvedAgent("gemini.google.com.attacker.example"), "");
  assert.equal(policy.approvedAgent("notcopilot.com"), "");
  for (const host of ["claude.ai", "www.claude.ai", "claude.com", "auth.anthropic.com", "askaichat.app", "www.askaichat.app", "lovable.dev", "huggingface.co", "www.huggingface.co", "huggingface.com", "demo.hf.space", "hf.co", "iask.ai", "devin.ai", "gamma.app"]) {
    assert.equal(policy.blockedHost(host), true, host);
  }
  assert.equal(policy.blockedHost("notclaude.ai"), false);
});

test("static network blocks are enabled without content scripts or background readiness", () => {
  assert.ok(manifest.permissions.includes("declarativeNetRequest"));
  assert.equal(manifest.declarative_net_request.rule_resources[0].enabled, true);
  assert.equal(staticRules[0].action.type, "block");
  // Omission of both type fields EXCLUDES main_frame. Explicitly exclude nothing.
  assert.deepEqual(staticRules[0].condition.excludedResourceTypes, []);
  assert.equal(staticRules[0].condition.resourceTypes, undefined);
  assert.deepEqual(staticRules[0].condition.requestDomains, policy.blocked);
  assert.equal(manifest.content_scripts.some((script) => script.js.includes("content.js")), false);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  for (const domain of policy.approved.flatMap((agent) => agent.domains)) {
    assert.equal(policy.blockedHost(domain), false, domain);
  }
});

test("block-page redirects cover login/download paths and discard URL paths and query contents", async () => {
  let dynamic;
  const updates = [];
  const chrome = {
    runtime: { getURL: (file) => `chrome-extension://${"a".repeat(32)}/${file}`, onMessage: { addListener() {} } },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async (value) => { dynamic = value.addRules; }
    },
    tabs: {
      query: async () => [
        { id: 1, url: "https://claude.ai/existing" },
        { id: 2, url: "https://gemini.google.com/app" }
      ],
      update: async (id, value) => updates.push({ id, ...value })
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), {
    chrome, VerifAIPolicy: policy, URL, console
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dynamic.length, policy.blocked.length);
  for (const address of [
    "https://claude.ai/login", "https://claude.com/download",
    "https://auth.anthropic.com/login?secret=not-recorded",
    "http://www.askaichat.app/download/file.exe", "https://lovable.dev/",
    "https://huggingface.co/login", "https://huggingface.co/models", "https://demo.hf.space/",
    "https://aichatapp.ai/", "https://www.aichatapp.ai/zh/login", "https://chat.aichatapp.ai/ru/download"
  ]) {
    const rule = dynamic.find((entry) => new RegExp(entry.condition.regexFilter).test(address));
    assert.ok(rule, address);
    const match = address.match(new RegExp(rule.condition.regexFilter));
    const target = rule.action.redirect.regexSubstitution.replace("\\1", match[1]);
    assert.equal(new URL(target).searchParams.get("site"), new URL(address).hostname);
    assert.equal(target.includes("secret"), false);
    assert.deepEqual(Array.from(rule.condition.resourceTypes), ["main_frame"]);
    assert.ok(rule.priority > staticRules[0].priority);
  }
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 1);
  for (const address of ["https://www.perplexity.ai/", "https://gemini.google.com/app", "https://copilot.microsoft.com/"]) {
    assert.equal(dynamic.some((rule) => new RegExp(rule.condition.regexFilter).test(address)), false);
  }
  assert.equal(dynamic.some((rule) => new RegExp(rule.condition.regexFilter).test("https://aichatapp.ai.example.org/")), false);
});
