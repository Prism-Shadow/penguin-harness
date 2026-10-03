/**
 * `penguin config` — manages a Project's models, its groups' connections, the default model,
 * Agent-level vault environment variables, and UI language.
 *
 *   penguin config model add --provider <group> --model-id <upstream id> [--api-key <key> | --clear-api-key] [--base-url <url> | --clear-base-url] [--client-type <type> | --clear-client-type] [--context-window <n>] [--max-tokens <n>] [--vision | --no-vision] [--fast-mode | --no-fast-mode] [--price-cache-read <n>] [--price-cache-write <n>] [--price-output <n>] [--set-default] [--project-id <id>] [--root <dir>]
 *   penguin config model add --provider <group> [--api-key <key> | --clear-api-key] [--base-url <url> | --clear-base-url] [--client-type <type> | --clear-client-type] [--project-id <id>] [--root <dir>]
 *   penguin config model default --provider <group> --model-id <upstream id> [--project-id <id>] [--root <dir>]
 *   penguin config model vision --provider <group> --model-id <upstream id> [--project-id <id>] [--root <dir>]
 *   penguin config model list [--project-id <id>] [--root <dir>]
 *   penguin config model remove --provider <group> --model-id <upstream id> [--project-id <id>] [--root <dir>]
 *   penguin config model remove --provider <group> [--project-id <id>] [--root <dir>]
 *   penguin config vault set --key <name> --value <value> [--agent-id <id>] [--root <dir>]
 *   penguin config vault list [--agent-id <id>] [--root <dir>]
 *   penguin config vault remove --key <name> [--agent-id <id>] [--root <dir>]
 *   penguin config lang <en|zh>
 *
 * `--model-id` always takes the **upstream id** (the request id sent to MMSP verbatim),
 * which together with `--provider` forms a `(provider, model_id)` paired reference —
 * **no string concatenation is ever performed**. `--provider` is **required** on every model
 * subcommand: the group is never guessed, so `--api-key` can never land on a vendor the user
 * did not name. `model add` and `model remove` without `--model-id` act on the group itself:
 * `add` sets or clears its connection (`[providers.<group>]`), and `remove` drops that table
 * while its models stay; the flags that describe one model are refused there.
 *
 * A model's connection (base URL, API key, protocol) resolves per field from the file alone:
 * the entry's own value, else its group's `[providers.<id>]`, else nothing — the client's
 * default (core's effectiveConnection); the group key reaches only the entries that go to the
 * group's endpoint (groupKeyReaches). The built-in catalog is never a runtime layer: a new
 * Project's file already carries the gateways' tables. `model add` therefore writes a new
 * entry's client_type and base_url only when given, and only a custom / user-defined entry
 * whose group sets no protocol gets openai-chat. `--clear-*` removes a stored value, the
 * entry's with `--model-id` and the group's without. Adding a NEW entry to a first-party
 * vendor group under a model id MMSP cannot route is refused, since nothing there would carry
 * a protocol for it, and so is adding one that is not a preset to a built-in group that takes
 * no hand-added models (isAddableGroup).
 * For `model default` / `model vision`, core validation raises an error when the reference is
 * not found in models; `model remove` reports the same condition itself, since removal is
 * idempotent in core, and clears the default / vision pointers that named the removed entry;
 * removing the last model of a group of the user's own drops that group's connection too.
 * `model list` prints the groups' stored connections, then every model's effective values,
 * marking the group's with `(provider)` and an environment key with `(env)`.
 * `--root` specifies the data root directory (priority: option >
 * PENGUIN_HOME > ~/.penguin/data). The UI language is controlled by the PENGUIN_LANG
 * environment variable; `config lang` writes it into the shell startup file and restarts
 * the shell to take effect.
 * Docs: /docs/cli § "penguin config".
 */
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Command } from "commander";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  type ConnectionSource,
  type EffectiveConnection,
  type ModelEntry,
  type ModelPricing,
  type ModelRef,
  type ProjectConfig,
  type ProviderConnectionPatch,
  addModel,
  effectiveConnection,
  fastModeProtocol,
  formatModelRef,
  getModel,
  groupKeyReaches,
  loadAgentVault,
  loadProjectConfig,
  modelEnvPreviewKey,
  providerConnectionShape,
  providerInfo,
  removeModel,
  removeVaultEntry,
  setDefaultModel,
  setProviderConnection,
  setVaultEntry,
  setVisionModel,
  unaddableModel,
  unroutableVendorModel,
} from "@prismshadow/penguin-core";
import { parseApprovalAnswer } from "../approval.js";
import { resolveRootOption } from "../root-option.js";
import { getMessages, maskApiKey, type Messages } from "../i18n.js";
import { applyLanguageToRc, restartShell } from "../lang-config.js";

