const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createZip, crc32 } = require("../deployment/zip.js");
const {
  chromiumIdFromPublicKeyDer, chromiumIdFromKeyPem, crxIdBytes, encodeChromiumId, GECKO_ID
} = require("../deployment/extension-id.js");
const { packCrx, updateXml } = require("../deployment/pack-crx.js");
const { packXpi } = require("../deployment/pack-xpi.js");

test("ZIP archive has a valid end-of-central-directory and round-trips entries", () => {
  const files = [
    { name: "manifest.json", data: Buffer.from('{"name":"VerifAI"}') },
    { name: "sub/dir/data.txt", data: Buffer.from("x".repeat(5000)) }
  ];
  const zip = createZip(files);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 2);
  // Decompress the second (deflated) entry by locating its local header payload.
  const nameBuffer = Buffer.from("sub/dir/data.txt");
  const headerOffset = zip.indexOf(nameBuffer) - 30;
  const method = zip.readUInt16LE(headerOffset + 8);
  const compSize = zip.readUInt32LE(headerOffset + 18);
  const dataStart = headerOffset + 30 + nameBuffer.length;
  const payload = zip.subarray(dataStart, dataStart + compSize);
  const restored = method === 8 ? zlib.inflateRawSync(payload) : payload;
  assert.equal(restored.toString(), "x".repeat(5000));
  assert.equal(zip.readUInt32LE(headerOffset + 14), crc32(Buffer.from("x".repeat(5000))));
});

test("Chromium extension ID follows the SHA-256 first-128-bits a-p mapping", () => {
  const digest = crypto.createHash("sha256").update(Buffer.from("example")).digest().subarray(0, 16);
  const expected = Array.from(digest).map((byte) =>
    String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 0x0f))).join("");
  assert.equal(encodeChromiumId(digest), expected);
  assert.match(expected, /^[a-p]{32}$/);
});

test("the same key yields a stable 32-char ID across calls (device-independent)", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const der = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const id = chromiumIdFromPublicKeyDer(der);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(chromiumIdFromKeyPem(pem), id);
  assert.equal(encodeChromiumId(crxIdBytes(der)), id);
});

test("packCrx produces a verifiable CRX3 whose signed crx_id matches the computed ID", (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-crx-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const extension = path.join(dir, "ext");
  fs.mkdirSync(extension);
  fs.writeFileSync(path.join(extension, "manifest.json"), '{"name":"VerifAI Approval Gate","version":"0.5.4"}');
  const keyPath = path.join(dir, "verifai-chromium.pem");

  const first = packCrx(extension, keyPath);
  assert.equal(first.crx.subarray(0, 4).toString("latin1"), "Cr24");
  assert.equal(first.crx.readUInt32LE(4), 3);
  assert.match(first.id, /^[a-p]{32}$/);
  assert.equal(chromiumIdFromPublicKeyDer(first.publicKeyDer), first.id);
  assert.ok(crxIdBytes(first.publicKeyDer).equals(first.signedHeaderData.subarray(first.signedHeaderData.length - 16)));

  const size = Buffer.alloc(4);
  size.writeUInt32LE(first.signedHeaderData.length, 0);
  const signedPayload = Buffer.concat([
    Buffer.from("CRX3 SignedData\0", "latin1"), size, first.signedHeaderData, first.archive
  ]);
  const publicKey = crypto.createPublicKey({ key: first.publicKeyDer, format: "der", type: "spki" });
  assert.equal(crypto.verify("sha256", signedPayload, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, first.signature), true);

  // Reusing the stored key keeps the ID stable (what makes forcelist deployment work).
  const second = packCrx(extension, keyPath);
  assert.equal(second.id, first.id);
});

test("update manifest references the extension ID, codebase and version", () => {
  const xml = updateXml("a".repeat(32), "https://example.com/dl/verifai.crx", "0.5.4");
  assert.match(xml, /appid="a{32}"/);
  assert.match(xml, /codebase="https:\/\/example\.com\/dl\/verifai\.crx"/);
  assert.match(xml, /version="0\.5\.4"/);
});

test("packXpi zips a Firefox build and rejects a mismatched Gecko ID", (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verifai-xpi-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const build = path.join(dir, "firefox");
  fs.mkdirSync(build);
  fs.writeFileSync(path.join(build, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "VerifAI Approval Gate", version: "0.5.4",
    browser_specific_settings: { gecko: { id: GECKO_ID } }
  }));
  fs.writeFileSync(path.join(build, "background.js"), "// background");
  const result = packXpi(build);
  assert.equal(result.id, GECKO_ID);
  assert.equal(result.version, "0.5.4");
  assert.equal(result.xpi.readUInt32LE(0), 0x04034b50);

  fs.writeFileSync(path.join(build, "manifest.json"), JSON.stringify({
    browser_specific_settings: { gecko: { id: "someone-else@example.com" } }
  }));
  assert.throws(() => packXpi(build), /Gecko ID/);
});
