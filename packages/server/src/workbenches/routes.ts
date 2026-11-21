/**
 * Agent-scoped workbench routes, mounted at /api/projects/:projectId/agents/:agentId/workbenches:
 *
 *   GET    /                       the Agent's workbenches, disabled ones included, and the
 *                                  Agent-wide switch (loads any that run and changed on disk)
 *   GET    /?view=sidebar          the rows of the Agent's sidebar list: a shortcut for each
 *                                  workbench that runs, has a tab and is not hidden from the
 *                                  sidebar (manifests and load status only: nothing is compiled)
 *   PUT    /enabled {enabled}      the Agent-wide switch (owner only): off unloads them all
 *   POST   /archive {dataBase64, overwrite?}  import one workbench's source from a zip, then load it
 *   GET    /:id/archive            the workbench's source as a zip, which imports back unchanged
 *   PUT    /:id/enabled {enabled}  one workbench's own switch (owner only): off unloads it
 *   POST   /:id/reload             re-import the folder now (the watcher does this on change too)
 *   GET    /:id/history            the versions that loaded, newest first
 *   POST   /:id/rollback {revision} restore that version's files and reload
 *   PATCH  /:id/sidebar {show}     write or remove this installation's `.hidden-from-sidebar`
 *   PATCH  /:id/app-center {show}  set `penguin.appCenter.show` in its package.json and reload
 *   GET    /:id/app-center/icon    the image its App Center declaration names, re-checked and
 *                                  served as icons are (../http/icon-response.ts); 404
 *                                  `icon_not_found` when it names none that reads clean
 *   DELETE /:id                    remove the folder and its state; its history is no longer listed
 *   GET    /:id/ui/*               a file of the workbench's `ui/` (the pages its tabs name), or
 *                                  the `.js` a TSX page compiled to (see compile-ui.ts)
 *   GET    /:id/manifest.webmanifest  the workbench's PWA manifest (see manifest.ts)
 *   GET    /:id/sdk/ui/*           the page runtime compiled pages import (see ui-runtime.ts)
 *   GET    /:id/sdk/amsp.js        the page SDK: AMSP's browser build (see page-sdk.ts)
 *   GET    /:id/sdk/workbench.js   the page SDK: that build plus this server's signed-in door
 *   *      /:id/api/*              handed to the workbench's WorkbenchMain.handle: JSON by default, any
 *                                  content type when the handler names one (see respond)
 *
 * Every route requires access to the Project; the UI and api routes are what the
 * workbench's own page (an iframe in the Web App, same-origin cookie auth) talks to. A
 * workbench that does not run (either switch off) is refused by every route that serves it —
 * ui, sdk, api, reload — with 409 `workbench_disabled`; an import or a rollback writes its
 * source without loading it.
 *
 * The App Center is Project-wide, mounted at /api/projects/:projectId/app-center:
 *
 *   GET    /                       every shown workbench of the Project's Agents on this server
 *                                  (manifests and load status only: nothing is compiled), and the
 *                                  viewer's own arrangement of them
 *   PUT    /layout {layout}        replace the viewer's arrangement; null restores the server's
 *                                  order (see app-center-layout.ts)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { Hono } from "hono";
import type { Context } from "hono";
import { agentDir } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type {
  AppCenterLayoutResponse,
  AppCenterResponse,
  WorkbenchAppCenterResponse,
  WorkbenchArchiveInstallResponse,
  WorkbenchesResponse,
  WorkbenchSidebarResponse,
  WorkbenchSidebarSetResponse,
} from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import type { Paths } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { iconResponse } from "../http/icon-response.js";
import { mediaType } from "@prismshadow/penguin-library-http/media-type";
import { badRequest, readJson, requireString, requireValidId } from "../http/validate.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { Access, Projects } from "@prismshadow/penguin-library-project";
import type { UiPrefsStore } from "@prismshadow/penguin-library-setting";
import { MAX_ARCHIVE_BYTES } from "../services/skill-import-limits.js";
import { forwardToMachine } from "../machines/proxy.js";
import { MachineSocketRelay } from "../machines/socket-relay.js";
import type { Machines } from "../machines/service.js";
import type { Workbenches } from "../mechanisms/workbenches.js";
import type { VersionAuthor } from "./git-identity.js";
import type { WorkbenchRequest, WorkbenchResponse } from "@prismshadow/penguin-library-workbench";
import {
  parseAppCenterLayout,
  readAppCenterLayout,
  writeAppCenterLayout,
} from "./app-center-layout.js";
import {
  collectWorkbenchArchive,
  folderNameFor,
  parseWorkbenchArchive,
  workbenchArchiveName,
  writeWorkbenchSource,
} from "./archive.js";
import { migrateWorkbenches } from "./migrate.js";
import { withUiRuntime } from "./page-html.js";
import { etagMatches, isPageSdkName, PAGE_SDK_CONTENT_TYPE, pageSdkFile } from "./page-sdk.js";
import { WorkbenchDisabled, contributedAppIcon, WorkbenchNotFound } from "./service.js";
import { workbenchManifest } from "./manifest.js";
import { isWorkbenchId, readFolder, workbenchesDir } from "./store.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** The largest request body a workbench's handler is handed. */
const MAX_BODY_BYTES = 50 * 1024 * 1024;
/** Never shown to a workbench: they are the app's credentials, not the workbench's. */
const WITHHELD_REQUEST_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);
/** Never taken from a workbench: the app's cookies, and what the transport decides for itself. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
]);

const tooLarge = () =>
  new HttpError(
    413,
    "payload_too_large",
    `A workbench request body is at most ${MAX_BODY_BYTES} bytes`,
  );

/** The headers both manifest routes answer with (see manifestRoutes). */
const MANIFEST_HEADERS = {
  "content-type": "application/manifest+json; charset=utf-8",
  "cache-control": "no-cache",
} as const;

