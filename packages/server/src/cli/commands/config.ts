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
 * no hand-added models (isAddableGroup). Penguin Go's protocol is fixed (fixedClientType): its
 * group and entries take `--client-type mmsp` or the value they already store, and its group's
 * protocol is not cleared.
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
 *
 * The model subcommands live in config-model.ts, the group-connection side of
 * `model add`/`model remove` in config-group.ts, and the list formatting shared with their
 * tests in config-format.ts; this file holds the command tree, the Agent vault and the
 * language.
 */
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { Command } from "commander";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  loadAgentVault,
  removeVaultEntry,
  setVaultEntry,
} from "@prismshadow/penguin-core";
import { parseApprovalAnswer } from "../approval.js";
import { resolveRootOption } from "../root-option.js";
import { getMessages, maskApiKey, type Messages } from "../i18n.js";
import { applyLanguageToRc, restartShell } from "../lang-config.js";
import { registerConfigModelCommand } from "./config-model.js";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

export function registerConfigCommand(config: Command, t: Messages): void {
  registerConfigModelCommand(config.command("model").description(t.config.modelDesc), t);

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

/**
 * `penguin config`, as a contribution to the CLI's `CliCommandsModule.commands` from this
 * package; the CLI's boot collects it.
 */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.config",
        key: "config",
        summary: {
          en: "Manage Project configuration",
          zh: "管理 Project 配置",
        },
      },
    ],
  },
})
export class ConfigCommand {
  @Bind("cli.config") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerConfigCommand(node(command), ctx.messages);
      },
    };
  }
}
