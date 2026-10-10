/**
 * The Files panel's operations over one Workspace directory, registered for the two ways a
 * caller names that directory:
 *
 *   - a Session: `/api/sessions/:sessionId/files…`, on the Session's own Workspace (the route
 *     group in sessions.ts, which also keeps the two Session-only routes, the preview redirect
 *     and the batch existence check);
 *   - the directory itself: `/api/projects/:projectId/workspace-files…?workspace=<absolute
 *     path>`, for the places that have no Session yet — the new-chat draft's chosen Workspace
 *     and a sidebar Workspace group's "Browse files".
 *
 * Both run the same handlers over the same service, so the confinement of every path, the
 * inline hardening of untrusted content and the write preconditions cannot differ between
 * them; only where the Workspace comes from does. Addressing by directory asks for nothing a
 * caller could not already do: it takes Project access — the same access that lets the caller
 * create a Session in that directory and read and write it through the Session's routes — and
 * a directory that exists, checked as a Session's Workspace is checked when one is created.
 * The preview origin's tokens name a Session, so directory addressing has no preview redirect:
 * an HTML file there previews through the same-origin sandbox (`preview=1`).
 */
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { Access } from "../../mechanisms/projects.js";
import type { FileReveal, WorkspaceFiles } from "../../mechanisms/workspace.js";
import { MAX_UPLOAD_BYTES } from "../../services/workspace-files-service.js";
import { assertWorkspaceAllowed } from "../../services/workspace-guard.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalString,
  readJson,
  requireEnum,
  requireString,
  requireValidId,
} from "../validate.js";

/** What the file handlers reach. */
export interface WorkspaceFileRouteDeps {
  workspaceFiles: WorkspaceFiles;
  /** Whether this server was spawned by the desktop shell — half of the reveal route's gate. */
  desktopMode: boolean;
  /** Opens a Workspace file's directory in the machine's file manager (the reveal route). */
  fileReveal: FileReveal;
}

/** Resolves the Workspace a request is about, after authorizing the caller for it. */
export type WorkspaceResolver = (c: Context<AppEnv>) => string | Promise<string>;

/**
 * Registers the file handlers under `base` ("" or "/:sessionId/files"), reading the Workspace
 * through `resolve` on every request.
 */
