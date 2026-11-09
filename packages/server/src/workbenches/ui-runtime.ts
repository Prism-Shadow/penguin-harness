/**
 * The page runtime: the browser build of React and the shared UI package that a workbench's
 * TSX pages import, and the declarations those pages are checked against.
 *
 * It travels inside the Web App's files, at `workbench-runtime/`, because every form of the
 * server already carries those — a checkout's web dist, the npm package's, a release, the
 * desktop app, and a hot push (held in memory). So a page runs the copy of the server that
 * answers it, and that server checked the page against the same build's types:
 *
 *   manifest.json   { version, imports: { <bare specifier>: <file> }, stylesheet, types }
 *   <file>          ES modules and the stylesheet, served at `…/workbenches/:id/sdk/ui/<file>`
 *   types/          declarations laid out as a node_modules root, copied into
 *                   `<workbench>/.harness/ui/` for the compiler and the Agent to read
 *
 * The manifest and the declarations are the server's own and never served. Files are read
 * where they lie on each request, so a new Web App build is picked up without a restart.
 */
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { HARNESS_DIR } from "./harness-types.js";
import { etagOf } from "./page-sdk.js";
import { isSafeRelPath } from "./store.js";

/** Where the runtime lies among the Web App's files. */
export const UI_RUNTIME_DIR = "workbench-runtime";
const MANIFEST_FILE = "manifest.json";
/** A workbench's copy of the runtime's declarations, beside the handler's (./harness-types.ts). */
export const UI_TYPES_DIR = `${HARNESS_DIR}/ui`;

export interface UiRuntimeManifest {
  version: string;
  /** Bare specifier → the runtime file (relative to the runtime) the page loads for it. */
  imports: Record<string, string>;
  stylesheet: string;
  /** The declarations' directory, relative to the runtime. */
  types: string;
}

/** The Web App's files as this server holds them: on disk, or pushed and held in memory. */
export type WebFiles = { kind: "mem"; files: Map<string, Buffer> } | { kind: "dir"; dir: string };

export interface UiRuntime {
  manifest: UiRuntimeManifest;
  /** A file a page may load, by its path in the runtime; null when absent or the server's own. */
  file(rel: string): Promise<{ body: Uint8Array; etag: string } | null>;
  /** The declarations, by their path under `types/`. */
  types(): Map<string, Uint8Array>;
}

/** The validator of each file on disk, kept while its size and mtime hold: hashing a megabyte per request is waste. */
const diskEtags = new Map<string, { size: number; mtimeMs: number; etag: string }>();
/** Validators of pushed files; a push brings new buffers, and the old ones go with them. */
const memEtags = new WeakMap<Buffer, string>();

function parseManifest(text: string): UiRuntimeManifest {
  const raw = JSON.parse(text) as Partial<UiRuntimeManifest>;
  const file = (value: unknown) => typeof value === "string" && isSafeRelPath(value);
  const imports = raw.imports;
  if (
    typeof raw.version !== "string" ||
    !file(raw.stylesheet) ||
    !file(raw.types) ||
    imports === null ||
    typeof imports !== "object" ||
    !Object.values(imports).every(file)
  ) {
    throw new Error("it is not { version, imports, stylesheet, types }");
  }
  return raw as UiRuntimeManifest;
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The runtime among `source`'s files, or null when they carry none (a Web App built before
 * pages could be TSX). A manifest that does not parse is an error, not an absence.
 */
