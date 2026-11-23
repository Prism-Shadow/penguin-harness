/** The data root's harness record, with absence distinguished from a damaged record. */
import fsp from "node:fs/promises";
import path from "node:path";
import type { Manifest } from "@prismshadow/penguin-hmr/manifest";

export type HarnessMeta =
  { kind: "none" } | { kind: "meta"; manifest: Manifest } | { kind: "broken"; reason: string };

export async function readHarnessMeta(root: string): Promise<HarnessMeta> {
  const file = path.join(root, "hmr", "harness.json");
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "broken", reason: `${file} could not be read: ${message(err)}` };
  }
  try {
    const manifest = JSON.parse(raw) as Manifest | null;
    // Preserve the reader's existing answer for a record with no committed version.
    if (
      manifest === null ||
      (manifest.platform?.bundle === undefined &&
        manifest.cli?.bundle === undefined &&
        manifest.web?.manifest === undefined)
    )
      return { kind: "none" };
    return { kind: "meta", manifest };
  } catch (err) {
    return { kind: "broken", reason: `${file} is not readable JSON: ${message(err)}` };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
