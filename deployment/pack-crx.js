const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createZip } = require("./zip.js");
const { crxIdBytes, chromiumIdFromPublicKeyDer } = require("./extension-id.js");

function varint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

// Length-delimited protobuf field (wire type 2) used by the CRX3 header messages.
function field(fieldNumber, payload) {
  return Buffer.concat([varint((fieldNumber << 3) | 2), varint(payload.length), payload]);
}

function collectFiles(directory, base = directory) {
  const entries = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) entries.push(...collectFiles(full, base));
    else entries.push({ name: path.relative(base, full), data: fs.readFileSync(full) });
  }
  return entries;
}

function loadOrCreateKey(keyPath) {
  if (fs.existsSync(keyPath)) {
    return crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
  }
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return privateKey;
}

function packCrx(extensionDir, keyPath) {
  const privateKey = loadOrCreateKey(keyPath);
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const id = chromiumIdFromPublicKeyDer(publicKeyDer);
  const archive = createZip(collectFiles(extensionDir));

  const signedHeaderData = field(1, crxIdBytes(publicKeyDer)); // SignedData { crx_id = 1 }
  const sizeHeader = Buffer.alloc(4);
  sizeHeader.writeUInt32LE(signedHeaderData.length, 0);
  const signedPayload = Buffer.concat([
    Buffer.from("CRX3 SignedData\0", "latin1"),
    sizeHeader,
    signedHeaderData,
    archive
  ]);
  const signature = crypto.sign("sha256", signedPayload, {
    key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING
  });

  const proof = Buffer.concat([field(1, publicKeyDer), field(2, signature)]); // AsymmetricKeyProof
  const header = Buffer.concat([field(2, proof), field(10000, signedHeaderData)]); // CrxFileHeader
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);

  return { id, publicKeyDer, signature, signedHeaderData, archive, crx: Buffer.concat([prefix, header, archive]) };
}

function updateXml(id, codebaseUrl, version) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n` +
    `  <app appid="${escape(id)}">\n` +
    `    <updatecheck codebase="${escape(codebaseUrl)}" version="${escape(version)}" />\n` +
    `  </app>\n` +
    `</gupdate>\n`;
}

module.exports = { packCrx, updateXml, collectFiles, loadOrCreateKey };
