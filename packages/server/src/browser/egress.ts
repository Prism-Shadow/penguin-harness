/**
 * How the Browser's requests leave this server, and what stops them.
 *
 * A WORKSPACE target is a port on the loopback of the machine the Workspace is on. For a
 * machine that is a channel through the connection held to it (Machines.dialPort — which
 * opens no ssh of its own); for this server it is a plain loopback connection, to any port
 * but this server's own: the App is never served on a Browser host.
 *
 * A PUBLIC target leaves the way this server's other outbound traffic does, so the admin's
 * proxy settings hold for it too. What it may reach is decided HERE, per request, and not by
 * the page: every address the name resolves to must be on the public internet
 * (address.ts isPublicAddress), or the request is refused. With a direct connection the
 * check IS the resolution the socket uses (a vetted `lookup` on the dispatcher), so a name
 * that answers publicly once and privately the next time — DNS rebinding — has no second
 * answer to give. Through a forward proxy the proxy resolves the name itself, so the check
 * can only be made beside it; that is stated rather than hidden, and it is the proxy's
 * network, not this server's, that such a name would reach.
 *
 * Redirects are never followed here. A 3xx goes back to the browser, which asks again — and
 * the asking is vetted like any other request.
 */
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import { Agent } from "undici";
import type { BrowserTarget } from "./address.js";
import { isPublicAddress } from "./address.js";

export class EgressRefused extends Error {
  constructor(
    readonly code: "not_public" | "own_port" | "machine_unreachable" | "unresolvable",
    message: string,
  ) {
    super(message);
    this.name = "EgressRefused";
  }
}

export interface EgressRequest {
  method: string;
  /** Path and query, as the page asked for them. */
  path: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  signal: AbortSignal;
}

export interface EgressDeps {
  /** A channel to a port on a machine's loopback, through the connection held to it. */
  dialPort(
    machineId: string,
    remotePort: number,
  ): Promise<{ ok: true; socket: net.Socket } | { ok: false; detail: string }>;
  /** This server's own port: never a Workspace target. */
  ownPort(): number;
  /** Whether this server's outbound traffic goes through a forward proxy right now. */
  proxied(): boolean;
  /** Outbound fetch for public targets (the platform's HttpFetch — undici in production). */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Injectable for tests; defaults to the system resolver. */
  resolve?: (hostname: string) => Promise<string[]>;
}

/** Statuses a Response may not carry a body with. */
const NULL_BODY = new Set([101, 204, 205, 304]);

async function systemResolve(hostname: string): Promise<string[]> {
  const found = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
}

/** Every address of `hostname`, or a refusal if any of them is not on the public internet. */
export async function vetPublicHost(
  hostname: string,
  resolve: (hostname: string) => Promise<string[]> = systemResolve,
): Promise<string[]> {
  const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  let addresses: string[];
  if (net.isIP(bare) !== 0) addresses = [bare];
  else {
    try {
      addresses = await resolve(bare);
    } catch {
      throw new EgressRefused("unresolvable", `${hostname} does not resolve.`);
    }
  }
  if (addresses.length === 0) {
    throw new EgressRefused("unresolvable", `${hostname} does not resolve.`);
  }
  // ALL of them, not the first: a name may carry one public record to pass a check and one
  // private record to be connected to.
  if (!addresses.every(isPublicAddress)) {
    throw new EgressRefused(
      "not_public",
      `${hostname} is not a public address. The Browser reaches the Workspace's own ports (localhost:<port>) and the public internet, nothing else.`,
    );
  }
  return addresses;
}

/**
 * A dispatcher whose sockets connect only where the check allows: the `lookup` it resolves
 * with is the vetting itself, so there is no gap between what was checked and what is dialled.
 */
function vettedDispatcher(resolve?: (hostname: string) => Promise<string[]>): Agent {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        vetPublicHost(hostname, resolve).then(
          (addresses) => {
            const all = addresses.map((address) => ({
              address,
              family: net.isIPv6(address) ? 6 : 4,
            }));
            if ((options as { all?: boolean }).all === true) {
              (callback as unknown as (err: null, list: typeof all) => void)(null, all);
            } else {
              const first = all[0] as (typeof all)[number];
              callback(null, first.address, first.family);
            }
          },
          (err: Error) => callback(err as NodeJS.ErrnoException, "", 4),
        );
      },
    },
  });
}

export class BrowserEgress {
  #direct: Agent | null = null;

  constructor(private readonly deps: EgressDeps) {}

  /** Closes the pooled public connections. */
  close(): void {
    void this.#direct?.close();
    this.#direct = null;
  }

  fetch(
    target: BrowserTarget,
    machineId: string | null,
    request: EgressRequest,
  ): Promise<Response> {
    return target.kind === "workspace"
      ? this.#workspace(target.port, machineId, request)
      : this.#public(target.origin, request);
  }

  async #public(origin: string, request: EgressRequest): Promise<Response> {
    const url = new URL(request.path, origin);
    // Checked on every request — and, when the connection is direct, checked AGAIN as the
    // socket's own resolution, which is the one that counts.
    await vetPublicHost(url.hostname, this.deps.resolve);
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
      signal: request.signal,
    };
    if (request.body !== null) {
      init.body = request.body;
      init.duplex = "half";
    }
    if (!this.deps.proxied()) {
      this.#direct ??= vettedDispatcher(this.deps.resolve);
      // undici's own option, which the platform's RequestInit type does not name (and whose
      // bundled typings disagree with undici's across versions): set, not declared.
      (init as { dispatcher?: unknown }).dispatcher = this.#direct;
    }
    return this.deps.fetch(url.toString(), init);
  }

  async #workspace(
    port: number,
    machineId: string | null,
    request: EgressRequest,
  ): Promise<Response> {
    let socket: net.Socket;
    if (machineId === null) {
      if (port === this.deps.ownPort()) {
        throw new EgressRefused("own_port", "That port is this app's own.");
      }
      socket = net.connect({ host: "127.0.0.1", port });
    } else {
      const dialled = await this.deps.dialPort(machineId, port);
      if (!dialled.ok) throw new EgressRefused("machine_unreachable", dialled.detail);
      socket = dialled.socket;
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => (headers[name] = value));
    // One request per dialled socket: the socket IS the connection to the machine, and a
    // pooling agent would outlive the dial it came from. (An Agent, because `agent: false`
    // makes node ignore `createConnection` — the way machines/transport does it.)
    const agent = new http.Agent({ keepAlive: false });
    (agent as unknown as { createConnection: unknown }).createConnection = () => socket;
    return new Promise<Response>((resolve, reject) => {
      const outgoing = http.request(
        {
          method: request.method,
          path: request.path,
          headers,
          agent,
          signal: request.signal,
        },
        (incoming) => {
          const out = new Headers();
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
            out.append(incoming.rawHeaders[i] as string, incoming.rawHeaders[i + 1] as string);
          }
          const status = incoming.statusCode ?? 502;
          if (NULL_BODY.has(status)) {
            incoming.resume();
            return resolve(new Response(null, { status, headers: out }));
          }
          resolve(
            new Response(Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>, {
              status,
              headers: out,
            }),
          );
        },
      );
      outgoing.on("error", (err) => {
        socket.destroy();
        reject(err);
      });
      if (request.body === null) outgoing.end();
      else Readable.fromWeb(request.body as never).pipe(outgoing);
    });
  }
}