/**
 * Lays cells out as column-aligned lines, in the given column order; a column empty in every
 * row is left out.
 */
function alignColumns<K extends string>(
  cells: ReadonlyArray<Record<K, string>>,
  columns: readonly K[],
): string[] {
  const widths = columns.map((c) => Math.max(...cells.map((cell) => cell[c].length)));
  const active = columns
    .map((c, i) => ({ key: c, width: widths[i]! }))
    .filter((col) => col.width > 0);
  return cells.map((cell) =>
    active
      .map((col, i) => (i === active.length - 1 ? cell[col.key] : cell[col.key].padEnd(col.width)))
      .join("  ")
      .trimEnd(),
  );
}

/** ` (provider)` after a value the row takes from its group's `[providers.<id>]`; nothing otherwise. */
function sourceMark(source: ConnectionSource): string {
  return source === "provider" ? " (provider)" : "";
}

/**
 * The key a row is used with, masked: its own, its group's (marked `(provider)`), or — with
 * neither — the environment variable the models page would show for it (modelEnvPreviewKey on
 * the effective endpoint, the same narrowing the server's preview applies), marked `(env)`
 * when that variable is set. `-` when there is none.
 */
function displayedKey(
  entry: ModelEntry,
  effective: EffectiveConnection,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (effective.apiKeySource !== "none") {
    return `${maskApiKey(effective.apiKey)}${sourceMark(effective.apiKeySource)}`;
  }
  const envKey = modelEnvPreviewKey({
    provider: entry.provider,
    modelId: entry.model_id,
    clientType: effective.clientType,
    baseUrl: effective.baseUrl,
  });
  const value = envKey !== undefined ? env[envKey]?.trim() : undefined;
  return value ? `${maskApiKey(value)} (env)` : maskApiKey(undefined);
}

/**
 * Renders the model list as column-aligned lines (the default model is marked with `*`;
 * fully empty columns are omitted automatically). `provider` and `model_id` each occupy
 * their own column (stored fields, never split apart); `vision` is the entry's annotation,
 * Y when absent (absent = supported; the catalog is not consulted). `client_type`, `api_key`
 * and `base_url` are the values the model is actually used with (effectiveConnection: the
 * row's own, else its group's, else none — the client's default); one taken from the group is
 * suffixed `(provider)`, and a key lent by the environment `(env)`. Exported for unit tests.
 */
export function formatModelRows(
  cfg: ProjectConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const cells = cfg.models.map((entry) => {
    const isDefault =
      cfg.default_model?.provider === entry.provider &&
      cfg.default_model?.model_id === entry.model_id;
    const effective = effectiveConnection(
      {
        provider: entry.provider,
        modelId: entry.model_id,
        clientType: entry.client_type,
        baseUrl: entry.base_url,
        apiKey: entry.api_key,
      },
      providerConnectionShape(cfg.providers?.[entry.provider]),
    );
    return {
      provider: `${isDefault ? "* " : "  "}${entry.provider}`,
      model: entry.model_id,
      vision: `vision=${entry.vision === false ? "-" : "Y"}`,
      context_window:
        entry.context_window !== undefined ? `context_window=${entry.context_window}` : "",
      client_type: effective.clientType
        ? `client_type=${effective.clientType}${sourceMark(effective.clientTypeSource)}`
        : "",
      pricing: entry.pricing
        ? `price=${entry.pricing.cache_read}/${entry.pricing.cache_write}/${entry.pricing.output}`
        : "",
      api_key: `api_key=${displayedKey(entry, effective, env)}`,
      base_url: effective.baseUrl
        ? `base_url=${effective.baseUrl}${sourceMark(effective.baseUrlSource)}`
        : "",
    };
  });
  return alignColumns(cells, [
    "provider",
    "model",
    "vision",
    "context_window",
    "client_type",
    "pricing",
    "api_key",
    "base_url",
  ]);
}

