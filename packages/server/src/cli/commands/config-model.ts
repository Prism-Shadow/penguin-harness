/**
 * `penguin config model` subcommands: add (a model or, without `--model-id`, the group's
 * connection), default, vision, list, remove — the parts of the command that reach the config
 * file through core's model/group operations.
 */
import type { Command } from "commander";
import {
  DEFAULT_PROJECT_ID,
  type ModelPricing,
  type ModelRef,
  addModel,
  effectiveConnection,
  formatModelRef,
  getModel,
  loadProjectConfig,
  providerConnectionShape,
  removeModel,
  setDefaultModel,
  setProviderConnection,
  setVisionModel,
} from "@prismshadow/penguin-core";
import { fastModeProtocol } from "../../model-catalog/client-protocols.js";
import {
  fixedClientType,
  fixedClientTypeRefuses,
  providerInfo,
  unaddableModel,
  unroutableVendorModel,
} from "../../model-catalog/catalog.js";
import type { Messages } from "../i18n.js";
import { resolveRootOption } from "../root-option.js";
import {
  type ConnectionFlags,
  addGroupConnection,
  connectionPatch,
  refuse,
  removeGroupConnection,
} from "./config-group.js";
import { formatGroupRows, formatModelRows } from "./config-format.js";

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

/** The model subcommands of `penguin config`, registered under the given `model` node. */
export function registerConfigModelCommand(model: Command, t: Messages): void {
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
      // Penguin Go's protocol is fixed: the models route refuses another one too.
      if (
        patch.client_type !== undefined &&
        fixedClientTypeRefuses(
          provider,
          "row",
          patch.client_type,
          getModel(before, ref)?.client_type,
        )
      ) {
        refuse(
          t,
          t.protocolFixed(providerInfo(provider)?.label ?? provider, fixedClientType(provider)!),
        );
        return;
      }
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
      // hand-added models (custom, vLLM, OpenRouter, TokenDance, SiliconFlow, Atlas Cloud,
      // Runcrate and user-defined groups) do, and every other built-in group carries its
      // catalog presets. A preset may be added back; an entry already stored is left alone.
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
}
