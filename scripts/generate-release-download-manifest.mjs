#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const USAGE =
  "usage: generate-release-download-manifest.mjs <tag> <output-dir> <cli-artifacts-dir> <desktop-artifacts-dir> [extra-release-file...]";

const CLI_BUNDLES = [
  "penguin-linux-x64.tar.gz",
  "penguin-linux-arm64.tar.gz",
  "penguin-darwin-x64.tar.gz",
  "penguin-darwin-arm64.tar.gz",
  "penguin-universal.tar.gz",
  "penguin-win32-x64.zip",
];

const DESKTOP_INSTALLERS = [
  "penguin-desktop-darwin-arm64.dmg",
  "penguin-desktop-darwin-arm64.zip",
  "penguin-desktop-darwin-x64.dmg",
  "penguin-desktop-darwin-x64.zip",
  "penguin-desktop-linux-x86_64.AppImage",
  "penguin-desktop-linux-amd64.deb",
  "penguin-desktop-win32-x64.exe",
];

const DESKTOP_UPDATE_METADATA = ["latest.yml", "latest-mac.yml", "latest-linux.yml"];

const DESKTOP_UPDATE_BLOCKMAPS = [
  "penguin-desktop-darwin-arm64.zip.blockmap",
  "penguin-desktop-darwin-x64.zip.blockmap",
  "penguin-desktop-win32-x64.exe.blockmap",
];

const PROBES = [
  { label: "small", file: "probe-64k.bin", size: 64 * 1024 },
  { label: "large", file: "probe-1m.bin", size: 1024 * 1024 },
];

function fail(message) {
  console.error(`error: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

function assertSafeTag(tag) {
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(tag) || tag.includes("..")) {
    fail(`release tag is not safe: ${tag}`);
  }
}

function assertSafeFileName(file) {
  if (!/^[A-Za-z0-9._+-]+$/.test(file) || file.includes("..")) {
    fail(`release asset name is not safe: ${file}`);
  }
}

function filePath(dir, file) {
  assertSafeFileName(file);
  const p = path.join(dir, file);
  try {
    const stat = statSync(p);
    if (!stat.isFile()) fail(`release asset is not a file: ${p}`);
    return { path: p, size: stat.size };
  } catch {
    fail(`missing release asset: ${p}`);
  }
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function makeProbe(size) {
  const out = Buffer.allocUnsafe(size);
  let offset = 0;
  let counter = 0;
  while (offset < size) {
    const chunk = createHash("sha256")
      .update("penguin-harness release probe v1\0")
      .update(String(size))
      .update("\0")
      .update(String(counter))
      .digest();
    counter += 1;
    const copied = chunk.copy(out, offset, 0, Math.min(chunk.length, size - offset));
    offset += copied;
  }
  return out;
}

async function addRecord(rows, type, dir, file) {
  const info = filePath(dir, file);
  rows.push([type, file, String(info.size), await sha256File(info.path)]);
}

async function main() {
  const [tag, outputDirArg, cliDirArg, desktopDirArg, ...extraFiles] = process.argv.slice(2);
  if (!tag || !outputDirArg || !cliDirArg || !desktopDirArg) fail("missing required arguments");
  assertSafeTag(tag);

  const outputDir = path.resolve(outputDirArg);
  const cliDir = path.resolve(cliDirArg);
  const desktopDir = path.resolve(desktopDirArg);
  mkdirSync(outputDir, { recursive: true });

  for (const probe of PROBES) {
    writeFileSync(path.join(outputDir, probe.file), makeProbe(probe.size));
  }

  const rows = [["penguin-release-download-manifest", "1", tag]];
  for (const probe of PROBES) {
    const info = filePath(outputDir, probe.file);
    rows.push(["probe", probe.label, probe.file, String(info.size), await sha256File(info.path)]);
  }

  for (const file of CLI_BUNDLES) await addRecord(rows, "asset", cliDir, file);
  for (const file of CLI_BUNDLES.map((file) => `${file}.sha256`)) {
    await addRecord(rows, "asset_checksum", cliDir, file);
  }
  await addRecord(rows, "asset_checksum", cliDir, "SHA256SUMS");

  for (const file of DESKTOP_INSTALLERS) await addRecord(rows, "desktop_asset", desktopDir, file);
  for (const file of DESKTOP_UPDATE_METADATA) {
    await addRecord(rows, "desktop_update_metadata", desktopDir, file);
  }

  const availableBlockmaps = new Set(
    readdirSync(desktopDir).filter((file) => file.endsWith(".blockmap")),
  );
  for (const file of DESKTOP_UPDATE_BLOCKMAPS) {
    if (!availableBlockmaps.has(file)) fail(`missing desktop update blockmap: ${file}`);
  }
  const blockmaps = [...availableBlockmaps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const file of blockmaps) await addRecord(rows, "desktop_update_blockmap", desktopDir, file);
  await addRecord(rows, "desktop_checksum", desktopDir, "SHA256SUMS.desktop");

  for (const fileArg of extraFiles) {
    const file = path.basename(fileArg);
    if (file !== fileArg) fail(`extra release file must not contain a directory: ${fileArg}`);
    await addRecord(rows, "installer_script", process.cwd(), file);
  }

  const manifest = rows.map((row) => row.join("\t")).join("\n") + "\n";
  const manifestPath = path.join(outputDir, "release-download-manifest.tsv");
  writeFileSync(manifestPath, manifest, "utf8");
  console.log(`Generated ${manifestPath}`);
}

await main();
