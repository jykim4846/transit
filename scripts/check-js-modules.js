const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jsDir = path.join(root, "js");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "transit-js-check-"));

try {
  for (const file of fs.readdirSync(jsDir).filter((name) => name.endsWith(".js")).sort()) {
    const source = path.join(jsDir, file);
    const target = path.join(tmpDir, file.replace(/\.js$/, ".mjs"));
    fs.copyFileSync(source, target);
    execFileSync(process.execPath, ["--check", target], { stdio: "inherit" });
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
