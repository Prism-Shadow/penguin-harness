/**
 * Handing this server's Projects, and their Model config, to a machine they were given to.
 *
 * An Agent running over there calls the model endpoint from over there, so that machine
 * needs the credential. Without this, picking a model here and starting the Session there
 * fails with "Model is not in the Project config".
 *
 * The key travels inside the tunnel to the machine's own `PUT /models`, which writes it to
 * `.project_config.toml` at mode 0600 — whoever can run this already has ssh to that machine
 * and can read that file. An ordinary authenticated call rather than a far-side script: the
 * endpoint validates, invalidates cached runtimes and tells open tabs.
 *
 * MERGED, NOT REPLACED. `PUT /models` is a whole-table replace, so every remote-only entry is
 * re-sent — WITHOUT `apiKey`, since omitting it keeps the stored value and a GET reports keys
 * masked. Ours win on a collision.
 */
import type { MachineApi } from "./machine-api.js";
import type { ModelEntry, ModelRef } from "@prismshadow/penguin-core";
import type {
  ModelInfo,
  ModelRefDto,
  ModelUpdateEntry,
  ModelsResponse,
  ModelsUpdateRequest,
} from "../api/types.js";

/** This side's half of the merge: a Project's configured models, keys in plaintext. */
export interface LocalModels {
  models: ModelEntry[];
  defaultModel?: ModelRef;
  visionModel?: ModelRef;
  /** Display name, so a Project created on the machine reads as the same Project it is. */
  name?: string;
}

/** What a sync did, in the words the connect log shows. */
type ModelSyncOutcome =
  | {
      kind: "synced";
      /** Projects whose model table was written on that machine (empty = nothing needed it). */
      projects: string[];
      /** Of those, the ones this sync had to create over there first. */
      created: string[];
    }
  | { kind: "failed"; detail: string };

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
  // The pointers follow ours. A Project with this id on that machine IS this Project — that
  // is what giving the machine to it meant — and a default pointing somewhere else is how a
  // Session started without an explicit model quietly runs on the wrong one. Only ever set to
  // a pair in the table being sent; one we cannot satisfy is left as theirs, since omitting
  // the field is what keeps it.
  const follow = (ref: ModelRef | undefined): ModelRefDto | undefined =>
    ref !== undefined && ours.has(refKey(ref.provider, ref.model_id))
      ? { provider: ref.provider, modelId: ref.model_id }
      : undefined;
  const defaultModel = follow(local.defaultModel);
  const visionModel = follow(local.visionModel);
  return {
    models,
    ...(defaultModel !== undefined ? { defaultModel } : {}),
    ...(visionModel !== undefined ? { visionModel } : {}),
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
 * Gives a machine the Projects it was given to, and the models they need.
 *
 * `projects` is the entitlement, and it is the ONLY input that decides what is written: a
 * machine belongs to the Projects that adopted it, and a Project that does not use it has no
 * business putting its keys on it.
 *
 * A Project missing over there is CREATED, with the same id. That is the point of an id being
 * stable: the Project on that machine is not a lookalike, it is this Project, and a Session
 * started on that machine sends this id for it to resolve. Creating it is not this server
 * inventing workspaces on a stranger's host — the host was handed to this Project, and a
 * machine that cannot answer for the Project that owns it is a machine that cannot run
 * anything for it.
 *
 * A creation that is REFUSED is reported and that Project is skipped: the machine saying no
 * (an id already taken by someone else's Project, a shape it will not accept) is an answer
 * about a boundary, and writing models around it is not this function's call to make.
 */
export async function syncModelsToMachine(opts: {
  api: MachineApi;
  /** This side's table for a Project, or null when it has no config for it. */
  loadLocal: (projectId: string) => Promise<LocalModels | null>;
  /** The Projects entitled to this machine — nothing outside this list is touched. */
  projects: string[];
}): Promise<ModelSyncOutcome> {
  let theirs: string[];
  try {
    const listed = await opts.api.request("GET", "/api/projects");
    if (listed.status !== 200) {
      return { kind: "failed", detail: `it answered ${listed.status} when asked its projects` };
    }
    theirs = projectIdsIn(listed.text);
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }

  const synced: string[] = [];
  const created: string[] = [];
  for (const projectId of opts.projects) {
    const local = await opts.loadLocal(projectId);
    // Nothing configured here is not a reason to touch their table: a replace built from an
    // empty local list would delete every model they have. It is also not a reason to create
    // the Project — an empty shell is not worth a directory on someone's machine.
    if (local === null || local.models.length === 0) continue;
    const path = `/api/projects/${encodeURIComponent(projectId)}/models`;
    try {
      if (!theirs.includes(projectId)) {
        const made = await opts.api.request("POST", "/api/projects", {
          projectId,
          ...(local.name !== undefined && local.name !== "" ? { name: local.name } : {}),
        });
        if (made.status < 200 || made.status >= 300) {
          return {
            kind: "failed",
            detail: `it refused to create ${projectId}: ${made.status} ${made.text.slice(0, 200)}`,
          };
        }
        created.push(projectId);
      }
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
  return { kind: "synced", projects: synced, created };
}
