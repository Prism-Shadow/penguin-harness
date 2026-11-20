/**
 * This plugin's HTTP routes, mounted by the host at `/api/projects/:projectId/multimodal-tools`
 * behind its sign-in (`HttpModule.routes`). For the Web App: dictation, read-aloud and the
 * Session's generated files. Any member of the Project uses them; only an owner changes the
 * transcript-editing settings.
 *
 *   POST   /:operation/run                    run an operation (200 when done, 202 with `detach`)
 *   GET    /runs/:runId?sessionId=            a run in flight, or stored in the Session
 *   DELETE /runs/:runId                       stop a run in flight
 *   GET    /sessions/:sessionId/runs          the Session's runs, newest first (Image Studio)
 *   GET    /sessions/:sessionId/files         the files the Session's runs generated
 *   GET    /sessions/:sessionId/files/:name   one of them, streamed
 *   GET    /voice-polish/settings             transcript editing in this Project
 *   PATCH  /voice-polish/settings             { enabled?, prompt? } (owner)
 *   POST   /voice-polish                      { text, sessionId? } → { text, model }
 *
 * A body is JSON; a file in it is `{ data: <base64>, mimeType }`, counted against the host's body
 * cap. A refusal answers `{ error: { code, message } }`, as the host's own routes do.
 */
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { badInput, errorFields, ToolError } from "./errors.js";
import type { ProjectAccess, SessionLookup } from "./host.js";
import { extensionOf } from "./media.js";
import {
  isOperation,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
  type OperationInput,
} from "./operations.js";
import { isFileName, isRunId } from "./store.js";
import type { Tools } from "./tools.js";

/** What the host's sign-in leaves on a request. */
export interface RouteEnv {
  Variables: { user: { userId: string; isAdmin: boolean } };
}

export interface RouteDeps {
  tools: () => Tools;
  access: ProjectAccess;
  sessions: SessionLookup;
}

type C = Context<RouteEnv>;

function projectOf(c: C, deps: RouteDeps): string {
  const projectId = c.req.param("projectId") ?? "";
  deps.access.requireProjectAccess(c.var.user.userId, projectId);
  return projectId;
}

/** A Session of the Project, or a 404; undefined when none is named. */
function sessionOf(deps: RouteDeps, projectId: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || deps.sessions.findById(value)?.projectId !== projectId) {
    throw new ToolError(404, "session_not_found", "Session does not exist in this Project.");
  }
  return value;
}

