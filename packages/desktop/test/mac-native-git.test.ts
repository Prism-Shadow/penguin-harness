/**
 * What the macOS app carries of the Agent State Git plugin after packing.
 *
 * Apple's notary reads inside archives and rejects an app holding a Mach-O that is not signed
 * with the Developer ID, and a program inside a tar cannot be signed. The afterPack step
 * therefore leaves the app's own Git as files, where the signing pass reaches it, and no macOS
 * Git archive anywhere in the app.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { unpackMacGit } = require("../build/mac-native-git.cjs");
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tar = createRequire(path.resolve(pkgDir, "../../plugins/agent-state-git/package.json"))(
  "tar",
);

const PLUGIN = "node_modules/@penguinharness/agent-state-git";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A packed app directory holding the plugin twice, as electron-builder leaves it. */
async function packedApp(): Promise<string> {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-mac-git-"));
  roots.push(app);
  const payload = path.join(app, "payload");
  fs.mkdirSync(path.join(payload, "bin"), { recursive: true });
  const archive = async (copy: string, target: string) => {
    const native = path.join(app, copy, PLUGIN, "dist/native");
    fs.mkdirSync(native, { recursive: true });
    fs.writeFileSync(path.join(payload, "bin/git"), `git for ${target}`, { mode: 0o755 });
    await tar.c({ cwd: payload, file: path.join(native, `${target}.tar`) }, ["bin/git"]);
  };
  // The prefix the server loads from holds every platform; the library copy only the build host's.
  for (const target of ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]) {
    await archive("plugins", target);
  }
  await archive("", "darwin-arm64");
  const sources = path.join(app, "plugins", PLUGIN, "dist/sources");
  fs.mkdirSync(sources);
  fs.writeFileSync(path.join(sources, "git-posix-source.tar.xz"), "source");
  fs.rmSync(payload, { recursive: true });
  return app;
}

function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .map((rel) => rel.split(path.sep).join("/"))
    .sort();
}

describe("the macOS app's native Git", () => {
  it.each(["arm64", "x64"])(
    "is unpacked for %s and no macOS archive is left for the notary",
    async (arch) => {
      const app = await packedApp();

      await unpackMacGit(app, arch);

      expect(filesUnder(app)).toEqual([
        `plugins/${PLUGIN}/dist/native/darwin-${arch}/bin/git`,
        `plugins/${PLUGIN}/dist/native/linux-x64.tar`,
        `plugins/${PLUGIN}/dist/native/win32-x64.tar`,
        `plugins/${PLUGIN}/dist/sources/git-posix-source.tar.xz`,
      ]);
      const program = path.join(app, "plugins", PLUGIN, `dist/native/darwin-${arch}/bin/git`);
      expect(fs.readFileSync(program, "utf8")).toBe(`git for darwin-${arch}`);
      if (process.platform !== "win32") expect(fs.statSync(program).mode & 0o111).toBe(0o111);
    },
  );

  it("fails the build when the app has no Git for its architecture", async () => {
    const app = await packedApp();
    fs.rmSync(path.join(app, "plugins", PLUGIN, "dist/native/darwin-x64.tar"));

    await expect(unpackMacGit(app, "x64")).rejects.toThrow(/would ship without Git for darwin-x64/);
  });

  it("runs as electron-builder's afterPack hook", () => {
    const config = fs.readFileSync(path.join(pkgDir, "electron-builder.yml"), "utf8");
    expect(config).toMatch(/^afterPack: build\/after-pack\.cjs$/m);
    expect(fs.readFileSync(path.join(pkgDir, "build/after-pack.cjs"), "utf8")).toContain(
      'require("./mac-native-git.cjs")',
    );
  });
});