const isJson = (contentType: string | undefined): boolean => {
  if (contentType === undefined) return true;
  const type = mediaType(contentType);
  return (
    type?.type === "application" && (type.subtype === "json" || type.subtype.endsWith("+json"))
  );
};

const isFile = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    (stat) => stat.isFile(),
    () => false,
  );

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function forwardedHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!WITHHELD_REQUEST_HEADERS.has(name.toLowerCase())) out[name.toLowerCase()] = value;
  });
  return out;
}

/**
 * JSON unless the handler says otherwise: a `content-type` header (or `bytes`) makes the
 * response the handler's own — a page it proxies from a program it runs, an image, a
 * download, a redirect — and `stream` sends it as it is produced. The same origin already serves the workbench's `ui/` files as
 * written, so a handler that answers HTML is no wider than a file that is HTML.
 */
/**
 * The body, refused the moment it goes past the cap rather than after it is in memory. A
 * declared `content-length` is only a claim — a chunked request carries none at all — so the
 * count that decides is the one taken while reading. Nothing larger than the cap is ever
 * held, and the reader is cancelled so the sender is not left writing into a socket no one
 * reads.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw tooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function respond(response: WorkbenchResponse): Response {
  const status = response.status ?? 200;
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    if (DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    // An illegal value (a CR/LF among them, which is why this throws) loses the header, not
    // the whole answer: the handler still gets to reply.
    try {
      headers.set(name, value);
    } catch {
      continue;
    }
  }
  // The statuses fetch forbids a body on: constructing a Response with one throws, which
  // would reach the client as a bare 500 instead of the answer the handler meant.
  const bodiless =
    status === 101 ||
    status === 103 ||
    status === 204 ||
    status === 205 ||
    status === 304 ||
    (status >= 300 && status < 400);
  if (response.stream !== undefined && bodiless) {
    // Nothing will read it, so whatever it holds open is released now.
    const it = response.stream[Symbol.asyncIterator]();
    void it.return?.(undefined);
  }
  if (response.stream !== undefined && !bodiless) {
    if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
    return new Response(streamOf(response.stream), { status, headers });
  }
  if (response.bytes !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
    return new Response(bodiless ? null : response.bytes, { status, headers });
  }
  if (headers.has("content-type")) {
    const text = typeof response.body === "string" ? response.body : "";
    return new Response(bodiless ? null : text, { status, headers });
  }
  if (bodiless) return new Response(null, { status, headers });
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(response.body ?? null), { status, headers });
}

/**
 * The handler's iterator as a response body: one chunk out per chunk yielded, pulled only as
 * fast as the client reads. A client that disconnects cancels the stream, which ends the
 * iteration — the generator's `finally` runs, and whatever it was relaying is let go.
 */
