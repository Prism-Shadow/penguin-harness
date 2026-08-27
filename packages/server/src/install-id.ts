/**
 * Install identity of a data root (`<root>/install-id`).
 *
 * The problem it exists for: the browser keeps UI state in `localStorage` — the new-chat
 * draft with its Workspace, the sidebar's registered Workspaces, pinned Sessions, seen
 * markers — and `localStorage` has no relationship whatsoever to the data root. In the
 * desktop app it lives in Electron's userData directory, so deleting `PENGUIN_HOME` does
 * not touch a byte of it. Both halves of every key are compile-time constants
 * (`ADMIN_USER_ID`, `DEFAULT_PROJECT_ID`), so a wipe-and-restart re-provisions the same
 * user and the same Project, the keys line up again, and the state the user thought they
 * had deleted comes back. This file gives the ROOT a name the browser can compare against,
 * so a root the user replaced is recognisable as a different one.
 *
 * It is an IDENTITY, not a credential. It authorizes nothing, so it gets none of the
 * handling `api-token` gets: ordinary file permissions, no rotation, and it is served to
 * unauthenticated callers (http/routes/install.ts) — the browser has to sweep before it
 * knows whether anyone is signed in, and after a wipe nobody is. A `randomUUID` carries no
 * host name, no user name and no timestamp, so publishing it discloses nothing beyond
 * "this root has existed since some earlier boot".
 *
 * Lifecycle: minted the first time a root is used and never touched again. A restart on
 * the same root reports the same id (nothing is swept); a root that was deleted and
 * re-created has no file, so the next boot mints a new one (the browser sweeps).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function installIdPath(root: string): string {
  return path.join(root, "install-id");
}

/** Printable ASCII, no spaces: the shape an id must have to be stored and compared safely. */
const ID_SHAPE = /^[\x21-\x7e]+$/;

/**
 * The stored id, or null when the file holds nothing usable. Deliberately strict about
 * shape — one line, printable, bounded length — because whatever comes back is compared
 * against, and stored in, a browser's `localStorage`. A hand-written id is accepted as
 * long as it is that shape; the format is not pinned to a UUID.
 */
function parseInstallId(raw: string): string | null {
  const id = (raw.split("\n", 1)[0] ?? "").trim();
  if (id === "" || id.length > 200 || !ID_SHAPE.test(id)) return null;
  return id;
}

/**
 * Mints and persists a fresh id. tmp + rename so a concurrent reader never sees a partial
 * write. Returns null when it could not be persisted (a read-only root): an id we cannot
 * store would be different on every boot, and handing that to the browser would sweep the
 * user's UI state on every single load.
 */
function mintInstallId(root: string): string | null {
  const id = randomUUID();
  try {
    fs.mkdirSync(root, { recursive: true });
    const target = installIdPath(root);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${id}\n`);
    fs.renameSync(tmp, target);
    return id;
  } catch {
    return null;
  }
}

/**
 * This root's install id, minting one when the root has none yet. Null means "identity
 * unknown", which every caller must treat as "change nothing": the browser skips its sweep
 * rather than guess.
 *
 * Only an ABSENT file counts as a new root. Any other read failure — a permission problem,
 * exhausted descriptors — returns null instead of minting, because minting over a root that
 * still has its id would report a new identity for an unchanged root and destroy UI state
 * that was never stale. A file that exists but holds junk is re-minted: tmp + rename means
 * this writer cannot produce a torn one, so junk is external tampering with a file we own,
 * and re-minting is the only outcome that leaves the root usable afterwards.
 */
export function ensureInstallId(root: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(installIdPath(root), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return null;
    return mintInstallId(root);
  }
  return parseInstallId(raw) ?? mintInstallId(root);
}

/** The stored id without ever minting one; null when absent or unusable (tests, diagnostics). */
export function readInstallId(root: string): string | null {
  try {
    return parseInstallId(fs.readFileSync(installIdPath(root), "utf8"));
  } catch {
    return null;
  }
}
