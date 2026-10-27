const crypto = require("node:crypto");

const GECKO_ID = "verifai-approval-gate@example.com";

// The Chromium extension ID is the first 128 bits of the SHA-256 digest of the
// DER (SubjectPublicKeyInfo) public key, with each hex nibble mapped 0-f -> a-p.
// This is identical to the ID Chrome/Edge/Brave assign a packed CRX, so it is
// stable across every device that installs the same signed package.
function crxIdBytes(publicKeyDer) {
  return crypto.createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
}

function encodeChromiumId(digest16) {
  let id = "";
  for (const byte of digest16) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

function chromiumIdFromPublicKeyDer(publicKeyDer) {
  if (!Buffer.isBuffer(publicKeyDer) || publicKeyDer.length === 0) {
    throw new Error("A DER-encoded public key buffer is required.");
  }
  return encodeChromiumId(crxIdBytes(publicKeyDer));
}

function publicKeyDerFromPem(pem) {
  const key = crypto.createPublicKey(pem.includes("PRIVATE") ? crypto.createPrivateKey(pem) : pem);
  return key.export({ type: "spki", format: "der" });
}

function chromiumIdFromKeyPem(pem) {
  return chromiumIdFromPublicKeyDer(publicKeyDerFromPem(pem));
}

module.exports = {
  GECKO_ID,
  crxIdBytes,
  encodeChromiumId,
  chromiumIdFromPublicKeyDer,
  publicKeyDerFromPem,
  chromiumIdFromKeyPem
};
