/**
 * The harness this installation carries: copied into whichever data root it serves, at
 * startup, before anything reads the root's record.
 *
 * Every channel that ships a program ships a harness image with it — the hot push's own
 * body format (`scripts/deploy.mjs --out`), packed from the same sources (release.yml packs
 * it into a tarball's and the desktop app's `dist/`; the Docker image packs one the same
 * way). The body travels with the program; the data root is wherever the user points
 * PENGUIN_HOME — chosen per run, unknown at pack time. So the copy is not a step of any
 * installer: every start of the server is the same idempotent reconciliation, "this root's
 * record, against this program's image":
 *
 * - no record → copy, and the root holds a harness from the moment it is first served;
 * - a record copied from this very body (the `source` mark below) → nothing to do, on
 *   every start after the first;
 * - a record copied from an older body (an upgraded installation over an old root) → copy
 *   again, and the root rises to the version this program carries;
 * - a record with no mark (a hot push, or a peer's copied state) → untouched. A push is a
 *   newer decision than any shipped image, and the copy never outlives it.
 *
 * The mark lives in the record's `source` — the provenance field a pusher may already
 * write — as `{ repo, revision, channel, image }`, where `image` is 16 hex of the body's
 * sha256. A pushed record's source has no `channel`, which is exactly the distinction the
 * judgment reads; the fields a pusher's `source` carries are left untouched when it does.
 *
 * The copy writes through the same writer a push lands with (hmr/pushed-build.ts's
 * writePushedBuild), so the store a root receives is the store a push would have left, and
 * every reader — readHarnessMeta, resolveCli, the version report — answers it identically.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { readHarnessMeta } from "@prismshadow/penguin-hmr/manifest";
import { writePushedBuild } from "./pushed-build.js";
import type { PushedBuild } from "./pushed-build.js";

/** The provenance a copied record carries: which shipped body it came from. */
export interface CarriedSource {
  repo: string;
  revision: string;
  channel: "shipped-image";
  /** 16 hex digits of sha256 over the body file's bytes. */
  image: string;
}

/** What one reconciliation did, for the line the start logs about it. */
export type SyncOutcome =
  | { kind: "copied"; build: PushedBuild; source: CarriedSource }
  | { kind: "current" }
  | { kind: "kept"; reason: "pushed" | "unreadable-record" | "unreadable-body" }
  | { kind: "absent"; reason: "no-body" }
  | { kind: "failed"; detail: string };

/**
 * The shipped image body this program carries, found from where the entry sits:
 * - a release tarball (`<root>/lib/dist/<entry>.js`) or a packaged desktop app
 *   (`<resources>/app/dist/server.js`): the body beside it in the same `dist/` — the way
 *   installedRelease recognises both;
 * - an npm install (`…/node_modules/@prismshadow/penguin-cli/dist/<entry>.js`): the body
 *   in the server package's `dist/`, reached through the workspace dependency the CLI
 *   already declares.
 * Null for a program that ships no image — a source checkout (it builds one on demand,
 * checkout-image.ts) and any other unrecognised layout among them.
 */
export function carriedBody(argv1: string | undefined = process.argv[1]): string | null {
  if (!argv1 || path.basename(path.dirname(argv1)) !== "dist") return null;
  const beside = path.join(path.dirname(argv1), "install-image.gz");
  if (fs.existsSync(beside)) return beside;
  const parent = path.dirname(path.dirname(argv1));
  if (path.basename(parent) === "@prismshadow") {
    // npm: the server package is a direct dependency of the CLI's, so its location is
    // resolvable from here; the body ships in its dist/ beside its own bundle.
    try {
      const serverDir = path.dirname(
        createRequire(path.join(path.dirname(argv1), "noop.js")).resolve(
          "@prismshadow/penguin-server/package.json",
        ),
      );
      const body = path.join(serverDir, "dist", "install-image.gz");
      return fs.existsSync(body) ? body : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Reads the body into a build and its source mark. Separate from the sync so a caller can
 * show what it WOULD copy; null when the body cannot be read or parsed.
 */
export async function readCarriedImage(
  body: string,
): Promise<{ build: PushedBuild; source: CarriedSource } | null> {
  let build: PushedBuild;
  try {
    build = JSON.parse(zlib.gunzipSync(await fsp.readFile(body)).toString("utf8")) as PushedBuild;
  } catch {
    return null;
  }
  return { build, source: sourceOf(body) };
}

/** The mark a record copied from this body carries. */
function sourceOf(body: string): CarriedSource {
  // release.yml stamps repo/revision into the image's build.source at pack time; a body
  // without one still gets the mark, with those two left to the packer's own report.
  const image = createHash("sha256").update(fs.readFileSync(body)).digest("hex").slice(0, 16);
  return { repo: "", revision: "", channel: "shipped-image", image };
}

/**
 * The one reconciliation. See the module doc for the four answers and why each is right.
 * Never throws: a start that cannot copy still starts (the root keeps whatever record it
 * had), and the outcome says what happened.
 */
export async function syncCarriedImage(root: string, body: string | null): Promise<SyncOutcome> {
  if (body === null || !fs.existsSync(body)) return { kind: "absent", reason: "no-body" };
  const carried = await readCarriedImage(body);
  if (carried === null) return { kind: "kept", reason: "unreadable-body" };
  const { build, source } = carried;

  const meta = await readHarnessMeta(root);
  if (meta.kind === "broken") return { kind: "kept", reason: "unreadable-record" };
  if (meta.kind === "meta") {
    const marked = meta.manifest.source as Partial<CarriedSource> | undefined;
    if (marked?.channel !== "shipped-image") return { kind: "kept", reason: "pushed" };
    // Same body → every file the record names is one this program still carries (the store
    // was written from it); nothing to do. A different image → an upgrade: copy over it.
    if (marked.image === source.image) return { kind: "current" };
  }

  try {
    const stamped: PushedBuild = {
      ...build,
      source: { ...source, ...(build.source ?? {}) },
    };
    await writePushedBuild(path.join(root, "hmr"), stamped, new Date());
    return { kind: "copied", build, source };
  } catch (err) {
    return {
      kind: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
