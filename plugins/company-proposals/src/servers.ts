/**
 * The organization's registry of penguin servers, and where each one's commit sits on the PR
 * graph.
 *
 * The server that answers is always on the registry, first, as `this`: it is never
 * registered. Anyone in the organization adds another by a name and its address; the add is
 * refused when the name, the normalised address, or the install id the address answers with
 * is one the registry already has — the id is what recognises one server behind two
 * addresses (a loopback name and a tunnel port), including the answering server itself.
 *
 * A server's commit is read from its public `GET /api/install` (`installId`, `commit`,
 * `describe`), the same read for `this` (over the address the caller reached it by) as for
 * the others: the answering server holds no credential for another, and keeping one per
 * server would put secrets into the organization's data. Nothing here writes a git ref.
 */
import type {
  InstallResponse,
  ProposalGraphServer,
  ProposalServer,
} from "@prismshadow/penguin-server/api";
import type { RegisteredServer } from "./ledger.js";

/** The name the answering server goes by on the registry; no registration may take it. */
export const SELF_NAME = "this";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROBE_TIMEOUT_MS = 5_000;
const MAX_ANSWER_BYTES = 64 * 1024;

/** A refused registration: the route answers `{ error: { code, message } }` with `status`. */
export class ServerRegistryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServerRegistryError";
  }
}

/** What a server says about itself on `/api/install`. */
export interface ServerIdentity {
  installId: string;
  commit: string | null;
  describe: string | null;
}

/** Reads one server's identity; throws with the reason when it cannot. */
export type ProbeServer = (url: string) => Promise<ServerIdentity>;

/** A checked registry name. */
export function serverNameOf(raw: string): string {
  const name = raw.trim();
  if (!NAME.test(name)) {
    throw new ServerRegistryError(
      400,
      "bad_request",
      `A server name is 1–64 letters, digits, ".", "_" or "-", starting with a letter or digit: ${JSON.stringify(raw)}`,
    );
  }
  if (name.toLowerCase() === SELF_NAME) {
    throw new ServerRegistryError(
      409,
      "server_registered",
      `"${SELF_NAME}" is the server answering this request; it is registered already.`,
    );
  }
  return name;
}

/**
 * The address a server is registered under: http(s) only, no credentials, the host
 * lower-cased, the default port and a trailing slash dropped — so two spellings of one
 * address compare equal.
 */
