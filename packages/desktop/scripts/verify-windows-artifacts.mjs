import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import signatures from "../build/verify-windows-signature.cjs";
import { verifyUpdateMetadata } from "./verify-update-metadata.mjs";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));

export async function verifyWindowsArtifacts(
  outDir = path.join(pkgDir, "out"),
  { requireSigning = process.env.EVSIGN_REQUIRE === "true" } = {},
) {
  outDir = path.resolve(outDir);
  const files = [
    "penguin-desktop-win32-x64.exe",
    "win-unpacked/PenguinHarness.exe",
    "win-unpacked/resources/elevate.exe",
  ];
  const reports = [];
  for (const relative of files) {
    const file = path.join(outDir, relative);
    if (!(await stat(file)).isFile()) throw new Error(`Missing Windows artifact: ${relative}`);
    reports.push(signatures.verifyWindowsSignature(file, { allowUnsigned: !requireSigning }));
  }
  const metadata = await verifyUpdateMetadata(outDir);
  return { ...metadata, reports };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyWindowsArtifacts(process.argv[2]), null, 2));
}
