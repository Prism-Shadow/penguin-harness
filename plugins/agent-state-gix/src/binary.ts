/**
 * The native half, loaded once per process.
 *
 * The build lays the addon at `native/index.node` (the platform's cdylib under the one name),
 * so the runtime needs no platform table — the package ships the addon built for the platform
 * it runs on.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The addon's surface, as `native/src/lib.rs` declares it. */
export interface Native {
  engineVersion(): string;
  commit(input: {
    gitdir: string;
    ref_name: string;
    parent: string | null;
    rel: string;
    files: Array<{ rel: string; body: Uint8Array }> | null;
    message: string;
    author: { name: string; email: string; when_seconds: number; when_offset_minutes: number };
    committer: { name: string; email: string; when_seconds: number; when_offset_minutes: number };
  }): string;
  readBlobs(gitdir: string, oids: string[]): Uint8Array[];
}

export function loadNative(): Native {
  return require(path.join(root, "native", "index.node")) as Native;
}
