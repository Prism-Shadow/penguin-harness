import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const { parse } = createRequire(new URL("../../server/package.json", import.meta.url))("yaml");
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { buildBlockMap } = builderRequire("app-builder-lib/out/targets/blockmap/blockmap.js");

export async function verifyUpdateMetadata(outDir = path.join(pkgDir, "out")) {
  outDir = path.resolve(outDir);
  const name = "penguin-desktop-win32-x64.exe";
  const installer = path.join(outDir, name);
  const metadata = parse(await readFile(path.join(outDir, "latest.yml"), "utf8"));
  const config = parse(
    await readFile(path.join(outDir, "win-unpacked/resources/app-update.yml"), "utf8"),
  );
  const pkg = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8"));
  const builder = parse(await readFile(path.join(pkgDir, "electron-builder.yml"), "utf8"));
  assert.equal(metadata?.version, pkg.version, "latest.yml version");
  assert.equal(metadata?.path, name, "latest.yml path");
  assert.ok(Array.isArray(metadata?.files) && metadata.files.length === 1, "latest.yml file count");
  assert.equal(metadata.files[0]?.url, name, "latest.yml file URL");

  const publishers = Array.isArray(config?.publisherName)
    ? config.publisherName
    : [config?.publisherName];
  assert.ok(
    publishers.length > 0 &&
      publishers.every((value) => typeof value === "string" && value.trim().length > 0),
    "app-update.yml must enable the signature callback with publisherName",
  );
  // Only these two fields are added to the configured feed by electron-builder.
  const { publisherName: _publisher, updaterCacheDirName: _cache, ...feed } = config;
  assert.deepEqual(feed, builder.publish, "app-update.yml update feed");

  const scratch = await mkdtemp(path.join(os.tmpdir(), "penguin-update-blockmap-"));
  try {
    const rebuilt = path.join(scratch, "installer.blockmap");
    // Explicit output keeps blockmap generation from appending to signed bytes.
    const { sha512, size } = await buildBlockMap(installer, "gzip", rebuilt);
    assert.equal(metadata.sha512, sha512, "latest.yml SHA-512");
    assert.equal(metadata.files[0].sha512, sha512, "latest.yml file SHA-512");
    assert.equal(metadata.files[0].size, size, "latest.yml file size");
    assert.deepEqual(
      JSON.parse(gunzipSync(await readFile(`${installer}.blockmap`)).toString("utf8")),
      JSON.parse(gunzipSync(await readFile(rebuilt)).toString("utf8")),
      "blockmap must describe the final installer bytes",
    );
    return { installer, version: metadata.version, sha512, size, blockmap: "matched" };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyUpdateMetadata(process.argv[2])));
}