export function registerWorkspaceFileRoutes(
  app: Hono<AppEnv>,
  base: string,
  deps: WorkspaceFileRouteDeps,
  resolve: WorkspaceResolver,
): void {
  const at = (suffix: string): string => `${base}${suffix}` || "/";

  app.get(at(""), async (c) => {
    const workspace = await resolve(c);
    return c.json(await deps.workspaceFiles.list(workspace, c.req.query("path") ?? ""));
  });

  app.get(at("/content"), async (c) => {
    const workspace = await resolve(c);
    const rel = c.req.query("path") ?? "";
    const download = c.req.query("download") === "1";
    // Sandboxed top-level preview ("open in a new tab" for html): the document keeps its REAL
    // content type but carries a CSP sandbox WITHOUT allow-same-origin — it renders and runs
    // fully in an opaque origin, so agent-generated markup cannot reach this origin's cookies
    // or API. The request itself still authenticates (top-level GET sends the Lax cookie).
    const preview = !download && c.req.query("preview") === "1";
    const { data, fileName, contentType, scriptable, version } = await deps.workspaceFiles.read(
      workspace,
      rel,
    );
    const disposition = download ? "attachment" : "inline";
    // Same-origin XSS defense: an inline HTML preview is always returned as plain text
    // (Workspace files may be Agent-generated and untrusted); downloads (attachment) keep
    // the real content type, and sandboxed previews keep it under the CSP above. Paired
    // with nosniff to prevent MIME sniffing from undoing this.
    // An SVG is a document AND an image. Downgrading it to text/plain made every <img> in a
    // Markdown preview (and every .svg preview) a broken image, so it keeps its real type —
    // an image never runs the SVG's scripts. What the type does re-open is a DIRECT
    // navigation to this URL, where the browser would render it as a same-origin document:
    // the sandbox CSP closes that (no allow-scripts, no allow-same-origin — opaque origin,
    // no script execution), and CSP sandbox is ignored for a subresource, so the <img> path
    // is unaffected.
    const inertSvg = !download && !preview && scriptable === "svg";
    const effectiveType =
      !download && scriptable === "html" && !preview ? "text/plain; charset=utf-8" : contentType;
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": effectiveType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        // A Workspace file is whatever the Agent last wrote to that path. Letting a browser
        // cache it by URL is how a re-read after a settled turn paints the previous version.
        "Cache-Control": "no-store",
        // Not a cache validator — no-store above means nothing ever revalidates. It is the
        // version of the bytes in this response, which the Files panel's editor hands back
        // as `ifVersion` on save so the write can refuse to overwrite a newer file.
        ETag: version,
        ...(preview && scriptable
          ? {
              "Content-Security-Policy":
                "sandbox allow-scripts allow-popups allow-modals allow-forms",
            }
          : {}),
        ...(inertSvg ? { "Content-Security-Policy": "sandbox" } : {}),
      },
    });
  });

  /**
   * Writes one file whole. The editor's write precondition rides in `ifVersion` (see
   * FilesWriteRequest); an upload reads no version and so writes unconditionally. The version
   * the write produced comes back in `ETag`, which is what lets the editor keep editing after
   * a save: it is the marker the next save of the same file carries.
   */
  app.put(at("/content"), async (c) => {
    const workspace = await resolve(c);
    const rel = c.req.query("path") ?? "";
    const body = await readJson(c);
    if (typeof body.dataBase64 !== "string") {
      throw badRequest("dataBase64 must be a base64 string.");
    }
    const data = Buffer.from(body.dataBase64, "base64");
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "file_too_large", "Uploaded file exceeds the 14MB limit.");
    }
    const version = await deps.workspaceFiles.write(
      workspace,
      rel,
      data,
      optionalString(body, "ifVersion"),
    );
    return c.body(null, 204, { ETag: version });
  });

  /**
   * Delete one Workspace file. `ifVersion` is the same write precondition the PUT carries,
   * here as a query parameter: absent, the delete is unconditional; present and stale, it is
   * 409 `file_changed` with the file left alone.
   */
  app.delete(at("/content"), async (c) => {
    const workspace = await resolve(c);
    await deps.workspaceFiles.remove(
      workspace,
      c.req.query("path") ?? "",
      c.req.query("ifVersion"),
    );
    return c.body(null, 204);
  });

  /**
   * Create one empty text file or one folder (the Files panel's New menu). Anything already at
   * the path is 409 `target_exists` with nothing written — see FilesCreateRequest.
   */
  app.post(at("/create"), async (c) => {
    const workspace = await resolve(c);
    const body = await readJson(c);
    await deps.workspaceFiles.create(
      workspace,
      requireString(body, "path"),
      requireEnum(body, "kind", ["file", "dir"] as const),
    );
    return c.body(null, 204);
  });

  /**
   * Move or rename one file or folder (the Files panel's context menu). A file carries its
   * version precondition, a folder none; an occupied destination is refused with 409
   * `target_exists` rather than overwritten — see FilesMoveRequest.
   */
  app.post(at("/move"), async (c) => {
    const workspace = await resolve(c);
    const body = await readJson(c);
    await deps.workspaceFiles.move(
      workspace,
      requireString(body, "from"),
      requireString(body, "to"),
      optionalString(body, "ifVersion"),
    );
    return c.body(null, 204);
  });

  /**
   * Search the whole Workspace by entry name. Breadth-first from the root, so a capped result
   * is the shallowest matches rather than an arbitrary prefix of the walk; `truncated` says a
   * cap was reached.
   */
  app.get(at("/search"), async (c) => {
    const workspace = await resolve(c);
    return c.json(await deps.workspaceFiles.search(workspace, c.req.query("q") ?? ""));
  });

  /**
   * Shows a Workspace file in the machine's own file manager.
   *
   * Gated on the same two fields the desktop routes use, and for the same reason: outside
   * desktop mode there is no window on this machine to open anything beside, and inside it a
   * browser session is refused because the server cannot tell one signed in from this machine
   * from one signed in from another — a folder springing open on the server's machine means
   * nothing to a user who is somewhere else.
   *
   * The path is resolved the way a read resolves it (`..` and symlink escapes refused, a
   * missing path a 404) before it is handed to the OS, and the answer comes back as soon as
   * the file manager has started: nothing here waits for the window to be closed.
   */
  app.post(at("/reveal"), async (c) => {
    const workspace = await resolve(c);
    const rel = c.req.query("path") ?? "";
    if (!deps.desktopMode) throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
    if (c.var.sessionVia !== "desktop") {
      throw new HttpError(
        403,
        "desktop_shell_only",
        "Showing a file in its folder is available from the desktop app's own window.",
      );
    }
    const file = await deps.workspaceFiles.resolvePath(workspace, rel);
    try {
      await deps.fileReveal.reveal(file);
    } catch (err) {
      throw new HttpError(
        502,
        "reveal_failed",
        err instanceof Error ? err.message : "The file manager could not be opened.",
      );
    }
    return c.body(null, 204);
  });
}

/** What the directory-addressed group reaches beyond the handlers. */
export interface WorkspaceFilesRouteDeps extends WorkspaceFileRouteDeps {
  access: Access;
}

/**
 * `/api/projects/:projectId/workspace-files…?workspace=`: the file handlers over a directory
 * named by its absolute path, for a caller with access to the Project. The directory is
 * realpath'd and must exist (400 `workspace_not_found`), exactly as a Session's Workspace is
 * checked when a Session is created in it; everything below it is confined as for a Session.
 */
export function workspaceFilesRoutes(deps: WorkspaceFilesRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  registerWorkspaceFileRoutes(app, "", deps, async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const workspace = c.req.query("workspace")?.trim() ?? "";
    if (!path.isAbsolute(workspace)) {
      throw new HttpError(400, "workspace_not_found", "workspace must be an absolute path.");
    }
    return await assertWorkspaceAllowed({ workspace });
  });
  return app;
}
