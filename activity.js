(() => {
  if (window.top !== window) return;
  const hostname = window.location.hostname.replace(/^www\./, "");
  const agentName = VerifAIPolicy.approvedAgent(hostname);
  if (!agentName) return;

  chrome.runtime.sendMessage({
    type: "verifai:ai-activity",
    event: {
      eventId: crypto.randomUUID(),
      site: hostname,
      action: "visit",
      agentName
    }
  }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      console.warn(
        "VerifAI could not record the AI site visit.",
        chrome.runtime.lastError?.message || response?.error
      );
    } else if (!response.shared) {
      console.warn(
        "VerifAI AI site visit is only available in this browser profile.",
        response.sharedError || "Connect this browser to the local event service."
      );
    }
  });
})();