/**
 * Renders the stored group connections (`[providers.<id>]`) as column-aligned lines: the
 * group id, then its base_url, client_type and key masked, each `-` when the group stores
 * none — `model list` prints them above the models. Only what the file stores: the catalog's
 * reference values are not shown. Exported for unit tests.
 */
export function formatGroupRows(cfg: ProjectConfig): string[] {
  const shown = (value: string | undefined): string => value?.trim() || "-";
  const cells = Object.entries(cfg.providers ?? {}).map(([id, connection]) => ({
    provider: id,
    base_url: `base_url=${shown(connection.base_url)}`,
    client_type: `client_type=${shown(connection.client_type)}`,
    api_key: `api_key=${maskApiKey(connection.api_key?.trim() || undefined)}`,
  }));
  return alignColumns(cells, ["provider", "base_url", "client_type", "api_key"]);
}

/** A group name of the user's own: a lowercase letter or digit first, then lowercase letters, digits, `-` and `_`, at most 32 characters. */
const GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The connection flags `model add` takes in both of its forms. */
interface ConnectionFlags {
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string;
  clearBaseUrl?: boolean;
  clientType?: string;
  clearClientType?: boolean;
}

/**
 * The connection flags as a patch, the same for a group and for one model: per field, a value
 * sets it, its `--clear-*` flag clears it (`null`), and neither leaves it alone. A field both
 * set and cleared is refused, and so is a blank value — an agent with no key to pass must not
 * wipe the one stored; clearing takes the explicit flag. Returns the refusal sentence instead
 * of a patch.
 */
function connectionPatch(
  opts: ConnectionFlags,
  t: Messages,
): { patch: ProviderConnectionPatch } | { refusal: string } {
  const patch: ProviderConnectionPatch = {};
  const fields = [
    ["api_key", "--api-key", "--clear-api-key", opts.apiKey, opts.clearApiKey],
    ["base_url", "--base-url", "--clear-base-url", opts.baseUrl, opts.clearBaseUrl],
    ["client_type", "--client-type", "--clear-client-type", opts.clientType, opts.clearClientType],
  ] as const;
  for (const [field, flag, clearFlag, value, clear] of fields) {
    if (value !== undefined && clear === true) {
      return { refusal: t.providerFlagConflict(flag, clearFlag) };
    }
    if (value !== undefined && String(value).trim() === "") {
      return { refusal: t.providerBlankValue(flag, clearFlag) };
    }
    if (value !== undefined) patch[field] = String(value);
    else if (clear === true) patch[field] = null;
  }
  return { patch };
}

/** Writes a refusal to stderr and sets a failing exit code; nothing is written to the config. */
function refuse(t: Messages, message: string): void {
  process.stderr.write(`${t.error(message)}\n`);
  process.exitCode = 1;
}

/**
 * `model add` without `--model-id`: sets or clears the group's connection
 * (`[providers.<group>]`), which the group's models without a value of their own follow. The
 * flags that describe one model are refused rather than dropped, and so is a call that changes
 * nothing.
 */
