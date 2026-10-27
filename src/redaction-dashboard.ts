interface RedactionRecord {
  id: string;
  timestamp: string;
  site: string;
  browser?: string;
  privateWindow?: boolean;
  eventType?: string;
  categories?: string[];
  redactionCount?: number;
  editApplied?: boolean;
}

interface RedactionDashboardAPI {
  render(records: RedactionRecord[]): void;
}

interface Window {
  VerifAIRedactionDashboard: RedactionDashboardAPI;
}

(() => {
  function element<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing redaction dashboard element: ${id}`);
    return node as T;
  }
  const activity = element("activity-panel");
  const redactions = element("redaction-panel");
  const activityTab = element<HTMLButtonElement>("activity-tab");
  const redactionTab = element<HTMLButtonElement>("redaction-tab");
  const rows = element<HTMLTableSectionElement>("redaction-events-body");
  const filter = element<HTMLInputElement>("redaction-filter");
  let records: RedactionRecord[] = [];

  function selectTab(showRedactions: boolean): void {
    activity.hidden = showRedactions;
    redactions.hidden = !showRedactions;
    activityTab.setAttribute("aria-selected", String(!showRedactions));
    redactionTab.setAttribute("aria-selected", String(showRedactions));
    activityTab.tabIndex = showRedactions ? -1 : 0;
    redactionTab.tabIndex = showRedactions ? 0 : -1;
  }
  activityTab.addEventListener("click", () => selectTab(false));
  redactionTab.addEventListener("click", () => selectTab(true));
  const tabs = [activityTab, redactionTab];
  activityTab.tabIndex = 0;
  redactionTab.tabIndex = -1;
  tabs.forEach((tab, index) => tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    selectTab(next === 1);
    tabs[next].focus();
  }));

  function browserLabel(record: RedactionRecord): string {
    const name = record.browser || "Unknown (legacy)";
    return record.privateWindow === true ? `${name} (private)` : name;
  }

  function render(): void {
    const query = filter.value.trim().toLowerCase();
    const all = records.filter((record) => record.eventType === "PII redaction");
    const visible = all.filter((record) =>
      `${record.site} ${browserLabel(record)} ${(record.categories || []).join(" ")}`
        .toLowerCase().includes(query)
    ).sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    rows.replaceChildren();
    for (const record of visible) {
      const row = document.createElement("tr");
      const values = [
        new Date(record.timestamp).toLocaleString(), record.site,
        browserLabel(record), (record.categories || []).join(", "),
        String(record.redactionCount || 0),
        record.editApplied ? "Editor edit verified; review before sending" : "Editor edit not verified; do not send"
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      rows.append(row);
    }
    element("redaction-empty").hidden = visible.length > 0;
    element("redaction-total").textContent = String(all.length);
  }
  filter.addEventListener("input", render);
  window.VerifAIRedactionDashboard = {
    render(nextRecords) { records = nextRecords; render(); }
  };
})();
