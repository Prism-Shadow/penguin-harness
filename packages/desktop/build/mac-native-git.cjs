// Apple notarizes an app only when every Mach-O in it is signed with the Developer ID, a secure
// timestamp and the hardened runtime, and its scan reads inside archives. The Agent State Git
// plugin carries its Git programs in one tar per platform, and no signature can reach a program
// inside a tar. So before electron-builder signs the app, this app's own Git is unpacked beside
// the archives, where the signing pass finds it like any other program in the bundle, and the
// macOS archives are removed. The plugin runs an unpacked payload from where it lies.
//
// Only macOS payloads are touched. The other platforms' archives and the source archives stay as
// the package published them.
const fs = require("node:fs/promises");
const { createRequire } = require("node:module");
const path = require("node:path");

const PLUGIN = ["node_modules", "@penguinharness", "agent-state-git"];
const NATIVE = ["dist", "native"];
const MAC_ARCHIVE = /^darwin-[^.]+\.tar$/;

/** The app's two copies of the plugin: the prefix the server loads it from, and the library's. */
function nativeDirs(appDir) {
  return {
    loaded: path.join(appDir, "plugins", ...PLUGIN, ...NATIVE),
    library: path.join(appDir, ...PLUGIN, ...NATIVE),
  };
}

/**
 * Leaves `appDir` (the packed `Contents/Resources/app`) with Git for `arch` unpacked in the
 * copy the server loads, and with no macOS Git archive in either copy.
 */
async function unpackMacGit(appDir, arch) {
  const { loaded, library } = nativeDirs(appDir);
  const target = `darwin-${arch}`;
  const archive = path.join(loaded, `${target}.tar`);
  try {
    await fs.access(archive);
  } catch {
    throw new Error(`${archive} is missing: this app would ship without Git for ${target}.`);
  }
  // The same reader the plugin extracts with, resolved from the package that depends on it.
  const tar = createRequire(
    path.resolve(__dirname, "..", "..", "..", "plugins", "agent-state-git", "package.json"),
  )("tar");
  const payload = path.join(loaded, target);
  await fs.rm(payload, { recursive: true, force: true });
  await fs.mkdir(payload);
  await tar.x({ file: archive, cwd: payload, strict: true });
  const program = path.join(payload, "bin", "git");
  await fs.chmod(program, 0o755);
  for (const dir of [loaded, library]) {
    const names = await fs.readdir(dir).catch(() => []);
    for (const name of names) {
      if (MAC_ARCHIVE.test(name)) await fs.rm(path.join(dir, name));
    }
  }
  return program;
}

module.exports = async function macNativeGit({ electronPlatformName, appOutDir, arch }) {
  if (electronPlatformName !== "darwin") return;
  // Resolved here, not at load: only a packaging run has electron-builder to ask.
  const name = require("electron-builder").Arch[arch];
  const bundles = (await fs.readdir(appOutDir)).filter((entry) => entry.endsWith(".app"));
  if (bundles.length !== 1) {
    throw new Error(`Expected one .app in ${appOutDir}, found ${bundles.length}.`);
  }
  const appDir = path.join(appOutDir, bundles[0], "Contents", "Resources", "app");
  const program = await unpackMacGit(appDir, name);
  console.info(`Unpacked ${path.relative(appOutDir, program)} for signing`);
};
module.exports.unpackMacGit = unpackMacGit;
