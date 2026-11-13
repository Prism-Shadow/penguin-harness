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
 *
 * A namespace is only "in place" when every pointer the manifest names resolves to an
 * existing file or directory beneath it — a directory that merely exists is not a store
 * (a partial copy, a lost file, a pruned artifact), and committing a record over one
 * would present a broken store as a usable version. `EEXIST` on the rename is therefore
 * not success by itself: the namespace already there is verified, and rebuilt when it
 * does not hold everything the record names.
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
      if (
        !value.startsWith("store/") ||
        value.split("/").some((part) => part === "..") ||
        value.includes("\\")
      ) {
        // Backslashes are path separators on Windows: a pointer carrying one is not a
        // store-relative name, whatever the local platform reads it as.
        throw new Error(`invalid carried store pointer: ${value}`);
      }
      return `${content}/${value.slice("store/".length)}`;
    };
    const pointers = [
      ...(manifest.platform?.bundle ? [manifest.platform.bundle] : []),
      ...(manifest.cli?.bundle ? [manifest.cli.bundle] : []),
      ...(manifest.web?.manifest ? [manifest.web.manifest] : []),
      ...(manifest.assets?.dir ? [manifest.assets.dir] : []),
    ];
    for (const value of pointers) {
      // Every pointer must resolve to something the carried body actually holds — the
      // staging copy is the source of truth, and a pointer to nothing is a broken body.
      const from = path.join(staging, "store", ...value.slice("store/".length).split("/"));
      await fs.access(from);
    }
    const stamped = {
      ...manifest,
      ...(manifest.platform?.bundle
        ? { platform: { ...manifest.platform, bundle: pointer(manifest.platform.bundle) } }
        : {}),
      ...(manifest.cli?.bundle
        ? { cli: { ...manifest.cli, bundle: pointer(manifest.cli.bundle) } }
        : {}),
      ...(manifest.web?.manifest
        ? { web: { ...manifest.web, manifest: pointer(manifest.web.manifest) } }
        : {}),
      ...(manifest.assets?.dir
        ? { assets: { ...manifest.assets, dir: pointer(manifest.assets.dir) } }
        : {}),
      source: { ...manifest.source, ...source },
    };
    await fs.writeFile(path.join(staging, "harness.json"), JSON.stringify(stamped, null, 2));
    await fs.mkdir(path.join(target, "store", "carried"), { recursive: true });
    const destination = path.join(target, ...content.split("/"));
    try {
      await fs.rename(path.join(staging, "store"), destination);
    } catch (err) {
      // EPERM is what Windows reports for a directory rename onto an existing one;
      // EEXIST/ENOTEMPTY is the POSIX answer. Both mean "already there".
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes((err as NodeJS.ErrnoException).code ?? ""))
        throw err;
      // The namespace is already there — but only a complete one counts. Rebuild it when
      // it does not hold everything the record names (a partial copy, a lost file).
      const complete = await carriedStoreComplete(
        destination,
        pointers.map((value) => value.slice("store/".length)),
      );
      if (!complete.ok) {
        await fs.rm(destination, { recursive: true, force: true });
        await fs.rename(path.join(staging, "store"), destination);
      }
    }
    await fs.rename(path.join(staging, "harness.json"), path.join(target, "harness.json"));
    return source;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/**
 * Whether a carried store holds everything its record names: every pointer resolves
 * beneath the store, to an existing file or directory. `complete.ok` is the answer; when
 * it is false, `reason` says which pointer failed — the caller repairs by laying the
 * carried body again.
 */
export async function carriedStoreComplete(
  storeDir: string,
  pointers: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const rel of pointers) {
    if (rel.includes("\\") || rel.split("/").some((part) => part === "..")) {
      return { ok: false, reason: `invalid carried store pointer: store/${rel}` };
    }
    const at = path.join(storeDir, ...rel.split("/"));
    try {
      await fs.access(at);
    } catch {
      return { ok: false, reason: `the carried store lost ${rel}` };
    }
  }
  return { ok: true };
}

/** The pointers this manifest names, store-relative (the `store/` prefix kept). */
export function carriedStorePointers(manifest: Manifest): string[] {
  return [
    ...(manifest.platform?.bundle ? [manifest.platform.bundle] : []),
    ...(manifest.cli?.bundle ? [manifest.cli.bundle] : []),
    ...(manifest.web?.manifest ? [manifest.web.manifest] : []),
    ...(manifest.assets?.dir ? [manifest.assets.dir] : []),
  ];
}
