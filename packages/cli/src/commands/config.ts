/**
 * `penguin config` — manages a Project's model credentials, default model, model list,
 * Agent-level vault environment variables, and UI language.
 *
 *   penguin config model add --model-id <upstream id> --provider <group> [--api-key <key>] [--context-window <n>] [--thinking-level <level>] [--set-default] [--root <dir>]
 *   penguin config model default --model-id <upstream id> --provider <group> [--root <dir>]
 *   penguin config model vision --model-id <upstream id> --provider <group> [--root <dir>]
 *   penguin config model list [--root <dir>]
 *   penguin config vault set --key <name> --value <value> [--agent-id <id>] [--root <dir>]
 *   penguin config vault list [--agent-id <id>] [--root <dir>]
 *   penguin config vault remove --key <name> [--agent-id <id>] [--root <dir>]
 *   penguin config lang <en|zh>
 *
 * `--model-id` always takes the **upstream id** (the request id sent to AgentHub verbatim),
 * which together with `--provider` forms a `(provider, model_id)` paired reference —
 * **no string concatenation is ever performed**. `--provider` is **required** on all three
 * model subcommands: the group is never guessed, so `--api-key` can never land on a vendor
 * the user did not name. For `model add`, a new entry's client_type defaults according to
 * the group's semantics (not set for first-party vendors; openai for custom / self-hosted
 * groups / gateways, with the gateway's endpoint base URL pre-filled). For `model default`
 * / `model vision`, core validation raises an error when the reference is not
 * found in models. `--root` specifies the data root directory (priority: option >
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
  type ModelPricing,
  type ModelRef,
  type ProjectConfig,
  type ThinkingLevelName,
  addModel,
  catalogEntryFor,
  formatModelRef,
  getModel,
  loadAgentVault,
  loadProjectConfig,
  providerInfo,
  removeVaultEntry,
  resolveRoot,
  setDefaultModel,
  setVaultEntry,
  setVisionModel,
} from "@prismshadow/penguin-core";
import { parseApprovalAnswer } from "../approval.js";
import { getMessages, maskApiKey, type Messages } from "../i18n.js";
import { applyLanguageToRc, restartShell } from "../lang-config.js";

/** Data root directory: the `--root` option takes priority (relative paths resolved against cwd), then PENGUIN_HOME / ~/.penguin/data. */
function resolveRootOption(root: string | undefined): string {
  return root !== undefined ? path.resolve(root) : resolveRoot();
}

/** Allowed values for `--thinking-level` (mirrors core's ThinkingLevelName). */
const THINKING_LEVELS: readonly ThinkingLevelName[] = ["none", "low", "medium", "high", "xhigh"];

/**
 * Renders the model list as column-aligned lines (the default model is marked with `*`;
 * fully empty columns are omitted automatically). `provider` and `model_id` each occupy
 * their own column (stored fields, never split apart); `vision` reflects the effective
 * semantics (the TOML `vision` annotation takes priority, falling back to the catalog
 * annotation — matched by the (provider, model_id) pair — and recorded as Y under
 * "default = supported" when neither is present). Exported for unit tests.
 */
