(() => {
  const host = window.location.hostname.replace(/^www\./, "");
  const eventId = crypto.randomUUID();
  const approvedAgents = [
    { name: "Copilot", url: "https://copilot.microsoft.com/" },
    { name: "Perplexity", url: "https://www.perplexity.ai/" },
    { name: "Gemini", url: "https://gemini.google.com/" }
  ];
  const choiceTimeoutMs = 30_000;
  const root = document.createElement("div");
  const shadow = root.attachShadow({ mode: "closed" });
  let finished = false;
  let countdown;

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .veil {
      position: fixed; inset: 0; z-index: 2147483647;
      display: grid; place-items: center; padding: 24px;
      background: rgba(9, 19, 43, .72);
      font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #122044;
    }
    .card {
      box-sizing: border-box; width: min(480px, 100%); padding: 28px;
      border-radius: 16px; background: #fff;
      box-shadow: 0 24px 80px rgba(0, 0, 0, .28);
    }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
    .brand img { width: 46px; height: 46px; object-fit: contain; }
    .brand strong { font-size: 20px; letter-spacing: -.03em; }
    h1 { margin: 0 0 8px; font-size: 21px; }
    p { margin: 0 0 16px; color: #4b5874; }
    .warning {
      padding: 12px 14px; margin: 0 0 20px; border-radius: 9px;
      color: #713d00; background: #fff4d6; font-size: 13px;
    }
    .site { color: #122044; font-weight: 650; overflow-wrap: anywhere; }
    .agents { display: grid; gap: 10px; }
    button {
      border: 0; border-radius: 9px; padding: 11px 15px;
      font: inherit; font-weight: 650; cursor: pointer;
    }
    button:focus-visible { outline: 3px solid #79aaff; outline-offset: 2px; }
    .agent { background: #1769e0; color: white; text-align: left; }
    .leave { margin-top: 12px; background: #eef2f8; color: #122044; }
    .note { margin-top: 16px; font-size: 12px; color: #6a7590; }
  `;

  const veil = document.createElement("main");
  veil.className = "veil";
  veil.setAttribute("role", "dialog");
  veil.setAttribute("aria-modal", "true");
  veil.setAttribute("aria-labelledby", "verifai-title");
  veil.innerHTML = `
    <section class="card">
      <div class="brand">
        <img alt="" src="${chrome.runtime.getURL("VerifAI Logo.png")}">
        <strong>VerifAI</strong>
      </div>
      <h1 id="verifai-title">Please only use company approved applications.</h1>
      <p><span class="site"></span> is not an approved AI agent. Select an approved agent below.</p>
      <div class="warning" role="alert">
        Warning: This site is not approved. If you do not select an approved agent within
        <span class="countdown">30</span> seconds, this tab will close.
      </div>
      <div class="agents"></div>
      <button class="leave" type="button">Close this tab now</button>
      <div class="note">The dashboard records this prompt and your choice. Page and prompt contents are not collected.</div>
    </section>
  `;
  veil.querySelector(".site").textContent = host;
  const agentList = veil.querySelector(".agents");
  for (const agent of approvedAgents) {
    const button = document.createElement("button");
    button.className = "agent";
    button.type = "button";
    button.textContent = `Open ${agent.name}`;
    button.addEventListener("click", () => resolve("opened", agent));
    agentList.append(button);
  }
  shadow.append(style, veil);

  const sendEvent = (action, outcome, agentName, callback) => {
    chrome.runtime.sendMessage({
      type: "verifai:approval-event",
      event: { action, eventId, site: host, outcome, agentName }
    }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        console.warn(
          "VerifAI could not update the approval event.",
          chrome.runtime.lastError?.message || response?.error
        );
      } else if (!response.shared) {
        console.warn(
          "VerifAI event is only available in this browser profile.",
          response.sharedError || "Connect this browser to the local event service."
        );
      }
      callback?.(response);
    });
  };

  const leavePage = () => {
    window.location.replace("about:blank");
  };

  const resolve = (outcome, agent) => {
    if (finished) return;
    finished = true;
    clearInterval(countdown);
    root.remove();
    document.documentElement.style.overflow = "";
    sendEvent("resolve", outcome, agent?.name, (response) => {
      if (agent) {
        window.location.assign(agent.url);
      } else {
        if (!response?.closed) leavePage();
      }
    });
  };

  veil.querySelector(".leave").addEventListener("click", () => resolve("left"));

  const mount = () => {
    if (!document.documentElement || finished) return;
    document.documentElement.append(root);
    document.documentElement.style.overflow = "hidden";
    shadow.querySelector("button").focus();
    const deadline = Date.now() + choiceTimeoutMs;
    countdown = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      shadow.querySelector(".countdown").textContent = String(remaining);
      if (remaining === 0) resolve("timed_out");
    }, 250);
    sendEvent("prompt");
  };

  if (document.documentElement) {
    mount();
  } else {
    new MutationObserver((_, observer) => {
      if (document.documentElement) {
        observer.disconnect();
        mount();
      }
    }).observe(document, { childList: true });
  }
})();
