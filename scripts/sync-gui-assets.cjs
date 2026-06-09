const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = path.join(root, "worker-runner.js");
const targetDir = path.join(root, "traffic-engine-gui", "runner");
const target = path.join(targetDir, "worker-runner.js");

if (!fs.existsSync(source)) {
  throw new Error(`worker-runner.js not found: ${source}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`[sync-gui-assets] copied ${path.relative(root, source)} -> ${path.relative(root, target)}`);
