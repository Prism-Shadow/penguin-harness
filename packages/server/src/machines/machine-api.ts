/**
 * A client for one machine's own API, dialled through the connection this side holds. Every piece
 * of work this server does ON a machine goes through here — the hot update, the model sync.
 *
 * node:http rather than fetch: the Host header has to be the canonical app host
 * (`localhost:<port>`) while the connection goes to 127.0.0.1, and fetch ignores an explicit
 * host header. On a loopback bind the App answers on ONE loopback name and serves previews
 * on the other (app.ts's canonical-host guard), so a request addressed to `127.0.0.1` is
 * refused as a preview-host call to /api.
 */
import http from "node:http";

/** The machine's own API, reached through its tunnel as an authenticated caller. */
export interface MachineApi {
  request(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }>;
  /**
   * A POST whose body is bytes rather than JSON, with a deadline of its own. The hot update
   * is megabytes, and the machine unpacks, boots and commits it before answering — a timeout
   * sized for a settings write would call a working upgrade dead halfway through.
   */
  postBytes(
    path: string,
    contentType: string,
    body: Buffer,
    timeoutMs: number,
  ): Promise<{ status: number; text: string }>;
}

/** One client per (machine, session): `agent` dials the machine's server through its session, `port` is the server's port over there. */
export function machineApi(agent: http.Agent, port: number, cookie: string): MachineApi {
  /** One request, answered whole — so both shapes agree on Host, cookie and what a failure is. */
  const send = (
    method: string,
    path: string,
    payload: Buffer | null,
    contentType: string,
    timeoutMs: number,
  ): Promise<{ status: number; text: string }> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          agent,
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            host: `localhost:${port}`,
            cookie,
            ...(payload === null
              ? {}
              : { "content-type": contentType, "content-length": String(payload.length) }),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("the machine's server did not answer in time"));
      });
      req.on("error", reject);
      if (payload === null) req.end();
      else req.end(payload);
    });

  return {
    request: (method, path, body) =>
      send(
        method,
        path,
        body === undefined ? null : Buffer.from(JSON.stringify(body)),
        "application/json",
        30_000,
      ),
    postBytes: (path, contentType, body, timeoutMs) =>
      send("POST", path, body, contentType, timeoutMs),
  };
}