export function openUiRuntime(source: WebFiles): UiRuntime | null {
  const text =
    source.kind === "mem"
      ? source.files.get(`${UI_RUNTIME_DIR}/${MANIFEST_FILE}`)?.toString("utf8")
      : readText(path.join(source.dir, UI_RUNTIME_DIR, MANIFEST_FILE));
  if (text === undefined) return null;
  let manifest: UiRuntimeManifest;
  try {
    manifest = parseManifest(text);
  } catch (err) {
    throw new Error(
      `the page runtime's ${UI_RUNTIME_DIR}/${MANIFEST_FILE} cannot be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return source.kind === "mem"
    ? memRuntime(source.files, manifest)
    : dirRuntime(path.join(source.dir, UI_RUNTIME_DIR), manifest);
}

/** The runtime TSX pages need, or the load error that says it is missing and where it was looked for. */
export function requireUiRuntime(source: WebFiles): UiRuntime {
  const runtime = openUiRuntime(source);
  if (runtime !== null) return runtime;
  const where =
    source.kind === "mem"
      ? "in the Web App files pushed to this server"
      : `at ${path.join(source.dir, UI_RUNTIME_DIR, MANIFEST_FILE)}`;
  throw new Error(
    `ui/ has TSX pages, but this server has no page runtime to compile them against: ` +
      `no ${UI_RUNTIME_DIR}/${MANIFEST_FILE} ${where}. ` +
      `Run the workbench on a server whose Web App includes it, or write the pages in plain JavaScript.`,
  );
}

/** Whether a path in the runtime is a page's to load: not the manifest, not the declarations. */
function servable(manifest: UiRuntimeManifest, rel: string): boolean {
  return (
    isSafeRelPath(rel) &&
    rel !== MANIFEST_FILE &&
    rel !== manifest.types &&
    !rel.startsWith(`${manifest.types}/`)
  );
}

function memRuntime(files: Map<string, Buffer>, manifest: UiRuntimeManifest): UiRuntime {
  const prefix = `${UI_RUNTIME_DIR}/`;
  const typesPrefix = `${prefix}${manifest.types}/`;
  return {
    manifest,
    async file(rel) {
      const body = servable(manifest, rel) ? files.get(prefix + rel) : undefined;
      if (body === undefined) return null;
      let etag = memEtags.get(body);
      if (etag === undefined) memEtags.set(body, (etag = etagOf(body)));
      return { body, etag };
    },
    types() {
      const out = new Map<string, Uint8Array>();
      for (const [key, body] of files) {
        if (key.startsWith(typesPrefix)) out.set(key.slice(typesPrefix.length), body);
      }
      return out;
    },
  };
}

function dirRuntime(root: string, manifest: UiRuntimeManifest): UiRuntime {
  return {
    manifest,
    async file(rel) {
      if (!servable(manifest, rel)) return null;
      const abs = path.join(root, ...rel.split("/"));
      let handle: FileHandle;
      try {
        handle = await fs.promises.open(abs, "r");
      } catch {
        return null;
      }
      try {
        // One handle for both: the validator describes the very bytes that are sent.
        const stat = await handle.stat();
        if (!stat.isFile()) return null;
        const { size, mtimeMs } = stat;
        const body = await handle.readFile();
        const known = diskEtags.get(abs);
        if (known?.size === size && known.mtimeMs === mtimeMs) return { body, etag: known.etag };
        const etag = etagOf(body);
        diskEtags.set(abs, { size, mtimeMs, etag });
        return { body, etag };
      } finally {
        await handle.close();
      }
    },
    types() {
      const dir = path.join(root, ...manifest.types.split("/"));
      const out = new Map<string, Uint8Array>();
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
      } catch {
        return out;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const abs = path.join(entry.parentPath, entry.name);
        out.set(path.relative(dir, abs).split(path.sep).join("/"), fs.readFileSync(abs));
      }
      return out;
    },
  };
}

/** Whether `dir` holds exactly `files`, byte for byte. */
function holds(dir: string, files: Map<string, Uint8Array>): boolean {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) count++;
    }
    if (count !== files.size) return false;
    for (const [rel, bytes] of files) {
      if (!fs.readFileSync(path.join(dir, ...rel.split("/"))).equals(bytes)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies the runtime's declarations into `<workbench>/.harness/ui/` unless it already holds
 * exactly them, and returns that directory. Unlike the handler's types, which stay what the
 * workbench was written against, these follow the server: a page runs on this server's
 * runtime, so it is checked against this server's types. Built aside and moved into place,
 * so the compiler never reads a half-written tree.
 */
export function installUiTypes(dir: string, runtime: UiRuntime): string {
  const target = path.join(dir, ...UI_TYPES_DIR.split("/"));
  const files = runtime.types();
  if (holds(target, files)) return target;
  const staging = `${target}.${process.pid}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const [rel, bytes] of files) {
    const file = path.join(staging, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  return target;
}
