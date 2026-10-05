/**
 * The one path of the machine proxy reached without this server's session: a provider's
 * redirect back into a key-minting flow opened on a machine.
 */
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import type { MachineEventHub } from "./event-hub.js";
import type { MachineSockets } from "./machine-sockets.js";
import { machinesProxy } from "./proxy.js";
import type { MachinesService } from "./service.js";

/** A Project id as a path carries it: what `requireValidId` accepts over there, checked here first. */
const CALLBACK_PROJECT_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * `GET /server/<machineId>/api/projects/<projectId>/model-oauth/callback` — the provider's
 * redirect back into a key-minting flow opened on a machine, forwarded WITHOUT a session here.
 *
 * The flow's callback names this server's origin under the machine's prefix (the forwarded
 * headers the proxy adds, machines/proxy.ts), so this is where the provider sends the browser.
 * It cannot require this server's session for the same reason the machine's own callback does
 * not (http/routes/model-oauth.ts): on the desktop the redirect lands in the system browser,
 * which holds no cookie for this origin. And it buys no more here than there — the machine's
 * route only deposits the code on the flow, and the exchange runs under the owner's own poll,
 * which goes through the authenticated proxy like every other call.
 *
 * Exactly this literal path, GET only, forwarded as a bare request: none of the caller's
 * headers, no body, nothing streamed. The machine sees the proxy's session, which is what lets
 * the forward through its own gate; the route it reaches ignores who is asking.
 */
export function machinesOAuthCallbackRoutes(
  machines: Pick<MachinesService, "proxyTarget" | "noteApiSeen">,
  shared: { sockets?: MachineSockets; events?: MachineEventHub; trustProxy?: boolean } = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const proxy = machinesProxy(
    (machineId) => machines.proxyTarget(machineId),
    (machineId, outcome) => machines.noteApiSeen(machineId, outcome),
    (line) => console.log(line),
    shared,
  );
  app.get("/", async (c) => {
    // Hono re-dispatches a HEAD as a GET; forwarded, the machine would refuse it anyway, but it
    // is refused here without a dial.
    if (c.req.method === "HEAD") return c.body(null, 405);
    const projectId = c.req.param("projectId") ?? "";
    if (!CALLBACK_PROJECT_RE.test(projectId)) return c.notFound();
    const url = new URL(c.req.url);
    const bare = new Request(url, { method: "GET", signal: c.req.raw.signal });
    const answer = await proxy(bare);
    return answer ?? c.notFound();
  });
  return app;
}
