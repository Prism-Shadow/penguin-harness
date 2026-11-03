/**
 * The SDK's transport for the API tab's Try it: AMSP's paths, answered by the Web App's own routes
 * with the owner's sign-in in place of a key.
 *
 * - `/agents/<projectId>/<agentId>/runs` is the try route, `/api/projects/<p>/agents/<a>/api/try`:
 *   the runs route's handler for a signed-in owner;
 * - every `/sessions/<id>/…` path (the approvals resource and its answers, abort) is the cookie
 *   door's `/api/sessions/<id>/…`, the same handlers the key door serves.
 *
 * Requests go through the Web App's client, so they reach the machine the Agent lives on, and
 * its refusals come back as the SDK's `AmspHttpError`, which the client's approval loop and the
 * panel read. The stream is read with the SDK's own reader.
 */
import { AmspHttpError, deliver, readAmsp } from "@prismshadow/amsp";
import type { StreamEnd, StreamRequest, Transport, TransportResponse } from "@prismshadow/amsp";
import { ApiError, apiFetchStream } from "../../api/client";

/** The Web App's path for an AMSP path. */
export function tryPath(amspPath: string): string {
  const runs = /^\/agents\/([^/]+)\/([^/]+)\/runs$/.exec(amspPath);
  if (runs) return `/api/projects/${runs[1]}/agents/${runs[2]}/api/try`;
  return `/api${amspPath}`;
}

/** The SDK's error for the Web App client's. */
function asAmsp(err: unknown): unknown {
  return err instanceof ApiError ? new AmspHttpError(err.status, err.code, err.message) : err;
}

async function json<T>(res: Response): Promise<TransportResponse<T>> {
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : (JSON.parse(text) as T) };
}

/** A transport to the Agent's server: this one (`machineId` null) or a machine's. */
export function tryTransport(machineId: string | null): Transport {
  const send = async (
    method: "GET" | "POST",
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> => {
    try {
      return await apiFetchStream(tryPath(path), {
        method,
        server: machineId,
        // Writes are JSON, as the server's CSRF guard wants them.
        ...(method === "POST" ? { body: body ?? {} } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      throw asAmsp(err);
    }
  };
  return {
    async stream(path: string, req: StreamRequest): Promise<StreamEnd> {
      const res = await send(req.method ?? "POST", path, req.body, req.signal);
      return await deliver(readAmsp(res.body!, req.signal), req);
    },
    async get<T>(path: string, opts: { signal?: AbortSignal } = {}) {
      return await json<T>(await send("GET", path, undefined, opts.signal));
    },
    async post<T>(path: string, body?: unknown, opts: { signal?: AbortSignal } = {}) {
      return await json<T>(await send("POST", path, body, opts.signal));
    },
  };
}
