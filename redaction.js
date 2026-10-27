(() => {
  const { redactSensitiveText } = globalThis.VerifAIRedaction;
  const updating = new WeakSet();
  const lastSeenText = new WeakMap();
  const pendingChecks = new WeakMap();
  let lastComposer = null;
  let notice;
  let noticeTimer;

  const COMPOSER_SELECTOR =
    'textarea, input:not([type]), input[type="text"], input[type="search"], ' +
    '[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';
  // Bulk insertions carry complete text; keystrokes are checked at submission so
  // partially typed values are never replaced mid-word.
  const BULK_INPUT_TYPES = new Set([
    "insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "insertFromYank",
    "insertReplacementText", "insertTranspose", "insertLink"
  ]);
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "BR", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "PRE",
    "BLOCKQUOTE", "SECTION", "ARTICLE", "UL", "OL", "TABLE"
  ]);
  const MAX_REPLACEMENTS = 200;

  function isField(element) {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  }

  function textModel(element) {
    if (isField(element)) return { text: element.value, segments: null };
    let text = "";
    const segments = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        segments.push({ node, start: text.length, end: text.length + node.data.length });
        text += node.data;
      } else if (node.tagName === "BR" || (BLOCK_TAGS.has(node.tagName) && text && !text.endsWith("\n"))) {
        text += "\n";
      }
      node = walker.nextNode();
    }
    return { text, segments };
  }

  function getPromptText(element) {
    if (isField(element)) return element.value;
    if (element.isContentEditable || element.getAttribute("role") === "textbox") {
      return textModel(element).text;
    }
    return null;
  }

  function positionFor(segments, offset, preferEnd) {
    for (const segment of segments) {
      if (offset >= segment.start && offset <= segment.end) {
        if (offset === segment.end && !preferEnd && segments.indexOf(segment) < segments.length - 1) {
          const next = segments[segments.indexOf(segment) + 1];
          if (next.start === offset) return { node: next.node, offset: 0 };
        }
        return { node: segment.node, offset: offset - segment.start };
      }
    }
    return null;
  }

  function placeholder(category) {
    return `[REDACTED: ${category.toUpperCase()}]`;
  }

  function replaceInField(element, text) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, text);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true, composed: true, inputType: "insertReplacementText", data: null
    }));
    return element.value === text;
  }

  const settle = (ms = 0) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function replaceInEditor(element) {
    const selection = element.getRootNode().getSelection?.() || window.getSelection();
    element.focus();
    for (let iteration = 0; iteration < MAX_REPLACEMENTS; iteration += 1) {
      const model = textModel(element);
      const result = redactSensitiveText(model.text);
      if (result.matches.length === 0) return true;
      // Replace the last remaining match so earlier offsets stay valid even if the
      // editor normalizes the DOM between transactions.
      const match = result.matches[result.matches.length - 1];
      const start = positionFor(model.segments, match.start, false);
      const end = positionFor(model.segments, match.end, true);
      if (!start || !end) return false;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      selection.removeAllRanges();
      selection.addRange(range);
      // Editor frameworks (Lexical, ProseMirror) read the DOM selection on the
      // asynchronous selectionchange task; inserting in the same tick would land at
      // their stale caret instead of the matched range.
      await settle();
      if (!document.execCommand("insertText", false, placeholder(match.category))) {
        console.error("VerifAI could not apply a redaction through the editor input transaction.");
        return false;
      }
      await settle();
      if (redactSensitiveText(textModel(element).text).count >= result.count) {
        console.error("VerifAI editor transaction did not remove the sensitive text; stopping.");
        return false;
      }
    }
    return false;
  }

  function setFieldCaret(element, offset) {
    try { element.setSelectionRange(offset, offset); } catch { /* unsupported input type */ }
  }

  function showNotice(categories, applied) {
    if (!notice) {
      notice = document.createElement("div");
      const root = notice.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        :host { all: initial; }
        div {
          position: fixed; right: 18px; top: 18px; z-index: 2147483647;
          max-width: min(420px, calc(100vw - 36px)); padding: 12px 16px;
          border: 1px solid #a6d9bd; border-radius: 10px;
          background: #effaf3; color: #12472c;
          box-shadow: 0 8px 28px #10213a33;
          font: 14px/1.45 system-ui, sans-serif;
        }
        div.failed { border-color: #e0a3a3; background: #fdf1f1; color: #7a1c1c; }
      `;
      const status = document.createElement("div");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      root.append(style, status);
    }
    if (!notice.isConnected) document.documentElement.append(notice);
    const status = notice.shadowRoot.querySelector('[role="status"]');
    status.className = applied ? "" : "failed";
    status.textContent = applied
      ? `VerifAI redacted: ${categories.join(", ")}. Review the edited prompt, then send again.`
      : `VerifAI could not verify redaction of: ${categories.join(", ")}. ` +
        "Do not send; remove the sensitive text manually.";
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.remove(), 8000);
  }

  function reportRedaction(result, applied) {
    try {
      chrome.runtime.sendMessage({
        type: "verifai:redaction-event",
        event: {
          eventId: crypto.randomUUID(),
          site: location.hostname.replace(/^www\./, ""),
          action: "redact",
          categories: result.categories,
          redactionCount: result.count,
          editApplied: applied
        }
      }, (response) => {
        if (chrome.runtime.lastError || !response?.ok || !response.shared) {
          console.warn("VerifAI redaction metadata delivery failed or is pending.",
            chrome.runtime.lastError?.message || response?.error || response?.sharedError);
        }
      });
    } catch (error) {
      console.warn("VerifAI redaction metadata could not be sent.", error?.message);
    }
  }

  function hasSensitiveText(element) {
    const text = getPromptText(element);
    return text !== null && redactSensitiveText(text).count > 0;
  }

  async function redactComposer(element) {
    if (updating.has(element)) return false;
    const original = getPromptText(element);
    if (original === null) return false;
    const result = redactSensitiveText(original);
    if (result.count === 0) return false;

    let applied = false;
    updating.add(element);
    try {
      if (isField(element)) {
        const caret = element.selectionStart ?? original.length;
        applied = replaceInField(element, result.text);
        if (applied) setFieldCaret(element, redactSensitiveText(original.slice(0, caret)).text.length);
      } else {
        applied = await replaceInEditor(element);
        if (applied) {
          const selection = element.getRootNode().getSelection?.() || window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(element);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          // Verify after the editor has reconciled its own model into the DOM.
          await settle(60);
        }
      }
      if (applied) applied = !hasSensitiveText(element);
    } catch (error) {
      console.error("VerifAI could not edit the AI composer. Sensitive text must be removed manually.",
        error?.name);
      applied = false;
    } finally {
      updating.delete(element);
      lastSeenText.set(element, getPromptText(element) ?? "");
    }
    try { showNotice(result.categories, applied); } catch (error) {
      console.warn("VerifAI could not display the redaction notice.", error?.name);
    }
    reportRedaction(result, applied);
    return true;
  }

  function getComposer(target) {
    if (!(target instanceof Element)) return null;
    const composer = target.closest(COMPOSER_SELECTOR);
    if (!composer) return null;
    if (composer instanceof HTMLInputElement && !["text", "search", ""].includes(composer.getAttribute("type") || "")) {
      return null;
    }
    return composer;
  }

  function getEventComposer(event) {
    const path = event.composedPath?.() || [event.target];
    for (const target of path) {
      const composer = getComposer(target);
      if (composer) return composer;
    }
    return null;
  }

  function getFormComposer(form) {
    if (!(form instanceof HTMLFormElement)) return null;
    return [...form.querySelectorAll(COMPOSER_SELECTOR)].map(getComposer).find(Boolean) || null;
  }

  function isVisibleComposer(element) {
    if (element.getAttribute("aria-hidden") === "true") return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0;
  }

  function getSendComposer(event) {
    const path = event.composedPath?.() || [event.target];
    const button = path.find((target) => target instanceof Element &&
      target.matches('button, input[type="submit"], [role="button"]'));
    if (!button) return null;
    const label = [button.getAttribute("aria-label"), button.getAttribute("title"),
      button.getAttribute("data-testid"), button.textContent].filter(Boolean).join(" ");
    if (button.getAttribute("type") !== "submit" &&
        !/\b(send|submit)\b|发送|發送|送信|enviar|envoyer|senden/i.test(label)) return null;
    const form = button.form || button.closest("form");
    if (form) {
      const composer = getFormComposer(form);
      if (composer) return composer;
    }
    if (lastComposer?.isConnected) return lastComposer;
    const root = button.getRootNode();
    const candidates = [...new Set([...root.querySelectorAll(COMPOSER_SELECTOR)].map(getComposer).filter(Boolean))]
      .filter(isVisibleComposer);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function protectSubmission(event, composer) {
    const pending = pendingChecks.get(composer);
    if (pending) {
      clearTimeout(pending);
      pendingChecks.delete(composer);
    }
    // The decision to stop the send must be synchronous; the editor edit itself
    // is applied asynchronously so the site's editor can follow each transaction.
    if (!hasSensitiveText(composer)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void redactComposer(composer);
  }

  function scheduleCheck(composer) {
    if (pendingChecks.has(composer)) return;
    // Let the site's editor finish its own transaction before the text is edited.
    pendingChecks.set(composer, window.setTimeout(() => {
      pendingChecks.delete(composer);
      void redactComposer(composer);
    }, 0));
  }

  window.addEventListener("focusin", (event) => {
    const composer = getEventComposer(event);
    if (composer) lastComposer = composer;
  }, true);

  window.addEventListener("input", (event) => {
    const composer = getEventComposer(event);
    if (!composer || updating.has(composer)) return;
    lastComposer = composer;
    const text = getPromptText(composer) ?? "";
    const previous = lastSeenText.get(composer) ?? "";
    lastSeenText.set(composer, text);
    const bulk = BULK_INPUT_TYPES.has(event.inputType) ||
      (!event.inputType && Math.abs(text.length - previous.length) >= 2);
    if (bulk) scheduleCheck(composer);
  }, true);

  window.addEventListener("submit", (event) => {
    const composer = getEventComposer(event) || getFormComposer(event.target);
    if (composer) protectSubmission(event, composer);
  }, true);

  for (const type of ["paste", "drop"]) {
    window.addEventListener(type, (event) => {
      const composer = getEventComposer(event);
      if (!composer) return;
      lastComposer = composer;
      // Editors such as Quill handle paste themselves without a native input event,
      // so re-check shortly after the editor has applied the clipboard contents.
      scheduleCheck(composer);
      window.setTimeout(() => { if (!updating.has(composer)) void redactComposer(composer); }, 150);
    }, true);
  }

  window.addEventListener("click", (event) => {
    const composer = getSendComposer(event);
    if (composer) protectSubmission(event, composer);
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const composer = getEventComposer(event);
    if (composer) {
      lastComposer = composer;
      protectSubmission(event, composer);
    }
  }, true);
})();