function streamOf(chunks: AsyncIterable<Uint8Array | string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<Uint8Array | string> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      iterator ??= chunks[Symbol.asyncIterator]();
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else
          controller.enqueue(
            typeof next.value === "string" ? encoder.encode(next.value) : next.value,
          );
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator?.return?.();
    },
  });
}

export interface WorkbenchRouteDeps {
  access: Access;
  workbenches: Workbenches;
  /** The archive routes write and read the folders themselves, under this data root. */
  root: string;
  agentConfig: Pick<AgentConfig, "requireExists">;
}

/**
 * How the auth-less gate reaches a remote machine's identical gate: a forward through the
 * machine's connection (built in setup from the Machines service, the machine proxy's own
 * identity), answering the remote's Response verbatim — its status included, so an unknown
 * workbench THERE is the 404 it is there. Null only when there is no live forward to the
 * machine (the gate answers 503, the proxy's own answer for it).
 */
export type ThroughMachine = (
  projectId: string,
  agentId: string,
  machineId: string,
  workbenchId: string,
  tabKey: string | undefined,
) => Promise<Response | null>;

/** The stand-in when no Machines service is wired in: every machine is simply unreachable. */
const nullThroughMachine: ThroughMachine = () => Promise.resolve(null);

/** A `WorkbenchNotFound` from the service is a 404 at the gate; anything else is its own error. */
const notFound = (err: unknown): never => {
  if (err instanceof WorkbenchNotFound) throw new HttpError(404, "not_found", err.message);
  throw err;
};

/**
 * The forwarded answer's headers minus the ones that describe the body: the body may be
 * replaced (the machine query rides the start_url), so the old length and validator must
 * not ride along — the runtime recomputes or regenerates both. Everything else does.
 */