export function normalizeServerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ServerRegistryError(400, "bad_request", `Not a URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServerRegistryError(
      400,
      "bad_request",
      `A server is reached over http or https: ${url.protocol}`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ServerRegistryError(400, "bad_request", "A server address carries no credentials.");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ServerRegistryError(400, "bad_request", "A server address has no query or fragment.");
  }
  // URL already lower-cases the host and drops a default port.
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Throws `server_registered` when the candidate repeats the answering server or a registered
 * one — by name, by address, or by the install id the address answered with.
 */
export function requireUnregistered(
  registered: RegisteredServer[],
  self: { installId: string | null },
  candidate: { name: string; url: string; installId: string },
): void {
  const taken = (message: string): never => {
    throw new ServerRegistryError(409, "server_registered", message);
  };
  if (self.installId !== null && self.installId === candidate.installId) {
    taken(
      `${candidate.url} is the server answering this request ("${SELF_NAME}"); it is registered already.`,
    );
  }
  for (const s of registered) {
    if (s.name.toLowerCase() === candidate.name.toLowerCase()) {
      taken(`The name ${s.name} is registered already, for ${s.url}.`);
    }
    if (s.url === candidate.url) taken(`${s.url} is registered already, as ${s.name}.`);
    if (s.installId === candidate.installId) {
      taken(
        `${candidate.url} is the same server as ${s.name} (${s.url}); it is registered already.`,
      );
    }
  }
}

/** The machine's `fetch` against `<url>/api/install`, bounded in time and size, no redirects. */
export function fetchProbe(fetchImpl: typeof fetch = fetch): ProbeServer {
  return async (url) => {
    const res = await fetchImpl(`${url}/api/install`, {
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      void res.body?.cancel();
      throw new Error(`/api/install answered ${res.status}`);
    }
    const text = await res.text();
    if (text.length > MAX_ANSWER_BYTES) throw new Error("/api/install answered too much");
    return identityOf(JSON.parse(text) as unknown);
  };
}

/** A server's `/api/install` answer, checked: an id is required; a server older than the commit fields reports null. */
export function identityOf(body: unknown): ServerIdentity {
  const b = (typeof body === "object" && body !== null ? body : {}) as Partial<InstallResponse>;
  if (typeof b.installId !== "string" || b.installId === "") {
    throw new Error(
      "/api/install named no install id — not a penguin server, or one that could not establish its id",
    );
  }
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return { installId: b.installId, commit: str(b.commit), describe: str(b.describe) };
}

/** A server as the graph reads it: its identity now, or why it could not be read. */
export interface ServerReading {
  name: string;
  url: string | null;
  self: boolean;
  commit: string | null;
  describe: string | null;
  error: string | null;
}

/** A layer a server may sit on: 0 for the base branch, else the PR number, with its head. */
export interface Layer {
  number: number;
  head: string | null;
}

/** The comparison of `from...to` read earlier, as pr-graph.ts keeps them. */
export type CompareOf = (
  from: string,
  to: string,
) => { relation: "same" | "ahead" | "behind" | "diverged"; ahead: number } | undefined;

/**
 * Where a server's commit sits: the layer whose head it is, else the layer whose head it
 * contains with the fewest commits past it (the nearest one below it; a tie goes to the later
 * layer, the one higher up). No layer when the commit is unknown or contains none.
 */
export function placeServer(
  reading: ServerReading,
  layers: Layer[],
  compare: CompareOf,
): ProposalGraphServer {
  const out: ProposalGraphServer = { ...reading, at: null, relation: null, ahead: null };
  const commit = reading.commit?.toLowerCase() ?? null;
  if (commit === null) return out;
  const same = layers.find((l) => l.head !== null && l.head.toLowerCase().startsWith(commit));
  if (same !== undefined) return { ...out, at: same.number, relation: "same", ahead: 0 };
  let best: { number: number; ahead: number } | null = null;
  for (const l of layers) {
    if (l.head === null) continue;
    const cmp = compare(l.head, commit);
    if (cmp === undefined) continue;
    if (cmp.relation === "same") return { ...out, at: l.number, relation: "same", ahead: 0 };
    if (cmp.relation !== "ahead") continue;
    if (best === null || cmp.ahead <= best.ahead) best = { number: l.number, ahead: cmp.ahead };
  }
  return best === null ? out : { ...out, at: best.number, relation: "ahead", ahead: best.ahead };
}

/** The registry as the API lists it: `this` first, then the registered servers in order. */
export function registryOf(
  registered: RegisteredServer[],
  self: { installId: string | null },
): ProposalServer[] {
  return [
    {
      name: SELF_NAME,
      url: null,
      self: true,
      installId: self.installId,
      registeredAt: null,
      by: null,
    },
    ...registered.map((s) => ({
      name: s.name,
      url: s.url,
      self: false,
      installId: s.installId,
      registeredAt: s.at,
      by: s.by,
    })),
  ];
}

/**
 * Reads every server on the registry now, in parallel: `this` over `selfUrl` (the address the
 * caller reached it by), the others over their registered addresses. A server that cannot be
 * read keeps its place with the reason.
 */
export async function readServers(
  registered: RegisteredServer[],
  selfUrl: string,
  probe: ProbeServer,
): Promise<{ self: ServerIdentity | null; readings: ServerReading[] }> {
  const targets = [
    { name: SELF_NAME, url: selfUrl, shown: null as string | null, self: true },
    ...registered.map((s) => ({
      name: s.name,
      url: s.url,
      shown: s.url as string | null,
      self: false,
    })),
  ];
  const answers = await Promise.allSettled(targets.map((t) => probe(t.url)));
  let self: ServerIdentity | null = null;
  const readings = targets.map((t, i): ServerReading => {
    const a = answers[i]!;
    if (a.status === "rejected") {
      const reason = a.reason instanceof Error ? a.reason.message : String(a.reason);
      return {
        name: t.name,
        url: t.shown,
        self: t.self,
        commit: null,
        describe: null,
        error: reason,
      };
    }
    if (t.self) self = a.value;
    const error =
      a.value.commit === null
        ? "the server reports no commit (a build older than the field, or one with neither a pushed revision nor a stamped commit)"
        : null;
    return {
      name: t.name,
      url: t.shown,
      self: t.self,
      commit: a.value.commit,
      describe: a.value.describe,
      error,
    };
  });
  return { self, readings };
}
