/**
 * The page SDK: what a workbench's own pages import by URL to follow the Agent's conversation,
 * served beside the workbench at `…/workbenches/:id/sdk/<file>` by the server that answers the
 * workbench (this one, or a machine's behind `/server/<machineId>`).
 *
 * - `amsp.js` is AMSP's browser build, byte for byte: the records, `SessionReader`,
 *   `HttpTransport` and the rest of `@prismshadow/amsp`, one ES module with nothing to resolve.
 * - `workbench.js` re-exports it and adds the signed-in reader's door already pointed at this
 *   server: `apiBase`, `transport`, `followSession(id, { tailLimit? })`, `abortSession(id)`.
 *
 * The browser build reaches this module as an import, never as a file read beside a package:
 * the desktop app and a hot-pushed build run the server as one bundled file with no
 * node_modules, and a bundler only carries what is imported. It is imported when first asked
 * for, so a checkout whose AMSP build predates it fails this route rather than the server's
 * start.
 *
 * Both are revalidated on every load (`no-cache`, an ETag of their bytes): a page picks up a new
 * build the moment the server has one, at the price of a 304.
 */
import { createHash } from "node:crypto";

export const PAGE_SDK_CONTENT_TYPE = "text/javascript; charset=utf-8";

export interface PageSdkFile {
  body: Uint8Array<ArrayBuffer>;
  etag: string;
}

/**
 * The module a page imports. `import.meta.url` is where it was loaded from, which is how it
 * knows its server's API without being told: the path before `/projects/…` is `/api`, or
 * `/server/<machineId>/api` when the workbench lives on a machine, or whatever a reverse proxy
 * put in front of either. Plain JavaScript, ASCII only, no template literals: it is served as
 * written.
 */
export const WORKBENCH_MODULE = `// The page SDK of a PenguinHarness workbench: AMSP's browser build, and the signed-in
// reader's door of the server this page came from. Import it from a page in the workbench's
// ui/ folder as "../sdk/workbench.js".
import { HttpTransport, SessionReader } from "./amsp.js";

export * from "./amsp.js";

const MOUNT = /\\/projects\\/[^/]+\\/agents\\/[^/]+\\/workbenches\\/[^/]+\\/sdk\\/workbench\\.js$/;
const here = new URL(import.meta.url).pathname;
const mount = here.search(MOUNT);
if (mount < 0) {
  throw new Error("workbench.js is served at .../workbenches/<id>/sdk/workbench.js, not " + here);
}

/** The API of the server this page came from: "/api", or "/server/<machineId>/api" for a machine's. */
export const apiBase = here.slice(0, mount);

/** That API over this page's own sign-in: the cookie, same origin. */
export const transport = new HttpTransport({ baseUrl: apiBase, credentials: "same-origin" });

const sessionPath = (sessionId) => "/sessions/" + encodeURIComponent(sessionId);

/**
 * Follows a Session the signed-in user can read: a SessionReader on its records (history,
 * then live). Options are the reader's: tailLimit (default 20). close() it when done.
 */
export function followSession(sessionId, options = {}) {
  return new SessionReader(transport, sessionId, {
    ...options,
    streamPath: sessionPath(sessionId) + "/amsp",
  });
}

/** Interrupts the Session's running Task: true when one was running, false when it was idle. */
export async function abortSession(sessionId) {
  const res = await transport.post(sessionPath(sessionId) + "/abort");
  return res.status === 202;
}
`;

const etagOf = (bytes: Uint8Array): string =>
  `"${createHash("sha256").update(bytes).digest("base64url").slice(0, 27)}"`;

const fileOf = (text: string): PageSdkFile => {
  const body = new TextEncoder().encode(text);
  return { body, etag: etagOf(body) };
};

export type PageSdkName = "amsp.js" | "workbench.js";

export const isPageSdkName = (name: string): name is PageSdkName =>
  name === "amsp.js" || name === "workbench.js";

let amsp: Promise<PageSdkFile> | null = null;
let workbench: PageSdkFile | null = null;

export function pageSdkFile(name: PageSdkName): Promise<PageSdkFile> {
  if (name === "workbench.js") {
    workbench ??= fileOf(WORKBENCH_MODULE);
    return Promise.resolve(workbench);
  }
  amsp ??= import("@prismshadow/amsp/browser-source").then(
    ({ BROWSER_SOURCE }) => fileOf(BROWSER_SOURCE),
    (err: unknown) => {
      // Not kept: a rebuilt package is picked up by the next request.
      amsp = null;
      throw err;
    },
  );
  return amsp;
}

/** Whether an `If-None-Match` names `etag` (a weak match, as a conditional GET compares). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}
