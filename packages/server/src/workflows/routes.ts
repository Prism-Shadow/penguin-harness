/**
 * Agent-scoped workflow routes, mounted at /api/projects/:projectId/agents/:agentId/workflows:
 *
 *   GET    /                       the Agent's workflows (loads any that changed on disk)
 *   POST   /:id/reload             re-import the folder now (the watcher does this on change too)
 *   GET    /:id/history            recorded versions, newest first
 *   POST   /:id/rollback {revision} restore that version's files and reload
 *   DELETE /:id                    remove the folder and its recorded versions
 *   GET    /:id/ui/*               a file of the workflow's `ui/` (the pages its tabs name)
 *   *      /:id/api/*              handed to the workflow's WorkflowMain.handle: JSON by default, any
 *                                  content type when the handler names one (see respond)
 *
 * Every route requires access to the Project; the UI and api routes are what the
 * workflow's own page (an iframe in the Web App, same-origin cookie auth) talks to.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { requireValidId } from "../http/validate.js";
import type { Access } from "../mechanisms/projects.js";
import type { WorkflowRequest, WorkflowResponse, Workflows } from "../mechanisms/workflows.js";
import { WorkflowNotFound } from "./service.js";

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

/** The largest request body a workflow's handler is handed. */
const MAX_BODY_BYTES = 50 * 1024 * 1024;
/** Never shown to a workflow: they are the app's credentials, not the workflow's. */
const WITHHELD_REQUEST_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);
/** Never taken from a workflow: the app's cookies, and what the transport decides for itself. */
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
    `A workflow request body is at most ${MAX_BODY_BYTES} bytes`,
  );

const isJson = (contentType: string | undefined): boolean =>
  contentType === undefined || /^application\/([\w.-]+\+)?json\b/i.test(contentType.trim());

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
 * download, a redirect — and `stream` sends it as it is produced. The same origin already serves the workflow's `ui/` files as
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

function respond(response: WorkflowResponse): Response {
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

export interface WorkflowRouteDeps {
  access: Access;
  workflows: Workflows;
}

export function workflowRoutes(deps: WorkflowRouteDeps): Hono<AppEnv> {
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
  const notFound = (err: unknown): never => {
    if (err instanceof WorkflowNotFound) throw new HttpError(404, "not_found", err.message);
    throw err;
  };

  app.get("/", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json({ workflows: await deps.workflows.list(projectId, agentId) });
  });

  app.post("/:id/reload", async (c) => {
    const { projectId, agentId } = scope(c);
    const workflow = await deps.workflows
      .reload(projectId, agentId, c.req.param("id"))
      .catch(notFound);
    return c.json({ workflow });
  });

  app.get("/:id/history", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json({
      versions: await deps.workflows.history(projectId, agentId, c.req.param("id")),
    });
  });

  app.post("/:id/rollback", async (c) => {
    const { projectId, agentId } = scope(c);
    const body = (await c.req.json().catch(() => ({}))) as { revision?: unknown };
    if (typeof body.revision !== "string")
      throw new HttpError(400, "bad_request", "revision is required");
    const workflow = await deps.workflows
      .rollback(projectId, agentId, c.req.param("id"), body.revision)
      .catch(notFound);
    return c.json({ workflow });
  });

  app.delete("/:id", async (c) => {
    const { projectId, agentId } = scope(c);
    await deps.workflows.remove(projectId, agentId, c.req.param("id")).catch(notFound);
    return c.body(null, 204);
  });

  app.get("/:id/ui/*", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const rel = c.req.path.split(`/workflows/${id}/ui/`)[1] ?? "";
    const file = await deps.workflows.uiFile(projectId, agentId, id, decodeURIComponent(rel));
    if (file === null) throw new HttpError(404, "not_found", "No such file in the workflow's ui/.");
    const body = await fs.readFile(file);
    return c.body(body, 200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
  });

  app.all("/:id/api/*", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const sub = c.req.path.split(`/workflows/${id}/api`)[1] ?? "/";
    const request: WorkflowRequest = {
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
    const response = await deps.workflows.dispatch(projectId, agentId, id, request).catch(notFound);
    return respond(response);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "WorkflowsModule.routes",
        prefix: "/api/projects/:projectId/agents/:agentId/workflows",
        auth: "user",
        order: 20,
      },
    ],
  },
})
export class WorkflowRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly workflows!: Workflows;
  @Bind("WorkflowsModule.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = workflowRoutes({ access: this.access, workflows: this.workflows });
  }
}
