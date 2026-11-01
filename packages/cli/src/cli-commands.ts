/**
 * The CLI package's own command contributions — the same shape every package contributes
 * with. Each `@Module` class COLLECTS its command's declaration: the
 * `contributes["cli.commands"]` entry IS the help line, the one-line summary in each
 * language living only there. The classes are pure data — no methods, nothing
 * implemented; the code half is the register map below, keyed by entry id, and the
 * class's key loads it lazily on a dispatch hit. The read is cheap on purpose: the
 * classes import no command code, so discovery (which lists these summaries for help)
 * executes only the declarations.
 *
 * The host reads this package's classes in process — its bundle is the running host, the
 * meta is on the classes under `Symbol.for` keys, no table read needed — and the default
 * export is the module list the generated table's plugin declaration names, the same
 * `Plugin` shape every contributing package declares.
 */
import { Module } from "@prismshadow/penguin-core/kernel";
import type { Command } from "commander";
import {
  commandOnChain,
  type CliCommandEntry,
  type CliCommandProgram,
  type CliCommandRegisters,
  type CliContext,
  type Plugin,
} from "@prismshadow/penguin-core/plugin";
import { getMessages } from "./i18n.js";

/** The host's program, as this package's command modules type it. */
const asCommand = (program: CliCommandProgram): Command => program as Command;

/** `penguin config`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.config",
        key: "config",
        summary: { en: "Manage Project configuration", zh: "管理 Project 配置" },
      },
    ],
  },
})
export class ConfigCommand {}

/** `penguin run`. */
@Module({
  contributes: {
    "cli.commands": [
      { id: "cli.run", key: "run", summary: { en: "Run a single Task", zh: "单次运行一个 Task" } },
    ],
  },
})
export class RunCommand {}

/** `penguin chat`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.chat",
        key: "chat",
        summary: { en: "Open the interactive REPL", zh: "打开交互式 REPL" },
      },
    ],
  },
})
export class ChatCommand {}

/** `penguin session`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.session",
        key: "session",
        summary: {
          en: "Work with the project's sessions: list them, read a session's history, send it a message, rename it",
          zh: "管理 Project 的会话：列出会话、查看历史、发送消息、重命名",
        },
      },
    ],
  },
})
export class SessionCommand {}

/** `penguin agent`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.agent",
        key: "agent",
        summary: { en: "Manage the project's agents", zh: "管理 Project 的 Agent" },
      },
    ],
  },
})
export class AgentCommand {}

/** `penguin project`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.project",
        key: "project",
        summary: { en: "Manage projects", zh: "管理 Project" },
      },
    ],
  },
})
export class ProjectCommand {}

/** `penguin cost`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.cost",
        key: "cost",
        summary: {
          en: "Show token usage and cost (summary card by default; --by prints a grouped table)",
          zh: "查看 Token 用量与成本（缺省打印汇总卡片；--by 打印分组表格）",
        },
      },
    ],
  },
})
export class CostCommand {}

/** `penguin schedule`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.schedule",
        key: "schedule",
        summary: { en: "Manage scheduled tasks", zh: "管理定时任务" },
      },
    ],
  },
})
export class ScheduleCommand {}

/** `penguin org`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.org",
        key: "org",
        summary: {
          en: "Company mode: manage an organization (employees, desks, calendar, tickets, channels, finance)",
          zh: "公司模式：管理组织（员工、工位、日程、工单、频道、财务）",
        },
      },
    ],
  },
})
export class OrgCommand {}

/** `penguin browser`. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "cli.browser",
        key: "browser",
        summary: {
          en: "The agent browser: read pages, run JavaScript, click and type, import sign-ins",
          zh: "Agent 浏览器：读取页面、运行 JavaScript、点击与输入、导入登录状态",
        },
      },
    ],
  },
})
export class BrowserCommand {}

/**
 * The code half: every entry's register, keyed by its id — one line per entry, checkable
 * against the declarations above. The register imports its command module lazily (a
 * dispatch hit alone loads it), sets the description from the entry it was handed, and
 * does nothing else at registration time.
 */
export const register: CliCommandRegisters["register"] = {
  "cli.config": async (program, ctx, entry) => {
    const { registerConfigCommand } = await import("./commands/config.js");
    registerConfigCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.run": async (program, ctx, entry) => {
    const { registerRunCommand } = await import("./commands/run.js");
    registerRunCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.chat": async (program, ctx, entry) => {
    const { registerChatCommand } = await import("./commands/chat.js");
    registerChatCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.session": async (program, ctx, entry) => {
    const { registerSessionCommand } = await import("./commands/session.js");
    registerSessionCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.agent": async (program, ctx, entry) => {
    const { registerAgentCommand } = await import("./commands/agent.js");
    registerAgentCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.project": async (program, ctx, entry) => {
    const { registerProjectCommand } = await import("./commands/project.js");
    registerProjectCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.cost": async (program, ctx, entry) => {
    const { registerCostCommand } = await import("./commands/cost.js");
    registerCostCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.schedule": async (program, ctx, entry) => {
    const { registerScheduleCommand } = await import("./commands/schedule.js");
    registerScheduleCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.org": async (program, ctx, entry) => {
    const { registerOrgCommand } = await import("./commands/org.js");
    registerOrgCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
  "cli.browser": async (program, ctx, entry) => {
    const { registerBrowserCommand } = await import("./commands/browser.js");
    registerBrowserCommand(asCommand(program), getMessages(ctx.language));
    (commandOnChain(program, entry.key) as Command).description(entry.summary[ctx.language]);
  },
};

/** The package's module list: what the generated table names, what a dispatch hit loads. */
export default {
  modules: [
    ConfigCommand,
    RunCommand,
    ChatCommand,
    SessionCommand,
    AgentCommand,
    ProjectCommand,
    CostCommand,
    ScheduleCommand,
    OrgCommand,
    BrowserCommand,
  ],
} satisfies Plugin;
