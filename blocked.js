(() => {
  const site = new URLSearchParams(location.search).get("site") || "";
  const status = document.getElementById("report-status");
  if (!VerifAIPolicy.blockedHost(site)) {
    status.textContent = "No valid blocked domain was supplied; no activity was recorded.";
    return;
  }
  document.getElementById("blocked-site").textContent = site;
  for (const agent of VerifAIPolicy.approved) {
    const link = document.createElement("a");
    link.textContent = `Open ${agent.name}`;
    link.href = agent.url;
    link.className = "primary";
    document.getElementById("approved-links").append(link);
  }
  chrome.runtime.sendMessage({
    type: "verifai:blocked-activity",
    event: { eventId: crypto.randomUUID(), site, action: "block" }
  }, (response) => {
    status.textContent = chrome.runtime.lastError || !response?.ok
      ? `Could not record this attempt: ${chrome.runtime.lastError?.message || response?.error}`
      : response.shared
        ? "Blocked attempt recorded and shared with the dashboard."
        : `Blocked attempt saved in this browser; dashboard delivery is pending. ${response.sharedError || "Check the native bridge."}`;
  });
})();
