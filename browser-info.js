(function (root) {
  async function detectBrowser(environment = root) {
    const runtime = environment.chrome?.runtime;
    if (runtime?.getBrowserInfo) {
      const info = await runtime.getBrowserInfo();
      if (info.name === "Firefox") return "Firefox";
    }
    const navigator = environment.navigator;
    if (navigator?.brave?.isBrave && await navigator.brave.isBrave()) return "Brave";
    const brands = navigator?.userAgentData?.brands?.map((entry) => entry.brand) || [];
    if (brands.includes("Brave")) return "Brave";
    if (brands.includes("Microsoft Edge")) return "Edge";
    const agent = navigator?.userAgent || "";
    if (/Edg\//.test(agent)) return "Edge";
    if (/Firefox\//.test(agent)) return "Firefox";
    if (/OPR\//.test(agent)) return "Opera";
    if (/Chrome\//.test(agent)) return "Chrome";
    if (/Safari\//.test(agent)) return "Safari";
    return "Unknown";
  }
  const api = { detectBrowser };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VerifAIBrowser = api;
})(globalThis);
