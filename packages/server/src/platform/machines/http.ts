/**
 * The machines API, served through the platform's HTTP seam — these routes exist only as
 * long as this bundle is the booted platform, which is the point: the whole surface ships
 * and changes by hot push (see ../../hmr/README.md, "the route table is not a runtime
 * asset").
 *
 * The seam offers requests BEFORE the runtime's auth middleware, so this file does its own
 * gate: the request's cookies are exchanged for an identity by calling the server's OWN
 * `/api/me` over loopback — the platform runs in the server process, and the sessions it
 * must honor are the server's, so asking the server is both the simplest and the only
 * non-duplicating way to check. The port comes from the server's lock file, never from the
 * request's Host header: Host is caller-controlled, and following it would let a local
 * process point the check at a listener of its own.
 *
 * Who may use it: an ADMIN session — or anyone on the loopback when this is the desktop
 * app's embedded server (`desktopMode`). The machines block lives on the LOGIN page, where
 * no session exists yet; on a personal desktop the human at the keyboard IS the owner, and
 * the server already binds loopback only. A multi-user server keeps the admin gate: its
 * login page simply shows no machine list, because connecting spawns ssh with the server
 * account's keys and installs software — an owner's capability, not a visitor's.
 *
 * Every POST additionally requires `content-type: application/json`. The desktop-mode
 * exemption would otherwise be CSRF-reachable: any website can fire a form or text/plain
 * fetch at http://localhost:7376 with a JSON-shaped body, and the seam runs before the
 * runtime's jsonOnlyWrites middleware — so the rule is enforced here. A cross-origin fetch
 * carrying this content type triggers a preflight, which no server here answers for.
 */
import http from "node:http";
import { readServerLock } from "../../lock.js";
import type { MachinesService } from "./service.js";

const PREFIX = "/api/machines";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * True when the cookies name a live admin session, asked of the server itself.
 *
 * node:http, connected to 127.0.0.1 with the Host header forced to `localhost`, and not
 * `fetch("http://localhost:…")`: the name may resolve to ::1 first, and on a machine
 * running several penguin servers a DIFFERENT one can hold that family's listener — the
 * check would then be answered by a server that never issued this session. 127.0.0.1 is
 * the address this server's own lock liveness is probed on, so it is this server; the
 * Host override is needed because the API answers only under the canonical app host
 * (127.0.0.1 itself is the preview surface), and fetch/undici ignores an explicit
 * `headers.host` while node:http honors it.
 */
function isAdminRequest(request: Request, dataRoot: string): Promise<boolean> {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return Promise.resolve(false);
  const lock = readServerLock(dataRoot);
  if (lock === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: lock.port,
        path: "/api/me",
        method: "GET",
        headers: { host: `localhost:${lock.port}`, cookie },
        timeout: 3000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += String(chunk);
        });
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve(false);
          try {
            const parsed = JSON.parse(body) as { user?: { isAdmin?: boolean } };
            resolve(parsed.user?.isAdmin === true);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

/**
 * The seam handler for `/api/machines*`; answers null for everything else so the request
 * falls through to the runtime's own routes.
 *
 * - `GET  /api/machines` → `{ machines, job }` — the host list (with live-tunnel origins)
 *   and the state of the running or last connect job. The web polls this while connecting.
 * - `POST /api/machines/connect` `{ id, allowRestart? }` → 202, or 409 while one runs.
 */
export function machinesHttp(
  service: MachinesService,
  dataRoot: string,
  opts: { desktopMode: boolean },
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;

    if (!opts.desktopMode && !(await isAdminRequest(request, dataRoot))) {
      return json(403, { error: { code: "admin_only", message: "Admin session required." } });
    }

    if (request.method === "GET" && url.pathname === PREFIX) {
      return json(200, { machines: await service.list(), ...service.state() });
    }

    if (request.method === "POST" && url.pathname === `${PREFIX}/connect`) {
      // The CSRF gate (see the module doc): a browser can send this cross-origin only
      // with a content type that forces a preflight.
      const contentType = request.headers.get("content-type") ?? "";
      if (!/^application\/json\b/i.test(contentType.trim())) {
        return json(415, {
          error: { code: "json_only", message: "content-type: application/json required." },
        });
      }
      let body: { id?: unknown; allowRestart?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json(400, { error: { code: "bad_request", message: "JSON body required." } });
      }
      if (typeof body.id !== "string" || body.id === "") {
        return json(400, { error: { code: "bad_request", message: "id required." } });
      }
      const started = service.startConnect(body.id, {
        allowRestart: body.allowRestart === true,
      });
      if (!started.ok) {
        return json(409, { error: { code: "busy", message: started.message ?? "busy" } });
      }
      return json(202, { started: true });
    }

    return json(405, { error: { code: "method_not_allowed", message: "Not supported." } });
  };
}
