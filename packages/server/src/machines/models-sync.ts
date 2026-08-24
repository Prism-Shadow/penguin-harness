/**
 * Handing this server's Model config to a machine it manages.
 *
 * An Agent running over there calls the model endpoint from over there: that machine's own
 * process opens the connection, so that machine needs the credential. Nothing about running
 * the conversation remotely changes where the API key has to be. Without this, picking a
 * model here and starting the Session there fails on the far side with "Model is not in the
 * Project config" — the pair was never configured on the machine that had to use it.
 *
 * WHAT TRAVELS, AND WHY THAT IS DIFFERENT FROM THE ADMIN PASSWORD. The admin password is
 * never sent to a machine, because it never has to be: the far-side scripts read that
 * machine's OWN password off its OWN disk. A model credential has no such local source — the
 * key exists here and the request happens there. So it goes, inside the ssh tunnel, to an
 * endpoint that writes it to `.project_config.toml` at mode 0600. Whoever can run this
 * already has ssh to that machine and can read that file; this spends that access rather
 * than widening it.
 *
 * THROUGH THE TUNNEL, NOT OVER SSH. The machine's server is already a loopback origin here
 * and already has a session (machines/signin.ts), so this is an ordinary authenticated call
 * to its own API — which validates, invalidates its cached runtimes, and tells its open tabs.
 * A far-side script writing TOML would have to re-implement the config writer, and the CLI's
 * `config model add` would put the key in argv, where `ps` can read it.
 *
 * MERGED, NOT REPLACED. `PUT /models` is a whole-table replace, so a machine's own entries
 * have to be carried across it or they would be deleted along with their credentials. Two
 * halves of that, and both are quiet when wrong:
 *
 * - Every remote-only entry is **re-sent**, so it survives the replace.
 * - Re-sent WITHOUT `apiKey`, because omitting it is exactly what keeps the stored value. A
 *   GET reports keys masked, so sending back what we read would overwrite a real credential
 *   with `sk-1…abcd`.
 *
 * Ours win on a collision: the pair is the same model, and this side is the one the person
 * is configuring.
 */
import http from "node:http";
import type { ModelEntry, ModelRef } from "@prismshadow/penguin-core";
import type {
  ModelInfo,
  ModelUpdateEntry,
  ModelsResponse,
  ModelsUpdateRequest,
} from "../api/types.js";

/** This side's half of the merge: a Project's configured models, keys in plaintext. */
export interface LocalModels {
  models: ModelEntry[];
  defaultModel?: ModelRef;
}

/** What a sync did, in the words the connect log shows. */
export type ModelSyncOutcome =
  /** Projects whose model table was written on that machine (empty = nothing needed it). */
  { kind: "synced"; projects: string[] } | { kind: "failed"; detail: string };

/** Entry key: the `(provider, model_id)` pair, joined by a byte neither half can contain. */
const refKey = (provider: string, modelId: string): string => `${provider}\u0000${modelId}`;

/** One of ours, with its credential — the whole point of the exercise. */
function fromLocal(entry: ModelEntry): ModelUpdateEntry {
  return {
    provider: entry.provider,
    modelId: entry.model_id,
    ...(entry.display_name !== undefined ? { displayName: entry.display_name } : {}),
    ...(entry.context_window !== undefined ? { contextWindow: entry.context_window } : {}),
    ...(entry.client_type !== undefined ? { clientType: entry.client_type } : {}),
    ...(entry.vision !== undefined ? { vision: entry.vision } : {}),
    ...(entry.max_tokens !== undefined ? { maxTokens: entry.max_tokens } : {}),
    ...(entry.fast_mode === true ? { fastMode: true } : {}),
    ...(entry.pricing !== undefined
      ? {
          pricing: {
            cacheRead: entry.pricing.cache_read,
            cacheWrite: entry.pricing.cache_write,
            output: entry.pricing.output,
          },
        }
      : {}),
    // An entry with no inline key authenticates from THIS machine's environment
    // (ANTHROPIC_API_KEY and friends), and an environment variable is not ours to carry
    // anywhere. Omitted rather than cleared: the machine may have its own value for the same
    // pair, and destroying it would be worse than leaving it.
    ...(entry.api_key !== undefined && entry.api_key !== "" ? { apiKey: entry.api_key } : {}),
    ...(entry.base_url !== undefined ? { baseUrl: entry.base_url } : {}),
  };
}

/**
 * One of theirs, carried across the whole-table replace untouched.
 *
 * No `apiKey` — see the header: omitting it is what preserves the key already on that
 * machine. The one field that does not round-trip exactly is `vision`, which a GET reports
 * from the built-in catalog when the entry carries no annotation; re-sending it writes that
 * catalog value down explicitly. Same effective value, one more line in their TOML.
 */
function fromRemote(info: ModelInfo): ModelUpdateEntry {
  return {
    provider: info.provider,
    modelId: info.modelId,
    ...(info.displayName !== undefined ? { displayName: info.displayName } : {}),
    ...(info.contextWindow !== undefined ? { contextWindow: info.contextWindow } : {}),
    ...(info.clientType !== undefined ? { clientType: info.clientType } : {}),
    ...(info.vision !== undefined ? { vision: info.vision } : {}),
    ...(info.maxTokens !== undefined ? { maxTokens: info.maxTokens } : {}),
    ...(info.fastMode === true ? { fastMode: true } : {}),
    ...(info.pricing !== undefined ? { pricing: info.pricing } : {}),
    ...(info.credential?.baseUrl !== undefined ? { baseUrl: info.credential.baseUrl } : {}),
  };
}

