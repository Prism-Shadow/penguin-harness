/**
 * PenguinHarness CLI entry point.
 *
 * Only responsible for parsing CLI input into SDK arguments and rendering the streaming
 * OmniMessage returned by the SDK.
 * Loads .env on startup (e.g. locally configured ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL).
 *
 *   penguin config model add|default ...
 *   penguin chat ...
 *   penguin run --message ...
 *   penguin server|web ...
 * Docs: packages/docs/content/cli.{zh,en}.md (site path /docs/cli).
 */
import "dotenv/config";
import { Command } from "commander";
import { VERSION } from "@prismshadow/penguin-core";
import { registerConfigCommand } from "./commands/config.js";
import { registerRunCommand } from "./commands/run.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerServeCommands } from "./commands/serve.js";
import { defaultMessages } from "./i18n.js";

// Language comes from the PENGUIN_LANG env var (default en); used consistently for
// command/option descriptions and runtime output.
const t = defaultMessages();

const program = new Command();
program
  .name("penguin")
  .description(t.cliDescription)
  .version(VERSION, "-v, --version", t.versionDesc);

registerConfigCommand(program, t);
registerRunCommand(program, t);
registerChatCommand(program, t);
registerServeCommands(program, t);

// Show help only when no subcommand is given (empty input); do not error.
program.action(() => {
  program.outputHelp();
});

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
