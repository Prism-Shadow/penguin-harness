import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { stringify } = createRequire(new URL("../../../server/package.json", import.meta.url))(
  "yaml",
);
const builderRequire = createRequire(require.resolve("electron-builder"));
export const { buildBlockMap } = builderRequire("app-builder-lib/out/targets/blockmap/blockmap.js");

export const certificate = {
  subject: "CN=Rotated Publisher, O=Rotated Publisher",
  issuer: "Another trusted CA",
  thumbprint: "recorded-not-pinned",
  notBefore: "2021-01-01T00:00:00Z",
  notAfter: "2025-01-01T00:00:00Z",
};

export function signedReport(file: string) {
  return { status: 0, path: file, signer: certificate, timestamp: certificate };
}

export async function artifactFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "penguin-windows-artifacts-"));
  const installer = path.join(root, "penguin-desktop-win32-x64.exe");
  const bytes = Buffer.from("final installer fixture");
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  await mkdir(path.join(root, "win-unpacked/resources"), { recursive: true });
  await writeFile(installer, bytes);
  await writeFile(path.join(root, "win-unpacked/PenguinHarness.exe"), "signed app fixture");
  await writeFile(path.join(root, "win-unpacked/resources/elevate.exe"), "signed helper fixture");
  await buildBlockMap(installer, "gzip", `${installer}.blockmap`);
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const latest = {
    version: pkg.version,
    path: path.basename(installer),
    sha512,
    files: [{ url: path.basename(installer), sha512, size: bytes.length }],
  };
  const config: Record<string, unknown> = {
    provider: "github",
    owner: "Prism-Shadow",
    repo: "penguin-harness",
    publisherName: ["Rotated Publisher"],
    updaterCacheDirName: "penguin-harness-desktop-updater",
  };
  const save = async () => {
    await writeFile(path.join(root, "latest.yml"), stringify(latest));
    await writeFile(path.join(root, "win-unpacked/resources/app-update.yml"), stringify(config));
  };
  await save();
  return { root, installer, bytes, sha512, latest, config, save };
}
