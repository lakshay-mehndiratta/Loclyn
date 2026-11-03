// Builds what actually gets published to npm:
//   bundle/index.js  the CLI, with @loclyn/core and @loclyn/dashboard-server
//                    inlined (they are not published separately)
//   ui/              the built dashboard (copied from packages/dashboard/out)
//   README.md        copied from the repo root so npm shows it
//
// Run it through `npm run bundle -w loclyn` (npm pack / publish also run it,
// via "prepack"). Build core, dashboard-server and dashboard first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const uiSource = path.resolve(root, "../dashboard/out");
if (!fs.existsSync(path.join(uiSource, "index.html"))) {
  console.error("✗ The dashboard is not built. Run `npm run build` from the repo root first.");
  process.exit(1);
}
for (const dep of ["core", "dashboard-server"]) {
  if (!fs.existsSync(path.resolve(root, `../${dep}/dist/index.js`))) {
    console.error(`✗ packages/${dep} is not built. Run \`npm run build\` from the repo root first.`);
    process.exit(1);
  }
}

fs.rmSync(path.join(root, "bundle"), { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(root, "bundle/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Real npm dependencies stay as normal imports; npm installs them for users.
  external: Object.keys(pkg.dependencies),
  legalComments: "none",
  logLevel: "warning",
});

fs.rmSync(path.join(root, "ui"), { recursive: true, force: true });
fs.cpSync(uiSource, path.join(root, "ui"), { recursive: true });
fs.copyFileSync(path.resolve(root, "../../README.md"), path.join(root, "README.md"));

console.log("✓ bundle/index.js, ui/ and README.md are ready to pack");