const passAlong = (remote: Response): Headers => {
  const headers = new Headers(remote.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return headers;
};
/**
 * A forwarded manifest of a remote machine, with the machine written into its `start_url`
 * and `scope` (they share one string). The remote gate generated the manifest for its own
 * server — its start_url names no machine, because only the hop that asked knows which
 * machine the workbench lives on. Anything the body of which is not a manifest with a
 * start_url (an error answer, a shape the hop did not expect) passes through as-is.
 */
export const withMachineInStartUrl = async (
  remote: Response,
  machineId: string,
): Promise<Response> => {
  if (!remote.ok) return remote;
  const text = await remote.text();
  let manifest: { start_url?: string; scope?: string };
  try {
    manifest = JSON.parse(text) as { start_url?: string; scope?: string };
  } catch {
    return new Response(text, { status: remote.status, headers: passAlong(remote) });
  }
  if (typeof manifest.start_url !== "string")
    return new Response(text, { status: remote.status, headers: passAlong(remote) });
  const url = new URL(manifest.start_url, "http://localhost");
  url.searchParams.set("machine", machineId);
  const withMachine = url.pathname + url.search;
  const body = JSON.stringify({ ...manifest, start_url: withMachine, scope: withMachine });
  return new Response(body, { status: remote.status, headers: passAlong(remote) });
};

/**
 * The install manifest on its own, auth-less gate: a browser fetching a manifest for
 * install carries no session for another host than the page's. It answers from the
 * workbench's own folder — its name, version, tabs and icon — nothing per-user, and it runs
 * no lifecycle: the read is `describe` (no migrate, no watcher, no compile/boot), so an
 * anonymous request can only look at a package.json, and its 404 for a missing workbench
 * says no more than the session-gated routes do.
 *
 * A workbench of a remote machine is named by `?machine=<id>` (the same query the app page
 * reads): the local gate hops to THAT machine's identical auth-less gate over the machine's
 * connection and answers with what it returned, with the machine named in `start_url` so the
 * installed app opens the tab there. The browser's cookies never cross — the identity is the
 * machine proxy's own (this server's admin session, minted over its ssh access to the
 * machine).
 */
export function manifestRoutes(
  workbenches: Workbenches,
  throughMachine: ThroughMachine = nullThroughMachine,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const manifest = async (
    projectId: string,
    agentId: string,
    id: string,
    tabKey: string | undefined,
    machineId: string | undefined,
  ): Promise<string | Response> => {
    // A manifest of a remote machine: what THAT gate answers, status included (it generated
    // the route with its own server's project/agent ids). The remote gate names no machine
    // in its start_url — only the hop knows which machine this is — so this side writes the
    // machine query into the start_url and scope before handing the manifest on: the
    // installed app must open the workbench ON THAT machine, not on this one.
    if (machineId !== undefined) {
      const remote = await throughMachine(projectId, agentId, machineId, id, tabKey);
      if (remote === null)
        throw new HttpError(503, "not_connected", `No live forward to ${machineId}.`);
      return withMachineInStartUrl(remote, machineId);
    }
    const info = await workbenches.describe(projectId, agentId, id).catch(notFound);
    const tab = tabKey === undefined ? undefined : info.tabs.find((t) => t.key === tabKey);
    if (tabKey !== undefined && tab === undefined)
      throw new HttpError(404, "not_found", "No such tab on the workbench.");
    // The icon of the tab this manifest is about — the first tab for the whole-workbench
    // one (its name and page anchor the first tab, so its icon does too) — then the
    // workbench's own plugin icon, then the main app's penguin.
    const icon =
      contributedAppIcon(tab === undefined ? info.tabs.slice(0, 1) : [tab]) ??
      (await workbenches.iconSvg(projectId, agentId, id));
    return JSON.stringify(workbenchManifest(projectId, agentId, info, icon, tabKey, machineId));
  };
  const machineOf = (c: { req: { query(name: string): string | undefined } }) => {
    const machine = c.req.query("machine");
    return machine === undefined || machine === "" ? undefined : machine;
  };
  // One manifest per workbench, and one per tab: the tab's own names the tab as the app —
  // its title (or its declared shortName) and its own full-page route as start_url/scope.
  app.get("/:id/manifest.webmanifest", async (c) => {
    const projectId = requireValidId(c as never, "projectId");
    const agentId = requireValidId(c as never, "agentId");
    const body = await manifest(projectId, agentId, c.req.param("id"), undefined, machineOf(c));
    if (body instanceof Response) return body;
    return c.body(body, 200, MANIFEST_HEADERS);
  });
  app.get("/:id/tabs/:tabKey/manifest.webmanifest", async (c) => {
    const projectId = requireValidId(c as never, "projectId");
    const agentId = requireValidId(c as never, "agentId");
    const body = await manifest(
      projectId,
      agentId,
      c.req.param("id"),
      c.req.param("tabKey"),
      machineOf(c),
    );
    if (body instanceof Response) return body;
    return c.body(body, 200, MANIFEST_HEADERS);
  });
  return app;
}

/**
 * One manifest request to a remote machine's identical auth-less gate: the machine proxy's
 * forward (this server's admin session on that machine, cookies dropped) answering the
 * manifest's JSON body verbatim — null when there is no live forward to the machine (the
 * gate answers 503, the proxy's own answer for it). The query's `machine` parameter is not
 * forwarded: on THAT server the request is a local one.
 */
async function manifestThroughMachine(deps: {
  machines: Machines;
  projectId: string;
  agentId: string;
  machineId: string;
  id: string;
  tabKey: string | undefined;
}): Promise<Response | null> {
  const target = await deps.machines.proxyTarget(deps.machineId).catch(() => null);
  if (target === null) return null;
  const remotePath =
    `/api/projects/${encodeURIComponent(deps.projectId)}` +
    `/agents/${encodeURIComponent(deps.agentId)}` +
    `/workbenches/${encodeURIComponent(deps.id)}` +
    (deps.tabKey === undefined ? "" : `/tabs/${encodeURIComponent(deps.tabKey)}`) +
    "/manifest.webmanifest";
  const request = new Request(`http://localhost${remotePath}`, { method: "GET" });
  const response = await forwardToMachine(
    request,
    { machineId: deps.machineId, remotePath },
    target,
    // No stream can be asked here (a manifest is a JSON GET), so a fresh relay stands in —
    // the shared one lives with the machines service, which this read does not reach.
    new MachineSocketRelay((line) => console.log(line)),
  );
  return response;
}

export function workbenchRoutes(deps: WorkbenchRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const scope = (c: {
    req: { param(name: string): string | undefined };
    var: AppEnv["Variables"];
  }) => {
    const projectId = requireValidId(c as never, "projectId");
    const agentId = requireValidId(c as never, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return { projectId, agentId };
  };
  /**
   * The member a version a request records is by: their display name, when they set one.
   * Accounts hold no email, so its email is the server's (../workbenches/git-identity.ts).
   */
  const by = (c: { var: AppEnv["Variables"] }): VersionAuthor | undefined => {
    const name = c.var.user.displayName?.trim();
    return name ? { name } : undefined;
  };
  app.get("/", async (c) => {
    const { projectId, agentId } = scope(c);
    if (c.req.query("view") === "sidebar") {
      const apps = await deps.workbenches.sidebar(projectId, agentId);
      return c.json({ apps } satisfies WorkbenchSidebarResponse);
    }
    const workbenches = await deps.workbenches.list(projectId, agentId);
    const enabled = await deps.workbenches.agentEnabled(projectId, agentId);
    return c.json({ workbenches, enabled } satisfies WorkbenchesResponse);
  });

  /** A switch is the owner's, like the Agent's other settings switches. */
  const switchRequest = async (c: Context<AppEnv>) => {
    const { projectId, agentId } = scope(c);
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfig.requireExists(projectId, agentId);
    const body = await readJson(c);
    if (typeof body.enabled !== "boolean") throw badRequest("enabled must be a boolean.");
    return { projectId, agentId, enabled: body.enabled };
  };

  app.put("/enabled", async (c) => {
    const { projectId, agentId, enabled } = await switchRequest(c);
    const listing = await deps.workbenches.setAgentEnabled(projectId, agentId, enabled);
    return c.json(listing satisfies WorkbenchesResponse);
  });

  app.put("/:id/enabled", async (c) => {
    const { projectId, agentId, enabled } = await switchRequest(c);
    const workbench = await deps.workbenches
      .setEnabled(projectId, agentId, c.req.param("id"), enabled, by(c))
      .catch(notFound);
    return c.json({ workbench });
  });

  /**
   * The folders these routes touch, once an older layout has been converted: a write that came
   * first would take the place the conversion publishes into, and stop it.
   */
  const folders = async (projectId: string, agentId: string): Promise<string> => {
    await migrateWorkbenches(agentDir(deps.root, projectId, agentId));
    return workbenchesDir(deps.root, projectId, agentId);
  };

  /**
   * Imports into one Agent run one at a time: which folder an id lands in, whether it is taken
   * and what is written there are decided together, or two uploads of one id would both find it
   * free and write into each other.
   */
  const importing = new Map<string, Promise<unknown>>();
  const oneAtATime = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const next = (importing.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
    importing.set(key, next);
    void next
      .finally(() => {
        if (importing.get(key) === next) importing.delete(key);
      })
      .catch(() => undefined);
    return next;
  };

  // Import one workbench from an uploaded zip (member-level, like the Skills archive route). Its
  // source is written and loaded at once, so the answer carries what the load came to.
  app.post("/archive", async (c) => {
    const { projectId, agentId } = scope(c);
    await deps.agentConfig.requireExists(projectId, agentId);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
    const overwrite = body.overwrite === true;
    const archive = Buffer.from(dataBase64, "base64");
    if (archive.byteLength === 0) throw badRequest("The zip archive is empty.");
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw badRequest("The zip archive exceeds the 14MB limit.");
    }
    const parsed = parseWorkbenchArchive(archive);
    const workbench = await oneAtATime(`${projectId}/${agentId}`, async () => {
      const base = await folders(projectId, agentId);
      // An id that differs from a folder's only in letter case is that folder.
      const id = await folderNameFor(base, parsed.id);
      const dir = path.join(base, id);
      // Taken means what the listing means by a workbench: the folder has a package.json.
      if (!overwrite && (await isFile(path.join(dir, "package.json")))) {
        throw new HttpError(409, "workbench_exists", `Workbench already exists: ${id}`, undefined, {
          workbenchId: id,
        });
      }
      await writeWorkbenchSource(dir, parsed.files);
      return deps.workbenches.reloadIfEnabled(projectId, agentId, id, by(c)).catch(notFound);
    });
    return c.json({ workbench } satisfies WorkbenchArchiveInstallResponse, 201);
  });

  // Export one workbench's source: a direct binary attachment (the Skill export's shape), which
  // the POST above takes back unchanged.
  app.get("/:id/archive", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const folder = isWorkbenchId(id)
      ? await readFolder(path.join(await folders(projectId, agentId), id), id)
      : null;
    if (folder === null) throw new HttpError(404, "not_found", `No such workbench: ${id}`);
    const zip = zipSync(await collectWorkbenchArchive(folder));
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(workbenchArchiveName(folder))}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.post("/:id/reload", async (c) => {
    const { projectId, agentId } = scope(c);
    const workbench = await deps.workbenches
      .reload(projectId, agentId, c.req.param("id"), by(c))
      .catch(notFound);
    return c.json({ workbench });
  });

  app.get("/:id/history", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json({
      versions: await deps.workbenches.history(projectId, agentId, c.req.param("id")),
    });
  });

  app.post("/:id/rollback", async (c) => {
    const { projectId, agentId } = scope(c);
    const body = (await c.req.json().catch(() => ({}))) as { revision?: unknown };
    if (typeof body.revision !== "string")
      throw new HttpError(400, "bad_request", "revision is required");
    const workbench = await deps.workbenches
      .rollback(projectId, agentId, c.req.param("id"), body.revision, by(c))
      .catch(notFound);
    return c.json({ workbench });
  });

  // The sidebar setting: member-level, like the App Center switch below. It writes a marker beside
  // the source, so nothing reloads and no version is recorded.
  app.patch("/:id/sidebar", async (c) => {
    const { projectId, agentId } = scope(c);
    const body = await readJson(c);
    if (typeof body.show !== "boolean") throw badRequest("show must be true or false");
    const workbench = await deps.workbenches
      .setSidebar(projectId, agentId, c.req.param("id"), body.show)
      .catch(notFound);
    return c.json({ workbench } satisfies WorkbenchSidebarSetResponse);
  });

  // The App Center switch: member-level, like reload and remove. The answer is the workbench as
  // the reload left it, its `appCenter` read back from the file.
  app.patch("/:id/app-center", async (c) => {
    const { projectId, agentId } = scope(c);
    const body = await readJson(c);
    if (typeof body.show !== "boolean") throw badRequest("show must be true or false");
    const workbench = await deps.workbenches
      .setAppCenter(projectId, agentId, c.req.param("id"), body.show, by(c))
      .catch(notFound);
    return c.json({ workbench } satisfies WorkbenchAppCenterResponse);
  });

  // The URL a shortcut carries names the image's revision (`?rev=`): the answer is kept for good.
  app.get("/:id/app-center/icon", async (c) => {
    const { projectId, agentId } = scope(c);
    const icon = await deps.workbenches.appCenterIcon(projectId, agentId, c.req.param("id"));
    return iconResponse(icon ?? undefined);
  });

  app.delete("/:id", async (c) => {
    const { projectId, agentId } = scope(c);
    await deps.workbenches.remove(projectId, agentId, c.req.param("id"), by(c)).catch(notFound);
    return c.body(null, 204);
  });

  app.get("/:id/ui/*", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const rel = c.req.path.split(`/workbenches/${id}/ui/`)[1] ?? "";
    const file = await deps.workbenches.uiFile(projectId, agentId, id, decodeURIComponent(rel));
    if (file === null)
      throw new HttpError(404, "not_found", "No such file in the workbench's ui/.");
    const body = await fs.readFile(file.path);
    const headers = {
      "content-type": MIME[path.extname(file.path).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
    };
    if (file.compiled === null) return c.body(body, 200, headers);
    // The page's own folder depth as the browser sees it: the path segments it was asked by.
    const depth = rel.split("/").length - 1;
    return c.body(withUiRuntime(body.toString("utf8"), depth, file.compiled), 200, headers);
  });

  // This server's page runtime, under a workbench that exists — what a compiled page's import
  // map names relative to it — revalidated like the page SDK below.
  app.get("/:id/sdk/ui/*", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const rel = c.req.path.split(`/workbenches/${id}/sdk/ui/`)[1] ?? "";
    let decoded: string | null;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      decoded = null;
    }
    const file =
      decoded === null
        ? null
        : await deps.workbenches.uiRuntimeFile(projectId, agentId, id, decoded);
    if (file === null)
      throw new HttpError(404, "not_found", "No such workbench, or no such file in its sdk/ui/.");
    const headers = {
      "content-type": MIME[path.extname(rel).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
      etag: file.etag,
    };
    if (etagMatches(c.req.header("if-none-match"), file.etag)) return c.body(null, 304, headers);
    return new Response(file.body, { status: 200, headers });
  });

  // The install manifest is served by the auth-less gate mounted ahead of this one
  // (`WorkbenchManifestModule.routes`, the `manifestRoutes` sub-app above) — the browser
  // fetching a manifest for install carries no session for another host than the page's.

  // The same files for every workbench, but only under one that exists: a page of another
  // Project, or of a workbench since removed, gets the 404 its own files would, and one that
  // is turned off the 409 its own files would.
  app.get("/:id/sdk/:file", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const name = c.req.param("file");
    const missing = () =>
      new HttpError(404, "not_found", "No such workbench, or no such file in its sdk/.");
    if (!isPageSdkName(name)) throw missing();
    const workbench = (await deps.workbenches.list(projectId, agentId)).find((w) => w.id === id);
    if (workbench === undefined) throw missing();
    if (workbench.enabled === false || !(await deps.workbenches.agentEnabled(projectId, agentId)))
      throw new WorkbenchDisabled(id);
    const { body, etag } = await pageSdkFile(name);
    const headers = { "content-type": PAGE_SDK_CONTENT_TYPE, "cache-control": "no-cache", etag };
    if (etagMatches(c.req.header("if-none-match"), etag)) return c.body(null, 304, headers);
    return c.body(body, 200, headers);
  });

  app.all("/:id/api/*", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const sub = c.req.path.split(`/workbenches/${id}/api`)[1] ?? "/";
    const request: WorkbenchRequest = {
      method: c.req.method,
      path: sub === "" ? "/" : sub,
      query: c.req.query(),
      headers: forwardedHeaders(c.req.raw.headers),
      body: null,
    };
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const declared = Number(c.req.header("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
      const bytes = await readCapped(c.req.raw.body);
      // JSON stays what it always was — parsed, and `null` when it does not parse. Anything
      // else reaches the handler as the bytes that were sent.
      if (isJson(c.req.header("content-type"))) request.body = parseJson(bytes);
      else if (bytes.byteLength > 0) request.bytes = bytes;
    }
    const response = await deps.workbenches
      .dispatch(projectId, agentId, id, request)
      .catch(notFound);
    return respond(response);
  });

  return app;
}