export function formatModelRows(cfg: ProjectConfig): string[] {
  const cells = cfg.models.map((entry) => {
    const cat = catalogEntryFor(entry.provider, entry.model_id);
    const vision = entry.vision ?? cat?.supportsVision ?? true;
    const isDefault =
      cfg.default_model?.provider === entry.provider &&
      cfg.default_model?.model_id === entry.model_id;
    return {
      provider: `${isDefault ? "* " : "  "}${entry.provider}`,
      model: entry.model_id,
      vision: `vision=${vision ? "Y" : "-"}`,
      context_window:
        entry.context_window !== undefined ? `context_window=${entry.context_window}` : "",
      client_type: entry.client_type ? `client_type=${entry.client_type}` : "",
      pricing: entry.pricing
        ? `price=${entry.pricing.cache_read}/${entry.pricing.cache_write}/${entry.pricing.output}`
        : "",
      api_key: `api_key=${maskApiKey(entry.api_key)}`,
      base_url: entry.base_url ? `base_url=${entry.base_url}` : "",
    };
  });
  const columns = [
    "provider",
    "model",
    "vision",
    "context_window",
    "client_type",
    "pricing",
    "api_key",
    "base_url",
  ] as const;
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

export function registerConfigCommand(program: Command, t: Messages): void {
  const config = program.command("config").description(t.config.desc);
  const model = config.command("model").description(t.config.modelDesc);

  model
    .command("add")
    .description(t.config.addDesc)
    .requiredOption("--model-id <id>", t.config.addModelId)
    .requiredOption("--provider <group>", t.config.addProvider)
    .option("--api-key <key>", t.config.addApiKey)
    .option("--base-url <url>", t.config.addBaseUrl)
    .option("--context-window <n>", t.config.addContextWindow, parseIntArg)
    .option("--thinking-level <level>", t.config.addThinkingLevel)
    .option("--client-type <type>", t.config.addClientType)
    // Tri-state: --vision marks it supported / --no-vision marks it unsupported / neither given keeps the existing value (defaults to supported).
    .option("--vision", t.config.addVision)
    .option("--no-vision", t.config.addNoVision)
    .option("--price-cache-read <n>", t.config.addPriceCacheRead, parseFloatArg)
    .option("--price-cache-write <n>", t.config.addPriceCacheWrite, parseFloatArg)
    .option("--price-output <n>", t.config.addPriceOutput, parseFloatArg)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--set-default", t.config.addSetDefault, false)
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      // Validated up front against the five levels (commander has no enum option type):
      // an invalid value must never reach the config file.
      const thinkingLevel = opts.thinkingLevel as ThinkingLevelName | undefined;
      if (thinkingLevel !== undefined && !THINKING_LEVELS.includes(thinkingLevel)) {
        process.stderr.write(
          `${t.error(`--thinking-level must be one of ${THINKING_LEVELS.join(" / ")}: got "${thinkingLevel}".`)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const root = resolveRootOption(opts.root);
      // --model-id takes the upstream id, paired with the required --provider as a
      // reference; the group is never guessed, so --api-key can only ever land on the
      // vendor the user named. No concatenation is performed.
      const modelId: string = opts.modelId;
      const provider: string = opts.provider;
      const ref: ModelRef = { provider, model_id: modelId };
      const before = await loadProjectConfig(root, opts.projectId);
      const existed = getModel(before, ref) !== undefined;
      // client_type default rule, only injected for new entries (updating an
      // existing entry never overrides an explicit config): not set for first-party
      // vendor groups (AgentHub auto-routes by upstream id, with env fallback keyed on
      // id); defaults to openai for custom / self-hosted / gateway groups, with the
      // gateway's endpoint base URL pre-filled as well.
      const pInfo = providerInfo(provider);
      const openAiDefault =
        pInfo === undefined || pInfo.id === "custom" || pInfo.gatewayBaseUrl !== undefined;
      const clientType: string | undefined =
        opts.clientType ?? (!existed && openAiDefault ? "openai" : undefined);
      const baseUrl: string | undefined =
        opts.baseUrl ?? (!existed ? pInfo?.gatewayBaseUrl : undefined);
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
          ...(thinkingLevel !== undefined ? { thinking_level: thinkingLevel } : {}),
          ...(clientType !== undefined ? { client_type: clientType } : {}),
          ...(opts.vision !== undefined ? { vision: opts.vision } : {}),
          ...(Object.keys(pricing).length > 0 ? { pricing } : {}),
          ...(opts.apiKey !== undefined ? { api_key: opts.apiKey } : {}),
          ...(baseUrl !== undefined ? { base_url: baseUrl } : {}),
        },
        { setDefault: Boolean(opts.setDefault) },
      );
      const defaultRef = cfg.default_model && formatModelRef(cfg.default_model);
      const line = existed
        ? t.modelUpdated(formatModelRef(ref), defaultRef)
        : t.modelAdded(formatModelRef(ref), defaultRef);
      process.stdout.write(`${line}\n`);
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
        process.stderr.write(`${t.error(err instanceof Error ? err.message : String(err))}\n`);
        process.exitCode = 1;
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
        process.stderr.write(`${t.error(err instanceof Error ? err.message : String(err))}\n`);
        process.exitCode = 1;
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
      if (cfg.models.length === 0) {
        process.stdout.write(`${t.modelListEmpty()}\n`);
        return;
      }
      process.stdout.write(`${t.modelListTitle()}\n`);
      for (const line of formatModelRows(cfg)) {
        process.stdout.write(`${line}\n`);
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