/**
 * The table to PUT on a machine: ours, plus everything of theirs we are not replacing.
 *
 * Callers must not reach here with an empty local table — a whole-table replace built from
 * one would delete every model that machine has (syncModelsToMachine is what guards it).
 */
export function planModelSync(local: LocalModels, remote: ModelsResponse): ModelsUpdateRequest {
  const ours = new Set(local.models.map((entry) => refKey(entry.provider, entry.model_id)));
  const models: ModelUpdateEntry[] = [
    ...local.models.map(fromLocal),
    ...remote.models
      .filter((info) => !ours.has(refKey(info.provider, info.modelId)))
      .map(fromRemote),
  ];
  // Their default is left alone: nothing is ever removed, so whatever it named is still
  // there, and omitting the field is what keeps it. Ours is offered only to a machine that
  // has no default at all — otherwise this would silently repoint a machine somebody else set up.
  const adopt =
    remote.defaultModel === undefined &&
    local.defaultModel !== undefined &&
    ours.has(refKey(local.defaultModel.provider, local.defaultModel.model_id))
      ? { provider: local.defaultModel.provider, modelId: local.defaultModel.model_id }
      : undefined;
  return { models, ...(adopt !== undefined ? { defaultModel: adopt } : {}) };
}

/** The machine's own API, reached through its tunnel as an authenticated caller. */
export interface MachineApi {
  request(
    method: "GET" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }>;
}

/**
 * A client for one machine's tunnel port. node:http rather than fetch, for the reason the
 * proxy gives: the Host header has to be the canonical app host (`localhost:<port>`) while
 * the connection goes to 127.0.0.1, and fetch ignores an explicit host header.
 */
export function machineApi(port: number, cookie: string): MachineApi {
  return {
    request: (method, path, body) =>
      new Promise((resolve, reject) => {
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path,
            method,
            headers: {
              host: `localhost:${port}`,
              cookie,
              ...(payload === null
                ? {}
                : { "content-type": "application/json", "content-length": String(payload.length) }),
            },
            timeout: 30_000,
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
      }),
  };
}

/** Project ids that machine has, narrowed from its own answer (it may be an older build). */
function projectIdsIn(text: string): string[] {
  const body: unknown = JSON.parse(text);
  if (body === null || typeof body !== "object") return [];
  const list = (body as { projects?: unknown }).projects;
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) =>
      entry !== null && typeof entry === "object"
        ? (entry as { projectId?: unknown }).projectId
        : undefined,
    )
    .filter((id): id is string => typeof id === "string");
}

/**
 * Gives a machine the models it needs, for the Projects that both use it and exist there.
 *
 * Two filters, and they answer different questions. `projects` is whose credentials this
 * machine is entitled to: a machine belongs to the Projects that adopted it, and a Project
 * that does not use it has no business putting its keys on it. The intersection with the
 * machine's OWN project list is the other: an id is a directory name each server mints for
 * itself, so one this side has and that side does not is a different Project, not a missing
 * one — creating it there would be this server inventing workspaces on someone else's machine.
 */
export async function syncModelsToMachine(opts: {
  api: MachineApi;
  /** This side's table for a Project, or null when it has no config for it. */
  loadLocal: (projectId: string) => Promise<LocalModels | null>;
  /**
   * The Projects entitled to this machine. Omitted means every shared one, which is only
   * right for a caller that has already decided entitlement for itself.
   */
  projects?: string[];
}): Promise<ModelSyncOutcome> {
  let candidates: string[];
  try {
    const listed = await opts.api.request("GET", "/api/projects");
    if (listed.status !== 200) {
      return { kind: "failed", detail: `it answered ${listed.status} when asked its projects` };
    }
    const theirs = projectIdsIn(listed.text);
    const entitled = opts.projects;
    candidates = entitled === undefined ? theirs : theirs.filter((id) => entitled.includes(id));
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }

  const synced: string[] = [];
  for (const projectId of candidates) {
    const local = await opts.loadLocal(projectId);
    // Nothing configured here is not a reason to touch their table: a replace built from an
    // empty local list would delete every model they have.
    if (local === null || local.models.length === 0) continue;
    const path = `/api/projects/${encodeURIComponent(projectId)}/models`;
    try {
      const current = await opts.api.request("GET", path);
      if (current.status !== 200) {
        return {
          kind: "failed",
          detail: `it answered ${current.status} when asked the models of ${projectId}`,
        };
      }
      const plan = planModelSync(local, JSON.parse(current.text) as ModelsResponse);
      const wrote = await opts.api.request("PUT", path, plan);
      if (wrote.status < 200 || wrote.status >= 300) {
        return {
          kind: "failed",
          detail: `it refused the models of ${projectId}: ${wrote.status} ${wrote.text.slice(0, 200)}`,
        };
      }
      synced.push(projectId);
    } catch (err) {
      return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
  }
  return { kind: "synced", projects: synced };
}
