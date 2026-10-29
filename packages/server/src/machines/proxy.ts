/**
 * The same-origin server proxy: `/server/<machineId>/api/…` on THIS server forwards to that
 * machine's server through the forward held to it.
 *
 * Addressed by the machine's OWN id, not the ssh alias it was reached through: an alias is a
 * line in one config file, and renaming it would change every URL below. Only `/api/` paths
 * are forwarded — the frontend stays local and re-points its API calls by prefix.
 *
 * ONE IDENTITY. The caller is this server's admin, and this server's admin is that
 * machine's admin: the ssh access that installed the program there is what authorizes it,
 * and the session presented to the machine is one this server mints over that access
 * (remote-token.ts). The browser's own cookies never travel, and the machine's never come
 * back — so this mounts INSIDE this server's auth middleware, for admins.
 */
import http from "node:http";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { ADOPTED_AT_HEADER } from "../runtime/session-sources.js";
import { answerOf } from "../socket/stream-answer.js";
import { MachineAnswers, keepable, keptResponse } from "./answer-cache.js";
import type { AnswerReader, KeptAnswer } from "./answer-cache.js";
import { ASKED_ENCODINGS, decodableEncoding, decodedBody } from "./answer-decoding.js";
import type { MachineEventHub } from "./event-hub.js";
import { MachineSocketRelay } from "./socket-relay.js";
import type { MachineSockets } from "./machine-sockets.js";

/** Path prefix of the proxy: `/server/<id>/api/…`. */
export const SERVER_PROXY_PREFIX = "/server/";

/** Where a request to one machine goes, as the machines service answers it. */
export interface ProxyTarget {
  /** Dials the machine's server through the session held to it. */
  agent: http.Agent;
  /** Its server's port over there. */
  port: number;
  /** A session on that machine, as its own cookie. */
  cookie: string;
  /**
   * When this server adopted the machine, sent along as {@link ADOPTED_AT_HEADER} so the machine
   * reads the Sessions it held before then as CLI tasks; null for a machine adopted before the
   * time was recorded, which sends nothing.
   */
  adoptedAt: string | null;
  /**
   * The ssh session the agent dials through (its pid): a socket is only ever reused within
   * one (socket-relay.ts).
   */
  session: number;
}

/** A parsed proxy path: which machine, and the remote-side path to request. */
export interface ProxyPath {
  machineId: string;
  /** The path forwarded to the remote, always starting `/api/`. */
  remotePath: string;
}

/** Parses `/server/<machineId>/api/…` (query preserved by the caller); null for anything else. */
export function parseProxyPath(pathname: string): ProxyPath | null {
  if (!pathname.startsWith(SERVER_PROXY_PREFIX)) return null;
  const rest = pathname.slice(SERVER_PROXY_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const machineId = decodeURIComponent(rest.slice(0, slash));
  const remotePath = rest.slice(slash);
  if (!remotePath.startsWith("/api/") && remotePath !== "/api") return null;
  return { machineId, remotePath };
}

/** An absolute-path Location from the remote, re-rooted under the proxy prefix. */
export function rewriteLocation(header: string, machineId: string): string {
  return header.startsWith("/")
    ? `${SERVER_PROXY_PREFIX}${encodeURIComponent(machineId)}${header}`
    : header;
}

/**
 * Hop-by-hop and identity headers that must not cross.
 *
 * `authorization` among them: the proxy speaks to the machine as ITS admin, with a session
 * this server mints over ssh, and a caller's own bearer is a credential for THIS server. Sent
 * on, it would both hand that credential to another machine and outrank the cookie just
 * minted, since the remote's auth reads a bearer first. And the adoption time: it is this
 * server's word about the machine, set from its own record or not at all.
 */
const DROP_REQUEST_HEADERS = new Set([
  "host",
  "cookie",
  "authorization",
  // The browser's Origin names THIS server; the machine, addressed under a Host of its own,
  // would read it as another origin's and refuse every write. Where the request came from is
  // judged here, on the server the browser talks to (the write guard covers `/server/*`).
  "origin",
  "connection",
  "keep-alive",
  "upgrade",
  ADOPTED_AT_HEADER,
  // The caller's link is not this one: the encoding asked of the machine is this server's own
  // (answer-decoding.ts), and so is the validator (answer-cache.ts). What the caller holds is
  // answered here, by this server's own rule (http/json-validators.ts).
  "accept-encoding",
  "if-none-match",
  "if-modified-since",
]);
/**
 * `transfer-encoding` among them: it framed the hop from the machine, and a body relayed whole (a
 * kept answer, a decoded one) is framed anew by this server — sending both it and a length is a
 * malformed answer.
 */
const DROP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "location",
  "connection",
  "keep-alive",
  "transfer-encoding",
]);

