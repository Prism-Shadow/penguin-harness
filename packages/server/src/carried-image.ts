/** Reconcile the program's carried store with the data root it serves. */
import fs from "node:fs";
import path from "node:path";
import { readHarnessMeta } from "./harness-meta.js";
import { layCarriedStore, readCarriedStore } from "./carried-store.js";
import type { CarriedSource } from "./carried-store.js";
export { carriedStore as carriedBody } from "./machines/install-server.js";

export type SyncOutcome =
  | { kind: "copied"; source: CarriedSource }
  | { kind: "current" }
  | { kind: "kept"; reason: "pushed" | "unreadable-record" | "unreadable-body" }
  | { kind: "absent"; reason: "no-body" }
  | { kind: "failed"; detail: string };

/** No record: copy. Same image: current. Older image: upgrade. Push or peer: defer. */
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
    if (marked.image === source.image) return { kind: "current" };
  }
  try {
    await layCarriedStore(dir, path.join(root, "hmr"));
    return { kind: "copied", source };
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
