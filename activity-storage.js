const fs = require("node:fs");
const path = require("node:path");

function readConfig(privateDirectory) {
  const configFile = path.join(privateDirectory, "activity-storage.json");
  if (!fs.existsSync(configFile)) return {};
  return JSON.parse(fs.readFileSync(configFile, "utf8").replace(/^\uFEFF/, ""));
}

function writeConfig(privateDirectory, config) {
  const file = path.join(privateDirectory, "activity-storage.json");
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function activityFile(privateDirectory) {
  const config = readConfig(privateDirectory);
  if (config.directory === undefined) return path.join(privateDirectory, "approval-events.json");
  if (typeof config.directory !== "string" || !path.isAbsolute(config.directory)) {
    throw new Error("Activity storage directory must be an absolute path.");
  }
  return path.join(config.directory, "approval-events.json");
}

function eventLogsDirectory(privateDirectory) {
  const config = readConfig(privateDirectory);
  if (config.logsDirectory === undefined) return path.join(privateDirectory, "EVENT LOGS");
  if (typeof config.logsDirectory !== "string" || !path.isAbsolute(config.logsDirectory)) {
    throw new Error("Event log directory must be an absolute path.");
  }
  return config.logsDirectory;
}

function configureEventLogs(privateDirectory, directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new Error("Event log directory must be absolute.");
  }
  fs.mkdirSync(directory, { recursive: true });
  writeConfig(privateDirectory, { ...readConfig(privateDirectory), logsDirectory: path.resolve(directory) });
  return path.resolve(directory);
}

function configureStorage(privateDirectory, directory) {
  if (!path.isAbsolute(directory)) throw new Error("Activity storage directory must be absolute.");
  const source = activityFile(privateDirectory);
  const target = path.join(directory, "approval-events.json");
  fs.mkdirSync(directory, { recursive: true });
  const read = (file) => {
    if (!fs.existsSync(file)) return [];
    const records = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(records)) throw new Error("Activity file must contain an array.");
    return records;
  };
  const records = new Map();
  for (const record of [...read(target), ...read(source)]) {
    if (typeof record.id !== "string") throw new Error("Activity record has no ID.");
    const previous = records.get(record.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw new Error(`Conflicting activity record during migration: ${record.id}`);
    }
    records.set(record.id, record);
  }
  const write = (file, value) => {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  write(target, [...records.values()]);
  writeConfig(privateDirectory, { ...readConfig(privateDirectory), directory: path.resolve(directory) });
  return records.size;
}

if (require.main === module) {
  try {
    if (process.argv[2] === "--logs") {
      console.log(`Event logs will be written under ${configureEventLogs(process.argv[3], process.argv[4])}.`);
    } else {
      console.log(`Activity storage configured; ${configureStorage(process.argv[2], process.argv[3])} records retained.`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { activityFile, configureStorage, eventLogsDirectory, configureEventLogs };
