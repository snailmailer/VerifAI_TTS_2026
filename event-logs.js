const fs = require("node:fs");
const path = require("node:path");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REDACTION_TYPE = "PII redaction";
const REPORTS = {
  activity: { prefix: "AI_Activity_Logs", title: "AI Activity Logs" },
  redaction: { prefix: "Redacted_PII_Logs", title: "Redacted PII Logs" }
};

function pad(value) {
  return String(value).padStart(2, "0");
}

// File date: dd-MMM-yyyy (e.g. 26-Oct-2026). Folder: <yyyy>\<MMM-yyyy> (e.g. 2026\Oct-2026).
function dayKey(date) {
  return `${pad(date.getDate())}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function monthKey(date) {
  return `${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function yearKey(date) {
  return String(date.getFullYear());
}

function sameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function localTimestamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function logPaths(baseDirectory, date) {
  const directory = path.join(baseDirectory, yearKey(date), monthKey(date));
  const day = dayKey(date);
  const files = {};
  for (const [key, report] of Object.entries(REPORTS)) {
    files[key] = {
      json: path.join(directory, `${report.prefix}_${day}.json`),
      pdf: path.join(directory, `${report.prefix}_${day}.pdf`)
    };
  }
  return { directory, day, ...files };
}

function isRedaction(record) {
  return record.eventType === REDACTION_TYPE;
}

function recordsForDay(records, date) {
  return records
    .filter((record) => typeof record.timestamp === "string" && sameLocalDay(new Date(record.timestamp), date))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function describe(record) {
  const when = localTimestamp(new Date(record.timestamp));
  const browser = (record.browser || "Unknown (legacy)") + (record.privateWindow === true ? " (private)" : "");
  if (isRedaction(record)) {
    const outcome = record.editApplied ? "VERIFIED" : "NOT VERIFIED";
    return `${when} | ${browser} | ${record.site} | ${record.redactionCount || 0} item(s) | editor edit ${outcome} | ` +
      (record.categories || []).join(", ");
  }
  const agent = record.approvedAgent ? ` | ${record.approvedAgent}` : "";
  return `${when} | ${browser} | ${record.site} | ${record.eventType || "event"} | ${record.status || ""}${agent}`;
}

function wrap(line, width = 104) {
  const lines = [];
  let remaining = line;
  while (remaining.length > width) {
    let cut = remaining.lastIndexOf(" ", width);
    if (cut < width / 2) cut = width;
    lines.push(remaining.slice(0, cut));
    remaining = `    ${remaining.slice(cut).trimStart()}`;
  }
  lines.push(remaining);
  return lines;
}

function pdfText(value) {
  // Helvetica with WinAnsi encoding: characters outside Latin-1 are replaced.
  const latin = Array.from(String(value)).map((char) => (char.charCodeAt(0) > 255 ? "?" : char)).join("");
  return latin.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function renderPdf(title, subtitle, lines) {
  const pageHeight = 792;
  const pageWidth = 612;
  const margin = 54;
  const lineHeight = 12;
  const bodyTop = pageHeight - margin - 44;
  const linesPerPage = Math.floor((bodyTop - margin) / lineHeight);
  const pages = [];
  for (let index = 0; index < Math.max(lines.length, 1); index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }
  const objects = [];
  const addObject = (body) => { objects.push(body); return objects.length; };
  const catalog = addObject(null);
  const pagesObject = addObject(null);
  const font = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds = [];
  pages.forEach((pageLines, pageIndex) => {
    const body = [
      "BT", "/F1 14 Tf", `${margin} ${pageHeight - margin - 14} Td`, `(${pdfText(title)}) Tj`, "ET",
      "BT", "/F1 9 Tf", `${margin} ${pageHeight - margin - 30} Td`,
      `(${pdfText(`${subtitle}  -  Page ${pageIndex + 1} of ${pages.length}`)}) Tj`, "ET",
      "BT", "/F1 9 Tf", `${lineHeight} TL`, `${margin} ${bodyTop} Td`
    ];
    for (const line of pageLines) body.push(`(${pdfText(line)}) Tj`, "T*");
    body.push("ET");
    const stream = body.join("\n");
    const content = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const page = addObject(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
    pageIds.push(page);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`;
  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = ["%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"];
  const offsets = [];
  let position = Buffer.byteLength(chunks[0], "latin1");
  objects.forEach((body, index) => {
    offsets.push(position);
    const chunk = `${index + 1} 0 obj\n${body}\nendobj\n`;
    chunks.push(chunk);
    position += Buffer.byteLength(chunk, "latin1");
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (const offset of offsets) xref.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  chunks.push(xref.join(""));
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${position}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "latin1");
}

function writeAtomic(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function writeDailyLogs(baseDirectory, records, date = new Date()) {
  if (typeof baseDirectory !== "string" || !path.isAbsolute(baseDirectory)) {
    throw new Error("Event log directory must be an absolute path.");
  }
  const target = logPaths(baseDirectory, date);
  fs.mkdirSync(target.directory, { recursive: true });
  const dayRecords = recordsForDay(records, date);
  const generatedAt = new Date().toISOString();
  const counts = {};
  for (const [key, report] of Object.entries(REPORTS)) {
    const selected = dayRecords.filter((record) => (key === "redaction") === isRedaction(record));
    counts[key] = selected.length;
    writeAtomic(target[key].json, `${JSON.stringify({
      report: report.title,
      date: target.day,
      generatedAt,
      timeZoneOffsetMinutes: -date.getTimezoneOffset(),
      count: selected.length,
      records: selected
    }, null, 2)}\n`);
    const lines = selected.length
      ? selected.flatMap((record) => wrap(describe(record)))
      : ["No events were recorded for this day."];
    writeAtomic(target[key].pdf, renderPdf(
      `VerifAI ${report.title} - ${target.day}`,
      `${selected.length} event(s). Generated ${localTimestamp(new Date(generatedAt))}. Metadata only; no prompt text or identifier values.`,
      lines
    ));
  }
  return { directory: target.directory, day: target.day, counts,
    files: [target.activity.json, target.activity.pdf, target.redaction.json, target.redaction.pdf] };
}

// Earlier releases wrote <base>\<MMM>_<yyyy>\<prefix>_<dd>_<MMM>_<yyyy>.{json,pdf}. Move those
// files into the <yyyy>\<MMM-yyyy> layout once; nothing is deleted except emptied folders.
function migrateLegacyLogs(baseDirectory) {
  if (!fs.existsSync(baseDirectory)) return [];
  const moved = [];
  const legacyFolder = /^([A-Z][a-z]{2})_(\d{4})$/;
  const legacyFile = /^(AI_Activity_Logs|Redacted_PII_Logs)_(\d{2})_([A-Z][a-z]{2})_(\d{4})\.(json|pdf)$/;
  for (const entry of fs.readdirSync(baseDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !legacyFolder.test(entry.name)) continue;
    const source = path.join(baseDirectory, entry.name);
    for (const file of fs.readdirSync(source)) {
      const match = legacyFile.exec(file);
      if (!match) continue;
      const [, prefix, day, month, year, extension] = match;
      if (!MONTHS.includes(month)) continue;
      const targetDirectory = path.join(baseDirectory, year, `${month}-${year}`);
      const target = path.join(targetDirectory, `${prefix}_${day}-${month}-${year}.${extension}`);
      fs.mkdirSync(targetDirectory, { recursive: true });
      if (fs.existsSync(target)) continue;
      fs.renameSync(path.join(source, file), target);
      moved.push(target);
    }
    if (fs.readdirSync(source).length === 0) fs.rmdirSync(source);
  }
  return moved;
}

module.exports = { dayKey, monthKey, yearKey, logPaths, recordsForDay, isRedaction, renderPdf, writeDailyLogs, migrateLegacyLogs, REDACTION_TYPE };