/** What a forward the caller gave up on answers; nobody reads it, but a Response is owed. */
const cancelledResponse = (): Response =>
  Response.json(
    { error: { code: "cancelled", message: "The caller cancelled the request." } },
    { status: 499 },
  );

/** A GET this forward may answer from, or keep, a machine's last answer for (answer-cache.ts). */
interface KeptRead {
  answers: MachineAnswers;
  key: string;
  /** What was kept when the request left: a 304 is answered with this, whatever happens meanwhile. */
  kept: KeptAnswer | null;
}

/** What answers a forward whose answer broke off mid-body. */
const brokenOff = (machineId: string, err: unknown): Response =>
  Response.json(
    {
      error: {
        code: "server_unreachable",
        message: `The answer from ${machineId} broke off: ${err instanceof Error ? err.message : String(err)}`,
      },
    },
    { status: 502 },
  );

/**
 * The machine's answer as this server relays it: decoded (answer-decoding.ts), and for a read
 * this server keeps, answered from the kept body on a 304 and kept anew on a 200.
 */
async function relayAnswer(
  res: http.IncomingMessage,
  machineId: string,
  read: KeptRead | null,
): Promise<Response> {
  const status = res.statusCode ?? 502;
  if (status === 304 && read?.kept != null) {
    res.resume();
    return keptResponse(read.kept);
  }
  const out = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined || DROP_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    out.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  if (res.headers.location !== undefined) {
    out.set("location", rewriteLocation(res.headers.location, machineId));
  }
  if (decodableEncoding(res) !== null) {
    // These described the bytes that crossed, not the ones relayed.
    out.delete("content-encoding");
    out.delete("content-length");
  }
  if (status === 204 || status === 304) {
    res.resume();
    return new Response(null, { status, headers: out });
  }
  const body = decodedBody(res);
  if (read !== null && keepable(status, out)) {
    const bytes = new Uint8Array(await buffer(body));
    read.answers.keep(read.key, { etag: out.get("etag")!, headers: [...out], body: bytes });
    return new Response(bytes, { status, headers: out });
  }
  // Not one to keep (any longer): what was kept for it no longer describes it.
  if (read !== null) read.answers.drop(read.key);
  return new Response(Readable.toWeb(body) as ReadableStream, { status, headers: out });
}

/**
 * Forwards one request to the machine's server and streams the answer back — both
 * directions are pipes, so SSE and long downloads flow as they arrive. The socket is the
 * agent's: a dial through the machine's session (transport/connection.ts). node:http rather
 * than fetch: the Host header must be the canonical app host (`localhost:<port>`), and the
 * socket is not one fetch could be handed.
 *
 * Every request asks for a compressed answer (answer-decoding.ts). A GET from a known reader
 * also revalidates the answer kept for it, if any (answer-cache.ts).
 */
