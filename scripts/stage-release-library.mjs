/** Put release-only content in the host's own published files. Downstream installs need no tarball URL. */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseDependencies } from "./lib/external-plugins.mjs";

export async function stageReleaseLibrary(host) {
  const manifest = path.join(host, "package.json");
  const pkg = JSON.parse(await readFile(manifest, "utf8"));
  const require = createRequire(manifest);
  const target = path.join(host, "dist", "release-library");
  await rm(target, { recursive: true, force: true });
  const shipped = {};
  for (const name of Object.keys(releaseDependencies(pkg))) {
    const file = require.resolve(`${name}/package.json`);
    const plugin = JSON.parse(await readFile(file, "utf8"));
    if (plugin.name !== name) throw new Error(`Expected ${name} at ${file}, found ${plugin.name}`);
    const dir = path.dirname(file);
    await readFile(path.join(dir, "ifaces.json"));
    shipped[name] = plugin.version;
    await mkdir(target, { recursive: true });
    // pnpm unpacked this self-contained package from its integrity-checked release pin.
    await cp(dir, path.join(target, name.slice(name.indexOf("/") + 1)), {
      recursive: true,
      filter: (entry) => path.basename(entry) !== "node_modules",
    });
  }
  if (Object.keys(shipped).length)
    await writeFile(
      path.join(target, "package.json"),
      JSON.stringify({ dependencies: shipped }) + "\n",
    );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await stageReleaseLibrary(process.cwd());
