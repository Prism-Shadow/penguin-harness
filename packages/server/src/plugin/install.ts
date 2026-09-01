/**
 * Installing a plugin package into the data root.
 *
 * A plugin has to EXIST on the machine before `plugins.json` naming it means anything, and
 * where it can exist is not free: the installation directory belongs to the installer (the
 * desktop app's is inside the application bundle, and read-only in the places that matter), so
 * the harness owns one of its own — `<root>/plugins/`, an ordinary npm prefix. `npm install`
 * writes the package there, and the loader resolves from there before the installation.
 *
 * npm is the whole implementation on purpose: a plugin is an npm package, its dependencies are
 * npm's problem, and a registry, a proxy or a private scope is then configured the way every
 * other npm consumer on that machine configures it (.npmrc, the ambient environment).
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Long enough for a cold registry fetch with dependencies; short enough not to hang a request. */
const INSTALL_TIMEOUT_MS = 180_000;

/** `<root>/plugins`: the npm prefix this deployment installs plugins into. */
export function pluginsPrefix(root: string): string {
  return path.join(root, "plugins");
}

export class PluginInstallError extends Error {}

/**
 * Installs (or upgrades) one package into the root's plugin prefix. Returns the version npm
 * settled on, so the caller can report what it actually got rather than what was asked for.
 */
export async function installPluginPackage(
  root: string,
  specifier: string,
): Promise<string | null> {
  const prefix = pluginsPrefix(root);
  await fs.mkdir(prefix, { recursive: true });
  // An npm prefix needs a package.json of its own, or npm walks up and installs into whatever
  // it finds above — for a data root under a checkout, that would be the checkout.
  const manifest = path.join(prefix, "package.json");
  try {
    await fs.access(manifest);
  } catch {
    await fs.writeFile(
      manifest,
      `${JSON.stringify({ name: "penguin-plugins", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
  }
  try {
    await execFileAsync(
      npmCommand(),
      ["install", "--no-audit", "--no-fund", "--omit=dev", "--", specifier],
      { cwd: prefix, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: process.env },
    );
  } catch (err) {
    const detail =
      (err as { stderr?: string }).stderr?.trim().split("\n").filter(Boolean).at(-1) ??
      (err as Error).message;
    throw new PluginInstallError(detail);
  }
  return readInstalledVersion(prefix, specifier);
}

/** Removes a package from the prefix; a specifier that was never installed is not an error. */
export async function removePluginPackage(root: string, specifier: string): Promise<void> {
  const dir = packageDir(pluginsPrefix(root), specifier);
  if (dir === null) return;
  await fs.rm(dir, { recursive: true, force: true });
}

/** `<prefix>/node_modules/<name>` for a bare or scoped specifier, ignoring any version range. */
function packageDir(prefix: string, specifier: string): string | null {
  const at = specifier.lastIndexOf("@");
  const name = at > 0 ? specifier.slice(0, at) : specifier;
  if (name === "" || name.includes("..") || path.isAbsolute(name)) return null;
  return path.join(prefix, "node_modules", ...name.split("/"));
}

async function readInstalledVersion(prefix: string, specifier: string): Promise<string | null> {
  const dir = packageDir(prefix, specifier);
  if (dir === null) return null;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof raw.version === "string" ? raw.version : null;
  } catch {
    return null;
  }
}

/** Windows resolves `npm` through npm.cmd; everywhere else the plain name is on PATH. */
function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
