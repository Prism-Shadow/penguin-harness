/**
 * The organization's registry of deployments, and where each one's commit sits on the PR graph.
 *
 * A deployment is wherever a project's build ends up, under an id somebody chose; not every
 * project's deployment is a server, so the registry asks for nothing but the id. A penguin
 * server deployment also has a `url`, and only that one is read: its commit comes from the
 * server's public `GET /api/install` (`installId`, `commit`, `describe`). A deployment without a
 * url is on the registry with no commit the graph can read.
 *
 * The registry holds exactly the deployments somebody registered: no server registers itself,
 * the one answering included (the board's call — nothing is on it by default). Anyone in the
 * organization adds one; the add is refused when the id, the normalised url, or the install id
 * the url answers with is one the registry already has — the install id is what recognises one
 * server behind two addresses (a loopback name and a tunnel port).
 *
 * The server drawing the graph holds no credential for another, and keeping one per deployment
 * would put secrets into the organization's data. Nothing here writes a git ref.
 */
import type {
  InstallResponse,
  ProposalDeployment,
  ProposalGraphDeployment,
} from "@prismshadow/penguin-server/api";
import type { RegisteredDeployment } from "./ledger.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROBE_TIMEOUT_MS = 5_000;
const MAX_ANSWER_BYTES = 64 * 1024;

/** A refused registration: the route answers `{ error: { code, message } }` with `status`. */
export class DeploymentRegistryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentRegistryError";
  }
}

/** What a penguin server deployment says about itself on `/api/install`. */
export interface ServerIdentity {
  installId: string;
  commit: string | null;
  describe: string | null;
}

/** Reads one penguin server's identity; throws with the reason when it cannot. */
export type ProbeServer = (url: string) => Promise<ServerIdentity>;

/** A checked deployment id. */
export function deploymentIdOf(raw: string): string {
  const id = raw.trim();
  if (!ID.test(id)) {
    throw new DeploymentRegistryError(
      400,
      "bad_request",
      `A deployment id is 1–64 letters, digits, ".", "_" or "-", starting with a letter or digit: ${JSON.stringify(raw)}`,
    );
  }
  return id;
}

/**
 * The url a penguin server deployment is registered under: http(s) only, no credentials, the
 * host lower-cased, the default port and a trailing slash dropped — so two spellings of one
 * address compare equal.
 */
export function normalizeServerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DeploymentRegistryError(400, "bad_request", `Not a URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DeploymentRegistryError(
      400,
      "bad_request",
      `A server deployment is reached over http or https: ${url.protocol}`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new DeploymentRegistryError(
      400,
      "bad_request",
      "A deployment url carries no credentials.",
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new DeploymentRegistryError(
      400,
      "bad_request",
      "A deployment url has no query or fragment.",
    );
  }
  // URL already lower-cases the host and drops a default port.
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Throws `deployment_registered` when the candidate repeats a registered deployment — by id,
 * by url, or by the install id the url answered with. With no install id yet (`installId: null`,
 * before the url is read, or no url at all) only id and url are checked.
 */
export function requireUnregistered(
  registered: RegisteredDeployment[],
  candidate: { id: string; url: string | null; installId: string | null },
): void {
  const taken = (message: string): never => {
    throw new DeploymentRegistryError(409, "deployment_registered", message);
  };
  const { url, installId } = candidate;
  for (const d of registered) {
    if (d.id.toLowerCase() === candidate.id.toLowerCase()) {
      taken(
        `The deployment id ${d.id} is registered already${d.url === null ? "" : `, for ${d.url}`}.`,
      );
    }
    if (url !== null && d.url === url) taken(`${d.url} is registered already, as ${d.id}.`);
    if (installId !== null && d.installId === installId) {
      taken(`${url} is the same server as ${d.id} (${d.url}); it is registered already.`);
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

/** A deployment as the graph reads it: its commit now, or why it could not be read. */
export interface DeploymentReading {
  id: string;
  url: string | null;
  commit: string | null;
  describe: string | null;
  error: string | null;
}

/** A layer a deployment may sit on: 0 for the base branch, else the PR number, with its head. */
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
 * Where a deployment's commit sits: the layer whose head it is, else the layer whose head it
 * contains with the fewest commits past it (the nearest one below it; a tie goes to the later
 * layer, the one higher up). No layer when the commit is unknown or contains none.
 */
export function placeDeployment(
  reading: DeploymentReading,
  layers: Layer[],
  compare: CompareOf,
): ProposalGraphDeployment {
  const out: ProposalGraphDeployment = { ...reading, at: null, relation: null, ahead: null };
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

/** The registry as the API lists it: the registered deployments, in the order they were registered. */
export function registryOf(registered: RegisteredDeployment[]): ProposalDeployment[] {
  return registered.map((d) => ({
    id: d.id,
    url: d.url,
    installId: d.installId,
    registeredAt: d.at,
    by: d.by,
  }));
}

/**
 * Reads every registered deployment now: each server deployment over its url, in parallel. A
 * deployment that cannot be read — or has no url to read — keeps its place with the reason.
 */
export async function readDeployments(
  registered: RegisteredDeployment[],
  probe: ProbeServer,
): Promise<DeploymentReading[]> {
  const answers = await Promise.allSettled(
    registered.map((d) => (d.url === null ? Promise.reject(new Error(NO_URL)) : probe(d.url))),
  );
  return registered.map((d, i): DeploymentReading => {
    const a = answers[i]!;
    if (a.status === "rejected") {
      const reason = a.reason instanceof Error ? a.reason.message : String(a.reason);
      return { id: d.id, url: d.url, commit: null, describe: null, error: reason };
    }
    const error =
      a.value.commit === null
        ? "the server reports no commit (a build older than the field, or one with neither a pushed revision nor a stamped commit)"
        : null;
    return { id: d.id, url: d.url, commit: a.value.commit, describe: a.value.describe, error };
  });
}

const NO_URL = "the deployment has no url, so nothing reports the commit it runs";
