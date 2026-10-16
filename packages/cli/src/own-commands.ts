/**
 * The CLI package's own command contributions.
 *
 * The remaining commands stayed in this package when modularization began, but they ride
 * the same dispatch as everyone else: their data halves are the keys and summaries below
 * — what `penguin --help` prints, built from the message tables so the summary and the
 * registered description cannot drift — and their code halves are the command modules,
 * imported lazily on a dispatch hit exactly like a plugin's.
 */
import type { Command } from "commander";
import type { CliCommandEntry, CliContext } from "@prismshadow/penguin-core/plugin";
import { getMessages, type Messages } from "./i18n.js";

/** The CLI package's npm name — the package a candidate names in an ambiguity hint or `penguin exec`. */
export const OWN_CLI_PACKAGE = "@prismshadow/penguin-cli";

/** One own command's code half: the command module's register, imported on the dispatch hit. */
type OwnRegister = (program: Command, t: Messages) => void | Promise<void>;

/** The own commands, key → lazy register. Keys here, summaries below: one list, one order. */
const OWN_REGISTERS: Record<string, OwnRegister> = {
  config: async (program, t) => {
    const { registerConfigCommand } = await import("./commands/config.js");
    registerConfigCommand(program, t);
  },
  run: async (program, t) => {
    const { registerRunCommand } = await import("./commands/run.js");
    registerRunCommand(program, t);
  },
  chat: async (program, t) => {
    const { registerChatCommand } = await import("./commands/chat.js");
    registerChatCommand(program, t);
  },
  session: async (program, t) => {
    const { registerSessionCommand } = await import("./commands/session.js");
    registerSessionCommand(program, t);
  },
  agent: async (program, t) => {
    const { registerAgentCommand } = await import("./commands/agent.js");
    registerAgentCommand(program, t);
  },
  project: async (program, t) => {
    const { registerProjectCommand } = await import("./commands/project.js");
    registerProjectCommand(program, t);
  },
  cost: async (program, t) => {
    const { registerCostCommand } = await import("./commands/cost.js");
    registerCostCommand(program, t);
  },
  schedule: async (program, t) => {
    const { registerScheduleCommand } = await import("./commands/schedule.js");
    registerScheduleCommand(program, t);
  },
  benchmark: async (program, t) => {
    const { registerBenchmarkCommand } = await import("./commands/benchmark.js");
    registerBenchmarkCommand(program, t);
  },
  org: async (program, t) => {
    const { registerOrgCommand } = await import("./commands/org.js");
    registerOrgCommand(program, t);
  },
  browser: async (program, t) => {
    const { registerBrowserCommand } = await import("./commands/browser.js");
    registerBrowserCommand(program, t);
  },
};

/** The own commands' data halves, summaries straight from the message tables of both languages. */
export function ownCliEntries(): CliCommandEntry[] {
  const en = getMessages("en");
  const zh = getMessages("zh");
  const summary = (pick: (t: Messages) => string) => ({ en: pick(en), zh: pick(zh) });
  return [
    { id: "cli.config", key: "config", summary: summary((t) => t.config.desc) },
    { id: "cli.run", key: "run", summary: summary((t) => t.run.desc) },
    { id: "cli.chat", key: "chat", summary: summary((t) => t.chat.desc) },
    { id: "cli.session", key: "session", summary: summary((t) => t.session.desc) },
    { id: "cli.agent", key: "agent", summary: summary((t) => t.agent.desc) },
    { id: "cli.project", key: "project", summary: summary((t) => t.project.desc) },
    { id: "cli.cost", key: "cost", summary: summary((t) => t.cost.desc) },
    { id: "cli.schedule", key: "schedule", summary: summary((t) => t.schedule.desc) },
    { id: "cli.benchmark", key: "benchmark", summary: summary((t) => t.benchmark.desc) },
    { id: "cli.org", key: "org", summary: summary((t) => t.org.desc) },
    { id: "cli.browser", key: "browser", summary: summary((t) => t.browser.desc) },
  ];
}

/**
 * Registers the own commands' code halves — the key's command module, imported now (the
 * dispatch already hit). `undefined` registers every own command: `penguin exec` names the
 * package but not a key, and its help lists what the package contributes. Throws for a key
 * the table does not carry: matching and the table are built from the same list above, so
 * this is a programming error, not a user one.
 */
export async function registerOwnCliCommand(
  key: string | undefined,
  program: Command,
  ctx: CliContext,
): Promise<void> {
  const keys = key === undefined ? Object.keys(OWN_REGISTERS) : [key];
  if (key !== undefined && !(key in OWN_REGISTERS)) {
    throw new Error(`no CLI-own command keyed '${key}'`);
  }
  for (const one of keys) {
    await OWN_REGISTERS[one]!(program, getMessages(ctx.language));
  }
}
