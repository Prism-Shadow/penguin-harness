/**
 * Theme packs (PRFC-0026 「路由」), per server: an admin imports, every signed-in account lists,
 * loads and exports.
 *
 *   GET    /api/themes                  the imported packs (ThemePacksResponse)
 *   GET    /api/themes/:id/files/<path> one file the pack's installed.json lists, else 404
 *   POST   /api/themes[?replace=1]      admin: the raw zip (`application/octet-stream`, the API's
 *                                       upload type: an HTML form cannot send it) → 201
 *   DELETE /api/themes/:id              admin → 204
 *   GET    /api/themes/:id/export       any pack, built-in or imported, as a zip attachment
 *
 * A served file is an image or a stylesheet to every page that loads it, and inert anywhere else:
 * `nosniff` holds it to its declared type, and opened on its own in a tab it is a sandboxed
 * document that runs and loads nothing. Its URL carries the pack's version (`?v=`), so it is
 * cached for good and a replaced pack is a new URL.
 *
 * Every write tells every signed-in tab (`themes_changed`), which reads the list again.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { THEME_PACK_LIMITS, ThemePackError } from "@prismshadow/penguin-theme-pack";
import type { ServerEvent, ThemePackImportResponse, ThemePacksResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { Channels, Clock, Config, Hmr, Paths } from "../../hmr/capabilities.js";
import { ThemeStore } from "../../services/theme-store.js";
import { HttpError } from "../errors.js";

export interface ThemeRouteDeps {
  store: ThemeStore;
  /** Tells every signed-in tab that the list changed. */
  announce: () => void;
}

/** Every served file's headers, beside its type. */
export const THEME_FILE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=31536000, immutable",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
};

function requireAdmin(c: Context<AppEnv>): void {
  if (!c.var.user.isAdmin) {
    throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
  }
}

const tooLarge = (reason: string) => new HttpError(413, "theme_too_large", reason);

/** The body, refused past the archive cap as soon as it is known to be: from its length, or as it streams. */
async function readZip(c: Context<AppEnv>): Promise<Uint8Array> {
  const cap = THEME_PACK_LIMITS.archiveBytes;
  const over = `The zip is over ${cap / 1024 / 1024} MiB.`;
  if (Number(c.req.header("content-length") ?? 0) > cap) throw tooLarge(over);
  const body = c.req.raw.body;
  if (body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      throw tooLarge(over);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** A refused pack as the API answers it: what was wrong, and where. */
function refusal(err: ThemePackError): HttpError {
  if (err.kind === "too_large") return tooLarge(err.message);
  if (err.kind === "api_unsupported") {
    return new HttpError(422, "theme_api_unsupported", err.problem.reason);
  }
  // ThemeInvalidDetails, as the string record every error's details are.
  const { file, reason, line, column } = err.problem;
  const details: Record<string, string> = { file, reason };
  if (line !== undefined) details.line = String(line);
  if (column !== undefined) details.column = String(column);
  return new HttpError(400, "theme_invalid", err.message, undefined, details);
}

export function themeRoutes(deps: ThemeRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) =>
    c.json({ themes: await deps.store.list() } satisfies ThemePacksResponse),
  );

  app.get("/:id/files/*", async (c) => {
    const id = c.req.param("id");
    const marker = `/${id}/files/`;
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.slice(c.req.path.indexOf(marker) + marker.length));
    } catch {
      rel = "";
    }
    const body = rel === "" ? null : await deps.store.served(id, rel);
    if (body === null) throw new HttpError(404, "not_found", "The pack serves no such file.");
    const type = CONTENT_TYPES[rel.slice(rel.lastIndexOf(".") + 1)] ?? "application/octet-stream";
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": type, ...THEME_FILE_HEADERS },
    });
  });

  app.post("/", async (c) => {
    requireAdmin(c);
    const zip = await readZip(c);
    const theme = await deps.store
      .install(zip, { replace: c.req.query("replace") === "1", by: c.var.user.userId })
      .catch((err: unknown) => {
        throw err instanceof ThemePackError ? refusal(err) : err;
      });
    deps.announce();
    return c.json({ theme } satisfies ThemePackImportResponse, 201);
  });

  app.delete("/:id", async (c) => {
    requireAdmin(c);
    await deps.store.remove(c.req.param("id"));
    deps.announce();
    return c.body(null, 204);
  });

  app.get("/:id/export", async (c) => {
    const { bytes, fileName } = await deps.store.exportArchive(c.req.param("id"));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "ThemeRoutes.routes",
        prefix: "/api/themes",
        auth: "user",
        order: 10,
      },
    ],
  },
})
export class ThemeRoutes {
  @Use() private readonly paths!: Paths;
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly channels!: Channels;
  @Use() private readonly clock!: Clock;
  @Bind("ThemeRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const store = new ThemeStore({
      root: this.paths.root,
      webFiles: () => this.hmr.resolveWebSource() ?? { kind: "dir", dir: this.config.webDist },
      now: () => this.clock.now(),
    });
    const changed: ServerEvent = { type: "themes_changed" };
    this.routes = themeRoutes({
      store,
      announce: () => this.channels.broadcast("user:", changed, "server_event"),
    });
  }
}
