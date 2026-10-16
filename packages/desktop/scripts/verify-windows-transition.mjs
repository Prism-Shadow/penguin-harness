import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import transition from "../build/verify-transition-signature.cjs";
import { verifyWindowsArtifacts } from "./verify-windows-artifacts.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const updaterRequire = createRequire(require.resolve("electron-updater"));
const { verifySignature } = updaterRequire("./windowsExecutableCodeSignatureVerifier.js");

/** Strict local acceptance; never invokes an installer or publishes an artifact. */
export async function verifyWindowsTransition(outDir = path.join(pkgDir, "out")) {
  outDir = path.resolve(outDir);
  const metadata = await verifyWindowsArtifacts(outDir, { requireSigning: true });
  const { installer } = metadata;
  const reports = [
    installer,
    path.join(outDir, "win-unpacked/PenguinHarness.exe"),
    path.join(outDir, "win-unpacked/resources/elevate.exe"),
  ].map((file) => transition.verifyTransitionSignature(file));

  // v0.2.16 pins this same electron-updater version and these publisher names.
  // Run its actual legacy logic; no installer execution is involved.
  const legacyWarnings = [];
  const logger = {
    info() {},
    warn(message) {
      legacyWarnings.push(String(message));
    },
    error() {},
  };
  const legacy = await verifySignature(
    [
      "CN=NaisNet Technology Co., Ltd., O=NaisNet Technology Co., Ltd.",
      "NaisNet Technology Co., Ltd.",
      "CN=RushRush Network Technology Ltd, O=RushRush Network Technology Ltd",
      "RushRush Network Technology Ltd",
    ],
    installer,
    logger,
  );
  assert.equal(legacy, null, "legacy publisher verification");
  assert.ok(
    !legacyWarnings.some((message) => /ignoring|skipping|cannot execute/i.test(message)),
    "legacy verification must complete",
  );
  const { verifyWindowsUpdateSignature } = await import("../src/windows-update-signature.ts");
  assert.equal(await verifyWindowsUpdateSignature(installer), null, "new Windows verifier");
  console.log(
    JSON.stringify(
      {
        reports,
        version: metadata.version,
        sha512: metadata.sha512,
        size: metadata.size,
        blockmap: metadata.blockmap,
        legacy: "accepted",
        transition: "accepted",
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyWindowsTransition(process.argv[2]);
}
