import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parse } from "yaml";
import signatures from "../build/verify-windows-signature.cjs";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { buildBlockMap } = builderRequire("app-builder-lib/out/targets/blockmap/blockmap.js");

const INSTALLER = "penguin-desktop-win32-x64.exe";
const SIGNED = [INSTALLER, "win-unpacked/PenguinHarness.exe", "win-unpacked/resources/elevate.exe"];
const REQUIRED = [
  ...SIGNED,
  `${INSTALLER}.blockmap`,
  "latest.yml",
  // electron-updater reads the client's cache directory name from it.
  "win-unpacked/resources/app-update.yml",
];

/** The release gate: signed final artifacts, and update metadata bound to their bytes. */
export async function verifyWindowsArtifacts(
  outDir = path.join(pkgDir, "out"),
  { requireSigning = process.env.EVSIGN_REQUIRE === "true" } = {},
) {
  outDir = path.resolve(outDir);
  for (const relative of REQUIRED) {
    const file = await stat(path.join(outDir, relative)).catch(() => null);
    if (!file?.isFile()) throw new Error(`Missing Windows artifact: ${relative}`);
  }
  const reports = SIGNED.map((relative) =>
    signatures.verifyWindowsSignature(path.join(outDir, relative), {
      allowUnsigned: !requireSigning,
    }),
  );

  const installer = path.join(outDir, INSTALLER);
  const metadata = parse(await readFile(path.join(outDir, "latest.yml"), "utf8"));
  const pkg = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8"));
  assert.equal(metadata?.version, pkg.version, "latest.yml version");
  assert.equal(metadata?.path, INSTALLER, "latest.yml path");
  assert.ok(Array.isArray(metadata?.files) && metadata.files.length === 1, "latest.yml file count");
  assert.equal(metadata.files[0]?.url, INSTALLER, "latest.yml file URL");

  const scratch = await mkdtemp(path.join(os.tmpdir(), "penguin-update-blockmap-"));
  try {
    const rebuilt = path.join(scratch, "installer.blockmap");
    // An explicit output path keeps blockmap generation from appending to the signed bytes.
    const { sha512, size } = await buildBlockMap(installer, "gzip", rebuilt);
    assert.equal(metadata.sha512, sha512, "latest.yml SHA-512");
    assert.equal(metadata.files[0].sha512, sha512, "latest.yml file SHA-512");
    assert.equal(metadata.files[0].size, size, "latest.yml file size");
    assert.deepEqual(
      JSON.parse(gunzipSync(await readFile(`${installer}.blockmap`)).toString("utf8")),
      JSON.parse(gunzipSync(await readFile(rebuilt)).toString("utf8")),
      "blockmap must describe the final installer bytes",
    );
    return { installer, version: metadata.version, sha512, size, blockmap: "matched", reports };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyWindowsArtifacts(process.argv[2]), null, 2));
}
