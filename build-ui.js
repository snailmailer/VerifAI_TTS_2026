const fs = require("node:fs");
const path = require("node:path");
const swc = require("@swc/core");
const output = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
const source = path.join(__dirname, "src", "redaction-dashboard.ts");
const result = swc.transformFileSync(source, {
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
  sourceMaps: false
});
fs.writeFileSync(path.join(output, "redaction-dashboard.js"), result.code);