function proxyThroughSession(
  request: Request,
  path: ProxyPath,
  target: ProxyTarget,
  report?: ProxyReport,
  reader?: AnswerReader,
): Promise<Response> {
  const { agent, port, cookie } = target;
  // Given up on before it left: nothing to dial for.
  if (request.signal.aborted) return Promise.resolve(cancelledResponse());
  return new Promise((resolve) => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!DROP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    });
    headers["host"] = `localhost:${port}`;
    headers["cookie"] = cookie;
    if (target.adoptedAt !== null) headers[ADOPTED_AT_HEADER] = target.adoptedAt;
    headers["accept-encoding"] = ASKED_ENCODINGS;
    let read: KeptRead | null = null;
    if (request.method === "GET" && reader !== undefined) {
      const key = MachineAnswers.key(
        path.machineId,
        reader.readerId,
        `${path.remotePath}${url.search}`,
      );
      read = { answers: reader.answers, key, kept: reader.answers.get(key) };
      if (read.kept !== null) headers["if-none-match"] = read.kept.etag;
    }

    const upstream = http.request(
      {
        agent,
        host: "127.0.0.1",
        port,
        path: `${path.remotePath}${url.search}`,
        method: request.method,
        headers,
      },
      (res) => {
        report?.(path.machineId, { ok: true });
        relayAnswer(res, path.machineId, read).then(resolve, (err: unknown) =>
          resolve(cancelled ? cancelledResponse() : brokenOff(path.machineId, err)),
        );
      },
    );
    // The caller gave up (an API socket call cancelled at its answer timeout aborts its
    // Request, socket/serve.ts): drop the forward rather than hold it open until the machine
    // answers someone who is gone. That is the caller's doing, not the machine's, so it is
    // not reported as an unreachable machine.
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      upstream.destroy();
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    upstream.on("close", () => request.signal.removeEventListener("abort", cancel));
    upstream.on("error", (err) => {
      if (cancelled) {
        resolve(cancelledResponse());
        return;
      }
      report?.(path.machineId, { ok: false, detail: err.message });
      resolve(
        Response.json(
          {
            error: {
              code: "server_unreachable",
              message: `The connection to ${path.machineId} did not answer: ${err.message}`,
            },
          },
          { status: 502 },
        ),
      );
    });
    if (request.body !== null) {
      Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).pipe(upstream);
    } else {
      upstream.end();
    }
  });
}

/**
 * The seam handler: `/server/<id>/api/…` → that machine, or a clear answer when there is
 * nothing to forward to. `resolve` is the machines service's lookup: a dial through the
 * session, the port over there and a session cookie, or null when it is not connected.
 */
/**
 * Told what each forwarded request learned: the machine's API answered, or the forward had
 * nowhere to deliver. The machines service stamps it into the list's `api` fact — passive
 * measurement, riding traffic that flows anyway (api/types.ts on MachineInfo.api).
 */
export type ProxyReport = (
  machineId: string,
  outcome: { ok: true } | { ok: false; detail: string },
) => void;

export function machinesProxy(
  resolve: (machineId: string) => Promise<ProxyTarget | null>,
  report?: ProxyReport,
  log: (line: string) => void = () => undefined,
  /**
   * The shared socket cache and event hub, so this generation's routes read the facts the relay
   * writes; and the answers this generation keeps of its machines (answer-cache.ts).
   */
  shared: { sockets?: MachineSockets; events?: MachineEventHub; answers?: MachineAnswers } = {},
): (request: Request, caller?: { userId: string }) => Promise<Response | null> {
  const relay = new MachineSocketRelay(log, shared);
  const { answers } = shared;
  return async (request, caller) => {
    const url = new URL(request.url);
    const path = parseProxyPath(url.pathname);
    if (path === null) return null;
    const target = await resolve(path.machineId);
    if (target === null) {
      return Response.json(
        {
          error: {
            code: "not_connected",
            message: `No live forward to ${path.machineId}; connect to it first.`,
          },
        },
        { status: 503 },
      );
    }
    const reader =
      answers !== undefined && caller !== undefined
        ? { answers, readerId: caller.userId }
        : undefined;
    return forwardToMachine(request, path, target, relay, report, reader);
  };
}

/**
 * Forwards one request to a connected machine's server: a `/server/<machineId>/…` request, and
 * a Session-level request routed by its Session (session-forward.ts), take the same path.
 */
export async function forwardToMachine(
  request: Request,
  path: ProxyPath,
  target: ProxyTarget,
  relay: MachineSocketRelay,
  report?: ProxyReport,
  /** Who asks, for a read whose last answer this server keeps (answer-cache.ts); none keeps nothing. */
  reader?: AnswerReader,
): Promise<Response> {
  // A stream rides the one socket held to the machine (PRFC-0011) and ONLY that: a stream
  // forwarded over HTTP is a channel held open for good, and across many machines those
  // pile up. Without a socket the stream is answered with the reason, and the browser
  // re-issues it on its backoff (socket-relay.ts).
  const wantsStream =
    request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/event-stream");
  if (wantsStream) {
    // The socket transport's answer, when the socket carried this request
    // (socket/stream-answer.ts): the machine's frames answer it directly.
    const relayed = await relay.stream(path.machineId, target, {
      path: `${path.remotePath}${new URL(request.url).search}`,
      lastEventId: request.headers.get("last-event-id"),
      answer: answerOf(request),
    });
    if (relayed.status < 500) report?.(path.machineId, { ok: true });
    return relayed;
  }
  return proxyThroughSession(request, path, target, report, reader);
}
