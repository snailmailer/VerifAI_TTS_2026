const test = require("node:test");
const assert = require("node:assert/strict");
const { detectBrowser } = require("../browser-info.js");

test("detects Brave before its Chrome-compatible user agent", async () => {
  assert.equal(await detectBrowser({ navigator: { userAgent: "Chrome/140.0", brave: { isBrave: async () => true } } }), "Brave");
});

test("detects Edge, Chrome, Firefox and unknown clients without assuming Chrome", async () => {
  for (const [userAgent, expected] of [
    ["Chrome/140 Edg/140", "Edge"], ["Chrome/140", "Chrome"], ["Firefox/145", "Firefox"], ["", "Unknown"]
  ]) assert.equal(await detectBrowser({ navigator: { userAgent } }), expected);
  assert.equal(await detectBrowser({ chrome: { runtime: { getBrowserInfo: async () => ({ name: "Firefox" }) } } }), "Firefox");
});
