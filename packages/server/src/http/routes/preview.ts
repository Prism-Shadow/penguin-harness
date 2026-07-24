/**
 * Workspace HTML preview served from a separate origin.
 *
 * `GET /preview/:token/*` sits outside `/api` and outside the auth middleware: the
 * preview origin never receives the session cookie, so the signed token in the path is
 * the only credential. Path-based (rather than the query-parameter `files/content`
 * endpoint) so a page's relative subresources — `app.js`, `style.css`, images — resolve
 * against the document and actually load.
 *
 * Because the boundary is now the origin itself, the response does NOT carry the CSP
 * sandbox: the page gets a normal origin with working storage and cookies, which is what
 * lets third-party embeds run. That only stays safe while the host check below holds —
 * this same process also answers on the App origin, and serving Agent-written HTML there
 * would be a same-origin XSS with full API access.
 *
 * Design: design/specs/05-ARCHITECTURE.md § "Workspace 文件预览".
 */
import { Hono } from "hono";
import type { SessionsRepo } from "../../db/repos/sessions.js";
import type { WorkspaceFilesService } from "../../services/workspace-files-service.js";
import type { PreviewTokenSigner } from "../../services/preview-token.js";
import { hostOnly, requestAuthority } from "../../services/preview-token.js";

export interface PreviewDeps {
  sessionsRepo: SessionsRepo;
  workspaceFiles: WorkspaceFilesService;
  previewTokens: PreviewTokenSigner;
}

/** Directory-style requests resolve to index.html, matching ordinary static hosting. */
const DIRECTORY_INDEX = "index.html";

export function previewRoutes(deps: PreviewDeps) {
  const app = new Hono();

  app.get("/:token/*", async (c) => {
    const token = c.req.param("token");
    const payload = token ? deps.previewTokens.verify(token) : null;
    // A bad or expired token and a wrong host both answer 404 with no detail: this
    // endpoint is unauthenticated, so it should not confirm what exists.
    if (!payload) return c.text("Not found", 404);

    // The host binding is the load-bearing check — see the file header.
    const authority = requestAuthority(c.req.url, c.req.header("host"));
    if (hostOnly(authority).toLowerCase() !== payload.host.toLowerCase()) {
      return c.text("Not found", 404);
    }

    const row = deps.sessionsRepo.findById(payload.sessionId);
    if (!row) return c.text("Not found", 404);

    // Everything after `/preview/<token>/` is the Workspace-relative path; the service
    // re-resolves it against the Workspace and rejects `..` and symlink escapes.
    const prefix = `/preview/${token}/`;
    const raw = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    let rel: string;
    try {
      rel = decodeURIComponent(raw);
    } catch {
      return c.text("Not found", 404);
    }
    if (rel === "" || rel.endsWith("/")) rel += DIRECTORY_INDEX;

    let file;
    try {
      file = await deps.workspaceFiles.read(row.workspace, rel);
    } catch {
      return c.text("Not found", 404);
    }

    return new Response(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "X-Content-Type-Options": "nosniff",
        // Without this, third-party requests made by the page leak the token-bearing
        // URL through Referer — a risk that only exists because this origin exists to
        // let third-party embeds run.
        "Referrer-Policy": "no-referrer",
        // Previews are per-token and short-lived; never let a shared cache keep them.
        "Cache-Control": "no-store",
      },
    });
  });

  return app;
}