async function addGroupConnection(
  opts: ConnectionFlags & {
    provider: string;
    projectId: string;
    root?: string;
    contextWindow?: number;
    maxTokens?: number;
    vision?: boolean;
    fastMode?: boolean;
    priceCacheRead?: number;
    priceCacheWrite?: number;
    priceOutput?: number;
    setDefault?: boolean;
  },
  t: Messages,
): Promise<void> {
  const root = resolveRootOption(opts.root);
  const group = String(opts.provider).trim();
  const rowOnly =
    opts.contextWindow !== undefined ||
    opts.maxTokens !== undefined ||
    opts.vision !== undefined ||
    opts.fastMode !== undefined ||
    opts.priceCacheRead !== undefined ||
    opts.priceCacheWrite !== undefined ||
    opts.priceOutput !== undefined ||
    opts.setDefault === true;
  if (rowOnly) {
    refuse(t, t.modelGroupOnlyFlags(group));
    return;
  }
  // The group-name rule the models page and the server apply; a group some model already
  // names (one `model add` created under another spelling) is let through.
  if (
    !GROUP_ID.test(group) &&
    providerInfo(group) === undefined &&
    !(await loadProjectConfig(root, opts.projectId)).models.some((m) => m.provider === group)
  ) {
    refuse(t, t.providerInvalidGroup(group));
    return;
  }
  const parsed = connectionPatch(opts, t);
  if ("refusal" in parsed) {
    refuse(t, parsed.refusal);
    return;
  }
  const { patch } = parsed;
  if (Object.keys(patch).length === 0) {
    refuse(t, t.providerNothingToSet(group));
    return;
  }
  let cfg: ProjectConfig;
  try {
    cfg = await setProviderConnection(root, opts.projectId, group, patch);
  } catch (err) {
    refuse(t, err instanceof Error ? err.message : String(err));
    return;
  }
  // Models that keep a value of their own for a changed field are unaffected by it: say how
  // many, so a "why does this model still use the old key" never needs the file to answer. A
  // model whose own base URL is not on the group's endpoint never takes the group key
  // (groupKeyReaches), so a key change passes it by as well.
  const groupBaseUrl = cfg.providers?.[group]?.base_url;
  const rows = cfg.models.filter((m) => m.provider === group);
  const own = (value: string | undefined): boolean => (value ?? "").trim() !== "";
  const overriding = rows.filter(
    (m) =>
      (patch.api_key !== undefined &&
        (own(m.api_key) || !groupKeyReaches(m.base_url, groupBaseUrl))) ||
      (patch.base_url !== undefined && own(m.base_url)) ||
      (patch.client_type !== undefined && own(m.client_type)),
  ).length;
  process.stdout.write(`${t.providerSaved(group, overriding)}\n`);
  // A group of the user's own exists only through its models; one with none yet is either
  // about to get them or a typo, and either way the user should know.
  if (rows.length === 0 && providerInfo(group) === undefined) {
    process.stdout.write(`${t.providerNoModels(group)}\n`);
  }
}

/**
 * `model remove` without `--model-id`: drops the group's `[providers.<group>]` table, every
 * field of it, and leaves its models alone — the only way to delete models stays one pair at a
 * time. A group with no table is refused, pointing at `--model-id`.
 */
async function removeGroupConnection(
  opts: { provider: string; projectId: string; root?: string },
  t: Messages,
): Promise<void> {
  const root = resolveRootOption(opts.root);
  const group = String(opts.provider).trim();
  const before = await loadProjectConfig(root, opts.projectId);
  if (before.providers?.[group] === undefined) {
    refuse(t, t.providerNothingToRemove(group));
    return;
  }
  const cfg = await setProviderConnection(root, opts.projectId, group, {
    api_key: null,
    base_url: null,
    client_type: null,
  });
  const models = cfg.models.filter((m) => m.provider === group).length;
  process.stdout.write(`${t.providerRemoved(group, models)}\n`);
}

