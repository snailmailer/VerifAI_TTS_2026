const fs = require("node:fs");
const path = require("node:path");
const { createZip } = require("./zip.js");
const { collectFiles } = require("./pack-crx.js");
const { GECKO_ID } = require("./extension-id.js");

// Firefox add-ons are plain ZIP archives renamed to .xpi. Browser-managed
// force-install (ExtensionSettings installation_mode=force_installed with an
// install_url) still requires the XPI to be signed by Mozilla (AMO) or deployed
// on an ESR/Enterprise build that permits unsigned policy installs. Packaging
// here produces the archive; it does not and cannot forge a Mozilla signature.
function packXpi(firefoxBuildDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(firefoxBuildDir, "manifest.json"), "utf8"));
  const gecko = manifest.browser_specific_settings?.gecko?.id;
  if (gecko !== GECKO_ID) {
    throw new Error(`Firefox build must declare the Gecko ID ${GECKO_ID}.`);
  }
  return { id: gecko, version: manifest.version, xpi: createZip(collectFiles(firefoxBuildDir)) };
}

module.exports = { packXpi };
