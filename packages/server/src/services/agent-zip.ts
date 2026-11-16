/**
 * An Agent package on the way in. A zip holds the Agent's directory under one top-level folder
 * named by its id: `<id>/agent_state/…` and `<id>/traces/<yyyy-mm-dd>/<session>_<NNN>.jsonl`. It
 * is unpacked into the layout a `.tar.gz` snapshot extracts to, so the import that follows is the
 * same for both.
 *
 * The caps are read off the central directory before an entry is inflated (unzipSync allocates
 * what an entry declares; see skill-import-limits.ts). An entry that is a link, leaves the
 * package, carries a control character or differs from another only in letter case refuses the
 * whole package. Entries the import never takes, and anything beside `agent_state/` and the Trace
 * files, are dropped.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { HttpError, badRequest } from "../http/errors.js";
import { assertSafeEntryPath } from "./skill-import-limits.js";
import { assertDistinctPaths, CONTROL_CHARACTER, specialEntries } from "./zip-entries.js";

/** An Agent package's caps: the upload, what it unpacks to, and its entries. An export stays within them. */
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
export const MAX_ENTRIES = 20_000;

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const TRACE_FILE = /^([A-Za-z0-9_-]{1,128})_(\d{3})\.jsonl$/;

/** The import route, whose request body takes the package cap instead of the API's. */
export const isAgentImport = (method: string, apiPath: string): boolean =>
  method === "POST" && /^\/api\/projects\/[^/]+\/agents\/import$/.test(apiPath);

/** A zip's magic bytes (a `.tar.gz` starts with gzip's 1f 8b instead). */
export const isZip = (bytes: Uint8Array): boolean => bytes[0] === 0x50 && bytes[1] === 0x4b;

/** The top-level folder of a zip's first entry: the id the package names. Nothing is inflated. */
export function zipTopDirectory(bytes: Uint8Array): string | undefined {
  let top: string | undefined;
  try {
    unzipSync(bytes, {
      filter: ({ name }) => {
        if (top === undefined && name.indexOf("/") > 0) top = name.slice(0, name.indexOf("/"));
        return false;
      },
    });
  } catch {
    // Not a zip after all: the unpack says so.
  }
  return top;
}

/**
 * Writes a zip package's `agent_state/` and Trace files into `dir` as `dir/agent_state/…` and
 * `dir/traces/…`. `keep` (a path rooted at `agent_state/`) says which State entries an import
 * takes. Every refusal is a 400.
 */
export async function unpackAgentZip(
  bytes: Uint8Array,
  dir: string,
  keep: (rel: string) => boolean,
): Promise<void> {
  const refuse = (why: string) => badRequest(`Import failed: ${why}`);
  let top: string | undefined;
  let entries = 0;
  let declared = 0;
  const names: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        entries += 1;
        declared += originalSize;
        if (entries > MAX_ENTRIES) throw refuse(`the package has over ${MAX_ENTRIES} entries.`);
        if (declared > MAX_UNPACKED_BYTES) throw refuse("the package unpacks to over 512MB.");
        assertSafeEntryPath(name);
        if (CONTROL_CHARACTER.test(name)) {
          throw refuse(`an entry name holds a control character: ${JSON.stringify(name)}`);
        }
        const slash = name.indexOf("/");
        if (slash <= 0 || name.slice(0, slash) !== (top ??= name.slice(0, slash))) {
          throw refuse("a package holds one top-level folder, named by the Agent's id.");
        }
        const rel = name.slice(slash + 1);
        if (rel === "" || rel.endsWith("/")) return false;
        names.push(rel);
        const [part, date, file] = rel.split("/");
        if (part === "agent_state") return keep(rel);
        return part === "traces" && DATE_DIR.test(date ?? "") && TRACE_FILE.test(file ?? "");
      },
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw refuse("not a zip or a tar.gz snapshot package.");
  }
  const special = specialEntries(bytes);
  if (special.length > 0) throw refuse(`the package holds a link or a special file: ${special[0]}`);
  assertDistinctPaths(names, badRequest);
  for (const [name, data] of Object.entries(files)) {
    const file = path.join(dir, name.slice(top!.length + 1));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
}

/**
 * The package's Trace files under `dir` (its `traces/`), read and grouped by Session. Only regular
 * files named as the Trace Writer names them, in date folders that are real folders, are read: a
 * snapshot package's tar may carry anything there, links included.
 */
export async function readPackageTraces(
  dir: string,
): Promise<{ sessionId: string; files: { date: string; index: number; body: string }[] }[]> {
  const sessions = new Map<string, { date: string; index: number; body: string }[]>();
  const dates = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const date of dates.filter((d) => d.isDirectory() && DATE_DIR.test(d.name))) {
    for (const entry of await fs.readdir(path.join(dir, date.name), { withFileTypes: true })) {
      const match = TRACE_FILE.exec(entry.name);
      if (!entry.isFile() || match === null) continue;
      const files = sessions.get(match[1]!) ?? [];
      const body = await fs.readFile(path.join(dir, date.name, entry.name), "utf8");
      files.push({ date: date.name, index: Number(match[2]), body });
      sessions.set(match[1]!, files);
    }
  }
  return [...sessions].map(([sessionId, files]) => ({ sessionId, files }));
}