export function registerConfigCommand(program: Command, t: Messages): void {
  const config = program.command("config").description(t.config.desc);
  const model = config.command("model").description(t.config.modelDesc);

  model
    .command("add")
    .description(t.config.addDesc)
    .option("--model-id <id>", t.config.addModelId)
    .requiredOption("--provider <group>", t.config.addProvider)
    .option("--api-key <key>", t.config.addApiKey)
    .option("--clear-api-key", t.config.addClearApiKey)
    .option("--base-url <url>", t.config.addBaseUrl)
    .option("--clear-base-url", t.config.addClearBaseUrl)
    .option("--client-type <type>", t.config.addClientType)
    .option("--clear-client-type", t.config.addClearClientType)
    .option("--context-window <n>", t.config.addContextWindow, parseIntArg)
    .option("--max-tokens <n>", t.config.addMaxTokens, parseIntArg)
    // Tri-state: --vision marks it supported / --no-vision marks it unsupported / neither given keeps the existing value (defaults to supported).
    .option("--vision", t.config.addVision)
    .option("--no-vision", t.config.addNoVision)
    // Tri-state like --vision: --fast-mode enables it / --no-fast-mode clears it / neither keeps the existing value (defaults to off; only `true` is persisted).
    .option("--fast-mode", t.config.addFastMode)
    .option("--no-fast-mode", t.config.addNoFastMode)
    .option("--price-cache-read <n>", t.config.addPriceCacheRead, parseFloatArg)
    .option("--price-cache-write <n>", t.config.addPriceCacheWrite, parseFloatArg)
    .option("--price-output <n>", t.config.addPriceOutput, parseFloatArg)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--set-default", t.config.addSetDefault)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      // No --model-id: the command sets the group's connection instead of one model's.
      if (opts.modelId === undefined) {
        await addGroupConnection(opts, t);
        return;
      }
      // Output cap: parseIntArg already rejects non-numbers; 0/negative must not reach the config either.
      const maxTokens: number | undefined = opts.maxTokens;
      if (maxTokens !== undefined && maxTokens <= 0) {
        refuse(t, `--max-tokens must be a positive integer: got "${maxTokens}".`);
        return;
      }
      const parsed = connectionPatch(opts, t);
      if ("refusal" in parsed) {
        refuse(t, parsed.refusal);
        return;
      }
      const { patch } = parsed;
      const root = resolveRootOption(opts.root);
      // --model-id takes the upstream id, paired with the required --provider as a
      // reference; the group is never guessed, so --api-key can only ever land on the
      // vendor the user named. No concatenation is performed.
      const modelId: string = opts.modelId;
      const provider: string = opts.provider;
      const ref: ModelRef = { provider, model_id: modelId };
      const before = await loadProjectConfig(root, opts.projectId);
      const existed = getModel(before, ref) !== undefined;
      const group = providerConnectionShape(before.providers?.[provider]);
      // A new entry stores a client_type / base_url only when one is given: left out, it
      // follows its group's [providers.<id>] (effectiveConnection), so a later change to the
      // group reaches it too, and with no group value it gets the client's default — the
      // catalog is not asked. The one default still written is openai-chat, for a custom /
      // user-defined entry whose group sets no protocol, which would otherwise be routed by
      // its id (the id says nothing about a custom endpoint). An entry already stored gets no
      // default either way: updating it never overrides its config. --clear-client-type asks
      // for no protocol of its own, so it gets no default either. (An explicit --client-type /
      // --base-url always passes through; core's addModel normalizes the deprecated bare
      // "openai" alias.)
      const pInfo = providerInfo(provider);
      const customLike = provider === "custom" || pInfo === undefined;
      const defaultClientType =
        customLike && effectiveConnection({ provider, modelId }, group).clientType === undefined
          ? "openai-chat"
          : undefined;
      const clientType: string | null | undefined =
        patch.client_type !== undefined
          ? patch.client_type
          : !existed
            ? defaultClientType
            : undefined;
      // This command writes the config file directly rather than through the server's models
      // route, so the rule that route enforces is enforced again here — otherwise the door
      // the Web App closed is still open from the shell, and an agent following the
      // "add models with AI" prompt walks straight through it. A first-party vendor group
      // persists no client_type, so MMSP places its entries by the vendor family their id
      // begins with; an id of no known family is refused before anything is written. Judged on
      // the protocol the entry would actually be used with — its own, else its group's — so an
      // explicit --client-type MMSP has passes. An entry that is already stored is left alone:
      // updating it is not the act that put it there.
      const used = effectiveConnection(
        { provider, modelId, clientType: clientType ?? undefined },
        group,
      );
      if (!existed && unroutableVendorModel(provider, modelId, used.clientType)) {
        refuse(t, t.modelNotRoutable(formatModelRef(ref)));
        return;
      }
      // The route's second rule, enforced here for the same reason: only the groups that take
      // hand-added models (custom, vLLM, OpenRouter, TokenDance, SiliconFlow and user-defined
      // groups) do, and every other built-in group carries its catalog presets. A preset may be
      // added back; an entry already stored is left alone.
      if (!existed && unaddableModel(provider, modelId)) {
        refuse(t, t.modelNotAddable(formatModelRef(ref), pInfo?.label ?? provider));
        return;
      }
      // Only collect explicitly given price fields, letting addModel merge them with the existing pricing per-field.
      const pricing: Partial<ModelPricing> = {};
      if (opts.priceCacheRead !== undefined) pricing.cache_read = opts.priceCacheRead;
      if (opts.priceCacheWrite !== undefined) pricing.cache_write = opts.priceCacheWrite;
      if (opts.priceOutput !== undefined) pricing.output = opts.priceOutput;
      const cfg = await addModel(
        root,
        opts.projectId,
        {
          provider,
          model_id: modelId,
          ...(opts.contextWindow !== undefined ? { context_window: opts.contextWindow } : {}),
          ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
          ...(clientType !== undefined ? { client_type: clientType } : {}),
          ...(opts.vision !== undefined ? { vision: opts.vision } : {}),
          ...(opts.fastMode !== undefined ? { fast_mode: opts.fastMode } : {}),
          ...(Object.keys(pricing).length > 0 ? { pricing } : {}),
          ...(patch.api_key !== undefined ? { api_key: patch.api_key } : {}),
          ...(patch.base_url !== undefined ? { base_url: patch.base_url } : {}),
        },
        { setDefault: Boolean(opts.setDefault) },
      );
      const defaultRef = cfg.default_model && formatModelRef(cfg.default_model);
      const line = existed
        ? t.modelUpdated(formatModelRef(ref), defaultRef)
        : t.modelAdded(formatModelRef(ref), defaultRef);
      process.stdout.write(`${line}\n`);
      // Fast mode on a model whose MMSP client cannot carry it makes every session
      // request fail. The Web dialog does not offer the switch there at all, so this flag is
      // the remaining way into that state: warn rather than silently write a config that only
      // reveals itself at request time. A warning, not a refusal — the entry may point at an
      // endpoint whose capability we cannot see from here (see fastModeProtocol). Judged on the
      // protocol and endpoint the entry is used with, which may be its group's.
      const saved = getModel(cfg, ref);
      if (opts.fastMode === true && saved !== undefined) {
        const effective = effectiveConnection(
          {
            provider: saved.provider,
            modelId: saved.model_id,
            clientType: saved.client_type,
            baseUrl: saved.base_url,
          },
          providerConnectionShape(cfg.providers?.[saved.provider]),
        );
        if (
          fastModeProtocol(saved.model_id, effective.clientType, effective.baseUrl) === undefined
        ) {
          process.stderr.write(`${t.config.fastModeUnsupported(formatModelRef(ref))}\n`);
        }
      }
    });

  model
    .command("default")
    .description(t.config.defaultDesc)
    .requiredOption("--model-id <id>", t.config.refModelId)
    .requiredOption("--provider <group>", t.config.refProvider)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const root = resolveRootOption(opts.root);
      // --model-id takes the upstream id, paired with the required --provider as a
      // reference (no concatenation, no fuzzy matching); setDefaultModel raises an error
      // when the reference is not found in models.
      const ref: ModelRef = { provider: opts.provider, model_id: opts.modelId };
      try {
        await setDefaultModel(root, opts.projectId, ref);
      } catch (err) {
        refuse(t, err instanceof Error ? err.message : String(err));
        return;
      }
      process.stdout.write(`${t.defaultModelSet(formatModelRef(ref))}\n`);
    });

  model
    .command("vision")
    .description(t.config.visionDesc)
    .requiredOption("--model-id <id>", t.config.refModelId)
    .requiredOption("--provider <group>", t.config.refProvider)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const root = resolveRootOption(opts.root);
      // Paired reference semantics match `model default`; existence and vision=false semantics validation is handled by setVisionModel.
      const ref: ModelRef = { provider: opts.provider, model_id: opts.modelId };
      try {
        await setVisionModel(root, opts.projectId, ref);
      } catch (err) {
        refuse(t, err instanceof Error ? err.message : String(err));
        return;
      }
      process.stdout.write(`${t.visionModelSet(formatModelRef(ref))}\n`);
    });

  model
    .command("list")
    .description(t.config.listDesc)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const root = resolveRootOption(opts.root);
      const cfg = await loadProjectConfig(root, opts.projectId);
      // The groups' stored connections first, since the models' (provider) values come from
      // them; then the models with what each one is used with.
      const groups = formatGroupRows(cfg);
      if (groups.length > 0) {
        process.stdout.write(`${t.groupListTitle()}\n`);
        for (const line of groups) process.stdout.write(`${line}\n`);
        process.stdout.write("\n");
      }
      if (cfg.models.length === 0) {
        process.stdout.write(`${t.modelListEmpty()}\n`);
        return;
      }
      process.stdout.write(`${t.modelListTitle()}\n`);
      for (const line of formatModelRows(cfg)) {
        process.stdout.write(`${line}\n`);
      }
    });

  model
    .command("remove")
    .description(t.config.removeDesc)
    .option("--model-id <id>", t.config.removeModelId)
    .requiredOption("--provider <group>", t.config.refProvider)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      // No --model-id: the command removes the group's connection, never a model.
      if (opts.modelId === undefined) {
        await removeGroupConnection(opts, t);
        return;
      }
      const root = resolveRootOption(opts.root);
      // Paired reference semantics match `model default` / `model vision`. removeModel is
      // idempotent, so whether a missing entry is worth reporting is decided here — same
      // shape as `vault remove`, which also checks first and exits non-zero.
      const ref: ModelRef = { provider: opts.provider, model_id: opts.modelId };
      const before = await loadProjectConfig(root, opts.projectId);
      if (getModel(before, ref) === undefined) {
        process.stderr.write(`${t.modelNotConfigured(formatModelRef(ref))}\n`);
        process.exitCode = 1;
        return;
      }
      const cfg = await removeModel(root, opts.projectId, ref);
      // A group of the user's own exists only through its models, so its connection goes with
      // the last of them, as it does when the models page saves the table without them.
      if (
        providerInfo(ref.provider) === undefined &&
        cfg.providers?.[ref.provider] !== undefined &&
        !cfg.models.some((m) => m.provider === ref.provider)
      ) {
        await setProviderConnection(root, opts.projectId, ref.provider, {
          api_key: null,
          base_url: null,
          client_type: null,
        });
      }
      // The default model rides along on the confirmation (as it does for add/update) because
      // removing the model it named leaves it unset, and the next run would otherwise fail with
      // a config error nobody would connect to this command. The vision pointer is rarer, so it
      // only speaks up when this removal is what cleared it.
      process.stdout.write(
        `${t.modelRemoved(formatModelRef(ref), cfg.default_model && formatModelRef(cfg.default_model))}\n`,
      );
      if (before.vision_model !== undefined && cfg.vision_model === undefined) {
        process.stdout.write(`${t.visionModelCleared()}\n`);
      }
    });

  const vault = config.command("vault").description(t.config.vaultDesc);

  vault
    .command("set")
    .description(t.config.vaultSetDesc)
    .requiredOption("--key <name>", t.config.vaultKey)
    .requiredOption("--value <value>", t.config.vaultValue)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--agent-id <id>", t.common.agentId, DEFAULT_AGENT_ID)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const root = resolveRootOption(opts.root);
      try {
        await setVaultEntry(root, opts.projectId, opts.agentId, opts.key, opts.value);
      } catch (err) {
        // Validation errors such as an invalid key name: print an explanation and exit with a non-zero code, without throwing a stack trace.
        process.stderr.write(`${t.error(err instanceof Error ? err.message : String(err))}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${t.vaultSet(opts.key)}\n`);
    });

  vault
    .command("list")
    .description(t.config.vaultListDesc)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--agent-id <id>", t.common.agentId, DEFAULT_AGENT_ID)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const root = resolveRootOption(opts.root);
      const entries = Object.entries(await loadAgentVault(root, opts.projectId, opts.agentId));
      if (entries.length === 0) {
        process.stdout.write(`${t.vaultListEmpty()}\n`);
        return;
      }
      process.stdout.write(`${t.vaultListTitle()}\n`);
      const width = Math.max(...entries.map(([key]) => key.length));
      for (const [key, value] of entries) {
        process.stdout.write(`${key.padEnd(width)}  ${maskApiKey(value)}\n`);
      }
    });

  vault
    .command("remove")
    .description(t.config.vaultRemoveDesc)
    .requiredOption("--key <name>", t.config.vaultKey)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--agent-id <id>", t.common.agentId, DEFAULT_AGENT_ID)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const root = resolveRootOption(opts.root);
      const vaultEntries = await loadAgentVault(root, opts.projectId, opts.agentId);
      if (vaultEntries[opts.key] === undefined) {
        process.stderr.write(`${t.vaultKeyMissing(opts.key)}\n`);
        process.exitCode = 1;
        return;
      }
      await removeVaultEntry(root, opts.projectId, opts.agentId, opts.key);
      process.stdout.write(`${t.vaultRemoved(opts.key)}\n`);
    });

  config
    .command("lang")
    .description(t.config.langDesc)
    .argument("<language>", t.config.langArg)
    .action(async (language: string) => {
      const lang = String(language).trim().toLowerCase();
      if (lang !== "zh" && lang !== "en") {
        process.stderr.write(`${t.langInvalid(String(language))}\n`);
        process.exitCode = 1;
        return;
      }
      // Windows has no POSIX shell startup file to write and no /bin shell to restart into;
      // refuse with a clear pointer instead of an ENOENT from spawning /bin/zsh.
      if (process.platform === "win32") {
        process.stderr.write(`${getMessages(lang).langWindowsUnsupported(lang)}\n`);
        process.exitCode = 1;
        return;
      }
      const { rcPath } = await applyLanguageToRc(lang, {
        shell: process.env.SHELL,
        home: homedir(),
      });
      // The confirmation message is shown in the target language; the user must confirm before the shell restarts.
      const m = getMessages(lang);
      process.stdout.write(`${m.langSet(lang, rcPath)}\n`);
      const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      if (interactive && (await confirmYes(m.langRestartConfirm()))) {
        process.stdout.write(`${m.langRestart()}\n`);
        restartShell(lang);
      } else {
        process.stdout.write(`${m.langRestartHint(rcPath)}\n`);
      }
    });
}

/** Interactive y/N confirmation; Ctrl-C (SIGINT) or input stream EOF/close are both treated as no, to avoid hanging. */
function confirmYes(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      process.off("SIGINT", onSigint);
      rl.close();
      resolve(value);
    };
    const onSigint = () => finish(false);
    process.once("SIGINT", onSigint);
    rl.on("close", () => finish(false));
    rl.question(prompt, (answer) => finish(parseApprovalAnswer(answer) === "allow"));
  });
}

function parseIntArg(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid integer: ${value}`);
  }
  return n;
}

function parseFloatArg(value: string): number {
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return n;
}
