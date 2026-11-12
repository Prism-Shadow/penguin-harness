/**
 * Reconcile the program's carried store with the data root it serves.
 *
 * Design boundary: one server per data root, and the carried image follows
 * whatever package started last — downgrades are allowed. The image id is a
 * content hash, so it proves identity, not recency; no version ordering is
 * applied here. The same-port cold-start race is closed by starting the
 * reconciliation after listen() holds the root lock; sharing a root between
 * servers on different ports is unsupported (single-writer data breaks first).
 */
import fs from "node:fs";
import path from "node:path";
import { readHarnessMeta } from "./harness-meta.js";
import {
  carriedStoreComplete,
  carriedStorePointers,
  layCarriedStore,
  readCarriedStore,
} from "./carried-store.js";
import type { CarriedSource } from "./carried-store.js";
export { carriedStore as carriedBody } from "./machines/install-server.js";

export type SyncOutcome =
  | { kind: "copied"; source: CarriedSource }
  | { kind: "current" }
  | { kind: "kept"; reason: "pushed" | "unreadable-record" | "unreadable-body" }
  | { kind: "absent"; reason: "no-body" }
  | { kind: "failed"; detail: string };

/** No record: copy. Same image: current — unless the store is broken, then repair. Older
 * image: upgrade. Push or peer: defer. */
export async function syncCarriedImage(root: string, dir: string | null): Promise<SyncOutcome> {
  if (dir === null || !fs.existsSync(dir)) return { kind: "absent", reason: "no-body" };
  let source: CarriedSource;
  try {
    ({ source } = await readCarriedStore(dir));
  } catch {
    return { kind: "kept", reason: "unreadable-body" };
  }
  const meta = await readHarnessMeta(root);
  if (meta.kind === "broken") return { kind: "kept", reason: "unreadable-record" };
  if (meta.kind === "meta") {
    const marked = meta.manifest.source as Partial<CarriedSource> | undefined;
    if (marked?.channel !== "shipped-image") return { kind: "kept", reason: "pushed" };
    if (marked.image === source.image) {
      // Same image as the record: usually current. But a record naming a store that lost
      // a file (a partial copy, a pruned artifact) is not usable — laying the carried
      // body again is what repairs it, and the immutable namespace makes that safe.
      // The record's pointers already carry the namespace (store/carried/<image>/…), so
      // the strip here is that whole prefix, not just `store/`. A pointer outside that
      // namespace is a malformed record, not an empty relative path — it counts as
      // incomplete, so laying the carried body repairs it rather than the check
      // passing on the store directory itself.
      const prefix = `store/carried/${source.image}/`;
      const pointers = carriedStorePointers(meta.manifest);
      const outside = pointers.find((value) => !value.startsWith(prefix));
      const complete = outside
        ? { ok: false as const, reason: `invalid carried store pointer: ${outside}` }
        : await carriedStoreComplete(
            path.join(root, "hmr", "store", "carried", source.image),
            pointers.map((value) => value.slice(prefix.length)),
          );
      if (complete.ok) return { kind: "current" };
    }
  }
  try {
    await layCarriedStore(dir, path.join(root, "hmr"));
    return { kind: "copied", source };
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
