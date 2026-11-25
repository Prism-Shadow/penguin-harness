/**
 * `penguin config model` subcommands: add (a model or, without `--model-id`, the group's
 * connection), default, vision, list, remove — reaching the server's `/api/projects/:p/models`
 * HTTP routes via `ServerClient`.
 */
import type { Command } from "commander";
import {
  DEFAULT_PROJECT_ID,
  type ModelRef,
  canonicalClientType,
  effectiveConnection,
  formatModelRef,
  getModel,
  providerConnectionShape,
} from "@prismshadow/penguin-core";
import type { ModelsResponse, ModelUpdateEntry } from "@prismshadow/penguin-library-model";
import { fastModeProtocol } from "../../model-catalog/client-protocols.js";
import {
  fixedClientType,
  fixedClientTypeRefuses,
  providerInfo,
  unaddableModel,
  unroutableVendorModel,
} from "../../model-catalog/catalog.js";
import type { Messages } from "../i18n.js";
import {
  addGroupConnection,
  configClient,
  connectionPatch,
  projectConfigFromModelsResponse,
  refuse,
  refuseErr,
  removeGroupConnection,
  toModelUpdateEntry,
} from "./config-group.js";
import { formatGroupRows, formatModelRows } from "./config-format.js";

const enc = encodeURIComponent;

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
    .option("--server <url>", t.common.server)
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
      const client = await configClient(opts, t);
      const modelsPath = `/api/projects/${enc(opts.projectId)}/models`;
      const beforeRes = await client.request<ModelsResponse>("GET", modelsPath);
      const before = projectConfigFromModelsResponse(beforeRes);

      const modelId: string = opts.modelId;
      const provider: string = opts.provider;
      const ref: ModelRef = { provider, model_id: modelId };
      const existingInfo = beforeRes.models.find(
        (m) => m.provider === provider && m.modelId === modelId,
      );
      const existed = existingInfo !== undefined;
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
      const used = effectiveConnection(
        { provider, modelId, clientType: clientType ?? undefined },
        group,
      );
      if (!existed && unroutableVendorModel(provider, modelId, used.clientType)) {
        refuse(t, t.modelNotRoutable(formatModelRef(ref)));
        return;
      }
      if (!existed && unaddableModel(provider, modelId)) {
        refuse(t, t.modelNotAddable(formatModelRef(ref), pInfo?.label ?? provider));
        return;
      }

      const contextWindow = opts.contextWindow ?? existingInfo?.contextWindow;
      const mergedMaxTokens = maxTokens ?? existingInfo?.maxTokens;
      const mergedClientType =
        clientType === null
          ? undefined
          : canonicalClientType((clientType ?? existingInfo?.clientType)?.trim());
      const vision = opts.vision ?? existingInfo?.vision;
      const fastMode = (opts.fastMode ?? existingInfo?.fastMode) === true ? true : undefined;
      const hasPriceFlag =
        opts.priceCacheRead !== undefined ||
        opts.priceCacheWrite !== undefined ||
        opts.priceOutput !== undefined;
      const mergedPricing =
        hasPriceFlag || existingInfo?.pricing !== undefined
          ? {
              cacheRead: opts.priceCacheRead ?? existingInfo?.pricing?.cacheRead ?? 0,
              cacheWrite: opts.priceCacheWrite ?? existingInfo?.pricing?.cacheWrite ?? 0,
              output: opts.priceOutput ?? existingInfo?.pricing?.output ?? 0,
            }
          : undefined;
      const baseUrl =
        patch.base_url !== undefined
          ? patch.base_url === null || patch.base_url.trim() === ""
            ? null
            : patch.base_url.trim()
          : existingInfo?.credential?.baseUrl;

      const updatedEntry: ModelUpdateEntry = {
        provider,
        modelId,
        ...(existingInfo?.displayName !== undefined
          ? { displayName: existingInfo.displayName }
          : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(mergedClientType !== undefined ? { clientType: mergedClientType } : {}),
        ...(vision !== undefined ? { vision } : {}),
        ...(mergedMaxTokens !== undefined ? { maxTokens: mergedMaxTokens } : {}),
        ...(fastMode !== undefined ? { fastMode } : {}),
        ...(mergedPricing !== undefined ? { pricing: mergedPricing } : {}),
        ...(existingInfo?.discount !== undefined ? { discount: existingInfo.discount } : {}),
        ...(patch.api_key !== undefined
          ? patch.api_key === null || patch.api_key.trim() === ""
            ? { clearApiKey: true }
            : { apiKey: patch.api_key.trim() }
          : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      };

      const nextModels: ModelUpdateEntry[] = existed
        ? beforeRes.models.map((m) =>
            m.provider === provider && m.modelId === modelId ? updatedEntry : toModelUpdateEntry(m),
          )
        : [...beforeRes.models.map(toModelUpdateEntry), updatedEntry];

      let afterRes: ModelsResponse;
      try {
        afterRes = await client.request<ModelsResponse>("PUT", modelsPath, {
          models: nextModels,
          ...(opts.setDefault ? { defaultModel: { provider, modelId } } : {}),
        });
      } catch (err) {
        refuseErr(t, err);
        return;
      }
      const cfg = projectConfigFromModelsResponse(afterRes);
      const defaultRef = cfg.default_model && formatModelRef(cfg.default_model);
      const line = existed
        ? t.modelUpdated(formatModelRef(ref), defaultRef)
        : t.modelAdded(formatModelRef(ref), defaultRef);
      process.stdout.write(`${line}\n`);
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
    .option("--server <url>", t.common.server)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const ref: ModelRef = { provider: opts.provider, model_id: opts.modelId };
      try {
        const client = await configClient(opts, t);
        const modelsPath = `/api/projects/${enc(opts.projectId)}/models`;
        const before = await client.request<ModelsResponse>("GET", modelsPath);
        if (!before.models.some((m) => m.provider === ref.provider && m.modelId === ref.model_id)) {
          refuse(
            t,
            `default_model must point to a configured model: ${formatModelRef(ref)} is not in models. Use \`penguin config model list\` to see the configured models.`,
          );
          return;
        }
        await client.request("PUT", `${modelsPath}/default`, {
          provider: ref.provider,
          modelId: ref.model_id,
        });
      } catch (err) {
        refuseErr(t, err);
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
    .option("--server <url>", t.common.server)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const ref: ModelRef = { provider: opts.provider, model_id: opts.modelId };
      try {
        const client = await configClient(opts, t);
        const modelsPath = `/api/projects/${enc(opts.projectId)}/models`;
        const before = await client.request<ModelsResponse>("GET", modelsPath);
        const entry = before.models.find(
          (m) => m.provider === ref.provider && m.modelId === ref.model_id,
        );
        if (!entry) {
          refuse(
            t,
            `vision_model must point to a configured model: ${formatModelRef(ref)} is not in models. Use \`penguin config model list\` to see the configured models.`,
          );
          return;
        }
        if (entry.vision === false) {
          refuse(
            t,
            `vision_model cannot point to a model tagged as not supporting images: ${formatModelRef(ref)}.`,
          );
          return;
        }
        await client.request<ModelsResponse>("PUT", modelsPath, {
          models: before.models.map(toModelUpdateEntry),
          visionModel: { provider: ref.provider, modelId: ref.model_id },
        });
      } catch (err) {
        refuseErr(t, err);
        return;
      }
      process.stdout.write(`${t.visionModelSet(formatModelRef(ref))}\n`);
    });

  model
    .command("list")
    .description(t.config.listDesc)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--server <url>", t.common.server)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const client = await configClient(opts, t);
      const res = await client.request<ModelsResponse>(
        "GET",
        `/api/projects/${enc(opts.projectId)}/models`,
      );
      const cfg = projectConfigFromModelsResponse(res);
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
    .option("--server <url>", t.common.server)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      if (opts.modelId === undefined) {
        await removeGroupConnection(opts, t);
        return;
      }
      const ref: ModelRef = { provider: opts.provider, model_id: opts.modelId };
      const client = await configClient(opts, t);
      const modelsPath = `/api/projects/${enc(opts.projectId)}/models`;
      const beforeRes = await client.request<ModelsResponse>("GET", modelsPath);
      if (
        !beforeRes.models.some((m) => m.provider === ref.provider && m.modelId === ref.model_id)
      ) {
        process.stderr.write(`${t.modelNotConfigured(formatModelRef(ref))}\n`);
        process.exitCode = 1;
        return;
      }
      const nextModels = beforeRes.models
        .filter((m) => !(m.provider === ref.provider && m.modelId === ref.model_id))
        .map(toModelUpdateEntry);
      const afterRes = await client.request<ModelsResponse>("PUT", modelsPath, {
        models: nextModels,
      });
      const cfg = projectConfigFromModelsResponse(afterRes);
      process.stdout.write(
        `${t.modelRemoved(formatModelRef(ref), cfg.default_model && formatModelRef(cfg.default_model))}\n`,
      );
      if (beforeRes.visionModel !== undefined && afterRes.visionModel === undefined) {
        process.stdout.write(`${t.visionModelCleared()}\n`);
      }
    });
}
