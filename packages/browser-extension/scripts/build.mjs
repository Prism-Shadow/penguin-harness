// Builds the extension into dist/ (what "Load unpacked" takes) and zips it beside:
//
//   dist/background.js, dist/pages/{pair,popup}.{html,js}, dist/pages/pages.css
//   dist/icons/icon{,-grey}-{16,32,48,128}.png   (sized and greyed from icons/penguin-128.png)
//   dist/manifest.json                           (manifest.json + the package version)
//   dist/penguin-browser-extension-<version>.zip (everything above, manifest at the zip root)
//
// The manifest's version is the repo version, which release prep bumps in every package.json;
// a pre-release suffix ("0.3.0-rc.1") goes to `version_name`, since Chrome takes digits only.
import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, greyOut, resize } from "./png.mjs";
import { zip } from "./zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "pages"), { recursive: true });
mkdirSync(path.join(dist, "icons"), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    background: "src/background.ts",
    "pages/pair": "pages/pair.ts",
    "pages/popup": "pages/popup.ts",
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome116",
  legalComments: "none",
  logLevel: "warning",
});

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const numeric = /^\d+(\.\d+){0,3}/.exec(version)?.[0];
if (numeric === undefined) throw new Error(`package.json version is not a version: ${version}`);
manifest.version = numeric;
if (numeric !== version) manifest.version_name = version;
writeFileSync(path.join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of ["pair.html", "popup.html", "pages.css"]) {
  writeFileSync(path.join(dist, "pages", file), readFileSync(path.join(root, "pages", file)));
}

const source = decodePng(readFileSync(path.join(root, "icons", "penguin-128.png")));
for (const size of [16, 32, 48, 128]) {
  const icon = size === source.width ? source : resize(source, size);
  writeFileSync(path.join(dist, "icons", `icon-${size}.png`), encodePng(size, size, icon.rgba));
  const grey = greyOut(icon);
  writeFileSync(
    path.join(dist, "icons", `icon-grey-${size}.png`),
    encodePng(size, size, grey.rgba),
  );
}

function listFiles(dir, prefix = "") {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) return listFiles(full, rel);
    return name.endsWith(".zip") ? [] : [{ name: rel, data: readFileSync(full) }];
  });
}

const archive = `penguin-browser-extension-${version}.zip`;
writeFileSync(path.join(dist, archive), zip(listFiles(dist)));
console.log(`browser-extension: dist/ and dist/${archive} (version ${version})`);
