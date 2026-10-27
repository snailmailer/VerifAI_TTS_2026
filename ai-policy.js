(function (root) {
  const approved = [
    { name: "Copilot", domains: ["copilot.microsoft.com", "copilot.com", "m365.cloud.microsoft"], url: "https://copilot.microsoft.com/" },
    { name: "Gemini", domains: ["gemini.google.com"], url: "https://gemini.google.com/" },
    { name: "Perplexity", domains: ["perplexity.ai"], url: "https://www.perplexity.ai/" }
  ];
  // Domain inventory, not a classifier for every website offering an AI feature.
  const blocked = [
    "claude.ai", "claude.com", "anthropic.com", "askaichat.app", "aichatapp.ai",
    "chatgpt.com", "chat.com", "openai.com", "lovable.dev", "lovable.app",
    "poe.com", "deepseek.com", "deepseek.ai", "grok.com", "x.ai",
    "meta.ai", "mistral.ai", "chat.mistral.ai", "you.com",
    "character.ai", "c.ai", "pi.ai", "inflection.ai", "huggingface.co",
    "huggingface.com", "hf.co", "hf.space", "iask.ai", "devin.ai", "gamma.app",
    "qwen.ai", "qwenlm.ai", "tongyi.com", "kimi.com", "kimi.ai", "moonshot.cn",
    "manus.im", "genspark.ai", "replit.com", "replit.ai", "bolt.new",
    "cursor.com", "cursor.sh", "windsurf.com", "codeium.com",
    "v0.dev", "v0.app", "phind.com", "blackbox.ai", "jasper.ai",
    "writesonic.com", "copy.ai", "rytr.me", "chatsonic.com",
    "askyourpdf.com", "chatpdf.com", "notebooklm.google.com",
    "aistudio.google.com", "sora.com", "midjourney.com", "runwayml.com",
    "leonardo.ai", "ideogram.ai", "suno.com", "udio.com", "elevenlabs.io"
  ];
  const matches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
  const approvedAgent = (host) => approved.find((agent) =>
    agent.domains.some((domain) => matches(host.toLowerCase(), domain)))?.name || "";
  const blockedHost = (host) => !approvedAgent(host) &&
    blocked.some((domain) => matches(host.toLowerCase(), domain));
  const policy = { approved, blocked, approvedAgent, blockedHost };
  if (typeof module !== "undefined" && module.exports) module.exports = policy;
  else root.VerifAIPolicy = policy;
})(globalThis);
