/** Lay a carried harness store into a data root without re-encoding its artifacts. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Manifest } from "@prismshadow/penguin-hmr/manifest";

export interface CarriedSource {
  repo: string;
  revision: string;
  channel: "shipped-image";
  image: string;
}

export async function readCarriedStore(dir: string): Promise<{
  text: string;
  manifest: Manifest;
  source: CarriedSource;
}> {
  const text = await fs.readFile(path.join(dir, "harness.json"), "utf8");
  const manifest = JSON.parse(text) as Manifest;
  const image = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return {
    text,
    manifest,
    source: {
      repo: manifest.source?.repo ?? "",
      revision: manifest.source?.revision ?? "",
      channel: "shipped-image",
      image,
    },
  };
}

/**
 * Copy into staging, move the immutable content into place, then atomically commit the
 * record. Existing store objects stay available to readers of the previous record.
 */
export async function layCarriedStore(dir: string, target: string): Promise<CarriedSource> {
  const { manifest, source } = await readCarriedStore(dir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(target), `.carried-${source.image}-`));
  try {
    await fs.cp(path.join(dir, "store"), path.join(staging, "store"), { recursive: true });
    // Each copy has an immutable namespace; pointers remain relative to hmr/.
    const content = `store/carried/${source.image}`;
    const pointer = (value: string): string => {
      if (!value.startsWith("store/") || value.split("/").some((part) => part === "..")) {
        throw new Error(`invalid carried store pointer: ${value}`);
      }
      return `${content}/${value.slice("store/".length)}`;
    };
    const stamped = {
      ...manifest,
      ...(manifest.platform?.bundle ? { platform: { ...manifest.platform, bundle: pointer(manifest.platform.bundle) } } : {}),
      ...(manifest.cli?.bundle ? { cli: { ...manifest.cli, bundle: pointer(manifest.cli.bundle) } } : {}),
      ...(manifest.web?.manifest ? { web: { ...manifest.web, manifest: pointer(manifest.web.manifest) } } : {}),
      ...(manifest.assets?.dir ? { assets: { ...manifest.assets, dir: pointer(manifest.assets.dir) } } : {}),
      source: { ...manifest.source, ...source },
    };
    await fs.writeFile(path.join(staging, "harness.json"), JSON.stringify(stamped, null, 2));
    await fs.mkdir(path.join(target, "store", "carried"), { recursive: true });
    const destination = path.join(target, ...content.split("/"));
    try {
      await fs.rename(path.join(staging, "store"), destination);
    } catch (err) {
      if (!["EEXIST", "ENOTEMPTY"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
    }
    await fs.rename(path.join(staging, "harness.json"), path.join(target, "harness.json"));
    return source;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