async function body(c: C): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw badInput("The body must be JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw badInput("The body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

function optionalString(b: Record<string, unknown>, key: string): string | undefined {
  const v = b[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw badInput(`${key} must be a string.`);
  return v;
}

function optionalNumber(b: Record<string, unknown>, key: string): number | undefined {
  const v = b[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number") throw badInput(`${key} must be a number.`);
  return v;
}

function file(b: Record<string, unknown>, key: "image" | "audio"): Attachment | undefined {
  const v = b[key];
  if (v === undefined) return undefined;
  const f = v as { data?: unknown; mimeType?: unknown } | null;
  if (
    f === null ||
    typeof f !== "object" ||
    typeof f.data !== "string" ||
    typeof f.mimeType !== "string"
  ) {
    throw badInput(`${key} must be { data: <base64>, mimeType }.`);
  }
  if (
    f.data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)
  ) {
    throw badInput(
      `${key}.data must be base64 of at most ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB.`,
    );
  }
  return { data: Buffer.from(f.data, "base64"), mimeType: f.mimeType };
}

function inputOf(b: Record<string, unknown>): OperationInput {
  const entries: [keyof OperationInput, unknown][] = [
    ["text", optionalString(b, "text")],
    ["url", optionalString(b, "url")],
    ["image", file(b, "image")],
    ["audio", file(b, "audio")],
    ["count", optionalNumber(b, "count")],
    ["voice", optionalString(b, "voice")],
    ["aspectRatio", optionalString(b, "aspectRatio")],
    ["resolution", optionalString(b, "resolution")],
    ["duration", optionalNumber(b, "duration")],
  ];
  return Object.fromEntries(entries.filter(([, v]) => v !== undefined)) as OperationInput;
}

export function toolRoutes(deps: RouteDeps): Hono<RouteEnv> {
  const app = new Hono<RouteEnv>();
  // The host mounts this app inside its own; its errors are answered here, in the host's shape.
  app.onError((err, c) => {
    const { status, code, message } = errorFields(err);
    if (status >= 500 && code === "internal") console.error("[multimodal-tools]", err);
    return c.json({ error: { code, message } }, status as 400);
  });

  app.post("/:operation/run", async (c) => {
    const projectId = projectOf(c, deps);
    const op = c.req.param("operation");
    if (!isOperation(op))
      throw new ToolError(404, "unknown_operation", `No operation named '${op.slice(0, 32)}'.`);
    const b = await body(c);
    const sessionId = sessionOf(deps, projectId, b.sessionId);
    const detach = b.detach === true;
    if (detach && sessionId === undefined)
      throw badInput("detach keeps the run in its Session: name a sessionId.");
    const { record, done } = await deps.tools().start(projectId, sessionId, op, inputOf(b));
    if (detach) return c.json(record, 202);
    const finished = await done;
    if (finished.record.status === "cancelled")
      throw new ToolError(409, "run_cancelled", "The run was cancelled.");
    if (finished.record.status === "failed") {
      throw new ToolError(502, "run_failed", finished.record.error ?? "The run failed.");
    }
    return c.json(finished.record);
  });

  app.get("/runs/:runId", async (c) => {
    const projectId = projectOf(c, deps);
    const runId = c.req.param("runId");
    const sessionId = sessionOf(deps, projectId, c.req.query("sessionId"));
    const record = isRunId(runId) ? await deps.tools().runs.get(projectId, runId, sessionId) : null;
    if (record === null) throw new ToolError(404, "run_not_found", "No such run.");
    return c.json(record);
  });

  app.delete("/runs/:runId", async (c) => {
    const projectId = projectOf(c, deps);
    const runId = c.req.param("runId");
    const record = isRunId(runId) ? await deps.tools().runs.cancel(projectId, runId) : null;
    if (record === null) throw new ToolError(404, "run_not_running", "No such run is in flight.");
    return c.json(record);
  });

  app.get("/sessions/:sessionId/runs", async (c) => {
    const projectId = projectOf(c, deps);
    const sessionId = sessionOf(deps, projectId, c.req.param("sessionId"))!;
    const tools = deps.tools();
    // A stored run still marked running is read through the runs in flight, which say whether
    // it still is.
    const runs = await Promise.all(
      (await tools.store.runs(projectId, sessionId)).map(async (run) =>
        run.status === "running"
          ? ((await tools.runs.get(projectId, run.id, sessionId)) ?? run)
          : run,
      ),
    );
    return c.json({ runs });
  });

  app.get("/sessions/:sessionId/files", async (c) => {
    const projectId = projectOf(c, deps);
    const sessionId = sessionOf(deps, projectId, c.req.param("sessionId"))!;
    return c.json({ files: await deps.tools().store.files(projectId, sessionId) });
  });

  app.get("/sessions/:sessionId/files/:name", async (c) => {
    const projectId = projectOf(c, deps);
    const sessionId = sessionOf(deps, projectId, c.req.param("sessionId"))!;
    const name = c.req.param("name");
    const tools = deps.tools();
    const listed = isFileName(name)
      ? (await tools.store.files(projectId, sessionId)).find((f) => f.name === name)
      : undefined;
    const opened =
      listed === undefined ? null : await tools.store.openFile(projectId, sessionId, name);
    if (listed === undefined || opened === null || extensionOf(listed.mimeType) === undefined) {
      throw new ToolError(404, "file_not_found", "No such file in this Session.");
    }
    return new Response(Readable.toWeb(opened.stream as Readable) as ReadableStream, {
      headers: {
        "Content-Type": listed.mimeType,
        "Content-Length": String(opened.bytes),
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  });

  app.get("/voice-polish/settings", async (c) => {
    const projectId = projectOf(c, deps);
    return c.json(await deps.tools().polish.view(projectId));
  });

  app.patch("/voice-polish/settings", async (c) => {
    const projectId = projectOf(c, deps);
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const b = await body(c);
    const enabled = b.enabled;
    if (enabled !== undefined && typeof enabled !== "boolean")
      throw badInput("enabled must be a boolean.");
    const prompt = b.prompt;
    if (prompt !== undefined && prompt !== null && typeof prompt !== "string")
      throw badInput("prompt must be a string or null.");
    return c.json(
      await deps.tools().polish.update(projectId, {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(prompt !== undefined ? { prompt: prompt as string | null } : {}),
      }),
    );
  });

  app.post("/voice-polish", async (c) => {
    const projectId = projectOf(c, deps);
    const b = await body(c);
    const sessionId = sessionOf(deps, projectId, b.sessionId);
    const text = optionalString(b, "text") ?? "";
    return c.json(await deps.tools().polish.run(projectId, sessionId, text, c.req.raw.signal));
  });

  return app;
}