export interface AppCenterRouteDeps extends Pick<WorkbenchRouteDeps, "access" | "workbenches"> {
  /** Where each viewer's arrangement is kept: their ui_prefs. */
  prefs: UiPrefsStore;
  projects: Pick<Projects, "findById">;
}

/**
 * The Project's App Center: the shortcut list and the viewer's arrangement of it (mounted at
 * /api/projects/:projectId/app-center). Arranging is anyone's who may open it, since it changes
 * only what they see.
 */
export function appCenterRoutes(deps: AppCenterRouteDeps) {
  const app = new Hono<AppEnv>();
  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const { userId } = c.var.user;
    deps.access.requireProjectAccess(userId, projectId);
    return c.json({
      shortcuts: await deps.workbenches.appCenter(projectId),
      layout: readAppCenterLayout(deps.prefs, userId, projectId),
    } satisfies AppCenterResponse);
  });
  app.put("/layout", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const { userId } = c.var.user;
    deps.access.requireProjectAccess(userId, projectId);
    const body = await readJson(c);
    if (body.layout === undefined)
      throw badRequest("Request body must name layout (null restores the server's order).");
    const layout = body.layout === null ? null : parseAppCenterLayout(body.layout);
    const exists = (id: string) => deps.projects.findById(id) !== null;
    writeAppCenterLayout(deps.prefs, userId, projectId, layout, exists);
    return c.json({ layout } satisfies AppCenterLayoutResponse);
  });
  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "WorkbenchManifestModule.routes",
        prefix: "/api/projects/:projectId/agents/:agentId/workbenches",
        auth: "none",
        order: 19,
      },
      {
        id: "WorkbenchesModule.routes",
        prefix: "/api/projects/:projectId/agents/:agentId/workbenches",
        auth: "user",
        order: 20,
      },
      {
        id: "WorkbenchesModule.appCenterRoutes",
        prefix: "/api/projects/:projectId/app-center",
        auth: "user",
        order: 20,
      },
    ],
  },
})
export class WorkbenchRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly workbenches!: Workbenches;
  @Use() private readonly paths!: Paths;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly prefs!: UiPrefsStore;
  @Use() private readonly projects!: Projects;
  @Use() private readonly machines!: Machines;
  @Bind("WorkbenchesModule.routes") routes!: Hono<AppEnv>;
  @Bind("WorkbenchesModule.appCenterRoutes") appCenterRoutes!: Hono<AppEnv>;
  /** The manifest on its own auth-less gate, ahead of the session gate — see manifestRoutes. */
  @Bind("WorkbenchManifestModule.routes") manifestRoutes!: Hono<AppEnv>;
  setup() {
    this.routes = workbenchRoutes({
      access: this.access,
      workbenches: this.workbenches,
      root: this.paths.root,
      agentConfig: this.agentConfig,
    });
    this.appCenterRoutes = appCenterRoutes({
      access: this.access,
      workbenches: this.workbenches,
      prefs: this.prefs,
      projects: this.projects,
    });
    // The manifest answers without a session (see manifestRoutes): it reads only the
    // workbench's own registration — its name, version, tabs and icon — nothing per-user.
    // A remote machine's manifest rides the same forward the machine proxy uses: this
    // server's admin session, minted over its ssh access to that machine.
    this.manifestRoutes = manifestRoutes(
      this.workbenches,
      (projectId, agentId, machineId, id, tabKey) =>
        manifestThroughMachine({
          machines: this.machines,
          projectId,
          agentId,
          machineId,
          id,
          tabKey,
        }),
    );
  }
}
