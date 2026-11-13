/**
 * The CLI's own commands, as contributions: one `@Component` per command, whose
 * `contributes["CliCommandsModule.commands"]` entry is the command's data half (its key and
 * one-line summary) and whose `@Bind(entry.id)` field is its code half. `CliCommandsModule`
 * owns the slot and collects them.
 *
 * This table is fixed by the build. The CLI bundle a push carries is the same code that
 * starts the server, so the CLI process and the server process see the same commands. A
 * plugin's commands are not here: they are contributions to the server's tree, and the CLI
 * lists and runs them through the server (plugin-cli-commands.ts).
 *
 * The host boots this module once per invocation, turns each key into its command node,
 * writes the summary as the node's description, then calls the bound register with that
 * node. A register never names its own path.
 */
import {
  Bind,
  bootModules,
  Component,
  Interface,
  moduleDefOf,
  Module,
  Provide,
} from "@prismshadow/penguin-core/kernel";
import type {
  ClassCtx,
  IfaceTable,
  ManifestTable,
  Resources,
  Slot,
} from "@prismshadow/penguin-core/kernel";
import type {
  CliCommandCode,
  CliCommandData,
  CliCommandProgram,
  CliCommandSummary,
} from "@prismshadow/penguin-core/cli";
import type { Command } from "commander";
/**
 * Five resource commands (agent/project/schedule/cost/config) are contributions from the
 * server package (they are that package's resource-API clients): their `@Component` classes
 * count into this module's slot through the CLI's generated table, and the classes come in
 * through the server's `cli` subpath.
 */
import {
  AgentCommand,
  ConfigCommand,
  CostCommand,
  ProjectCommand,
  ScheduleCommand,
} from "@prismshadow/penguin-server/cli";
import type { Messages } from "@prismshadow/penguin-server/cli";
import table from "./ifaces.json" with { type: "json" };
import { registerAuthCommand } from "./commands/auth.js";
import { registerRunCommand } from "./commands/run.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerSessionCommand } from "./commands/session.js";
import { registerPluginCommand } from "./commands/plugin.js";
import { registerOrgCommand } from "./commands/org.js";
import { registerBrowserCommand } from "./commands/browser.js";
import { registerServerCommand, registerWebCommand } from "./commands/serve.js";
import { registerResetPasswordCommand } from "./commands/reset-password.js";
import { registerStatusCommand } from "./commands/server-status.js";
import { registerStopCommand } from "./commands/server-stop.js";
import { registerExecCommand } from "./commands/exec.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerVersionCommand } from "./commands/version.js";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

/** `penguin auth`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.auth",
        key: "auth",
        summary: {
          en: "Sign in to a PenguinHarness server from the terminal",
          zh: "在终端里登录 PenguinHarness 服务",
        },
      },
    ],
  },
})
export class AuthCommand {
  @Bind("cli.auth") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerAuthCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin run`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.run",
        key: "run",
        summary: {
          en: "Run a single Task",
          zh: "单次运行一个 Task",
        },
      },
    ],
  },
})
export class RunCommand {
  @Bind("cli.run") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerRunCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin chat`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.chat",
        key: "chat",
        summary: {
          en: "Open the interactive REPL",
          zh: "打开交互式 REPL",
        },
      },
    ],
  },
})
export class ChatCommand {
  @Bind("cli.chat") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerChatCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin session`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
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
export class SessionCommand {
  @Bind("cli.session") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerSessionCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin plugin`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.plugin",
        key: "plugin",
        summary: {
          en: "Manage the plugins installed on the server (admin)",
          zh: "管理服务端安装的插件（管理员）",
        },
      },
    ],
  },
})
export class PluginCommand {
  @Bind("cli.plugin") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerPluginCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin org`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
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
export class OrgCommand {
  @Bind("cli.org") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerOrgCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin browser`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
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
export class BrowserCommand {
  @Bind("cli.browser") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerBrowserCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin server`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.server",
        key: "server",
        summary: {
          en: "Start the Web service (HTTP API and the built-in frontend, same process); subcommand reset-admin-password resets a forgotten admin password",
          zh: "启动 Web 服务（HTTP API 与内置前端，同一进程）；子命令 reset-admin-password 重置忘记的管理员密码",
        },
      },
    ],
  },
})
export class ServerCommand {
  @Bind("cli.server") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerServerCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin server reset-admin-password`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.server.reset-admin-password",
        key: "server.reset-admin-password",
        summary: {
          en: "Reset the Web admin account so the next server start prints a new first-login link (the server must be stopped)",
          zh: "重置 Web 管理员账号，下次启动服务时会打印新的首次登录链接（须先停止服务）",
        },
      },
    ],
  },
})
export class ServerResetAdminPasswordCommand {
  @Bind("cli.server.reset-admin-password") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerResetPasswordCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin server status`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.server.status",
        key: "server.status",
        summary: {
          en: "Print this data root's server state and machine id as one line of JSON",
          zh: "以单行 JSON 打印本数据根目录的服务状态与本机 id",
        },
      },
    ],
  },
})
export class ServerStatusCommand {
  @Bind("cli.server.status") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerStatusCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin server stop`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.server.stop",
        key: "server.stop",
        summary: {
          en: "Stop the server running on this data root and report the outcome as JSON",
          zh: "停止本数据根目录上运行的服务，并以 JSON 报告结果",
        },
      },
    ],
  },
})
export class ServerStopCommand {
  @Bind("cli.server.stop") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerStopCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin web`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.web",
        key: "web",
        summary: {
          en: "Start the Web service and open the UI in a browser once it is ready",
          zh: "启动 Web 服务，就绪后用浏览器打开界面",
        },
      },
    ],
  },
})
export class WebCommand {
  @Bind("cli.web") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerWebCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin exec`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.exec",
        key: "exec",
        summary: {
          en: "Run a plugin command on the server by its dotted id (`penguin exec ls` lists what the plugins contribute)",
          zh: "按点分 id 在服务端执行插件命令（`penguin exec ls` 列出各插件贡献的命令）",
        },
      },
    ],
  },
})
export class ExecCommand {
  @Bind("cli.exec") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerExecCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin update`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.update",
        key: "update",
        summary: {
          en: "Upgrade this PenguinHarness install in place",
          zh: "原地升级当前的 PenguinHarness 安装",
        },
      },
    ],
  },
})
export class UpdateCommand {
  @Bind("cli.update") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerUpdateCommand(node(command), ctx.messages);
      },
    };
  }
}

/** `penguin version`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.version",
        key: "version",
        summary: {
          en: "Show which build is running",
          zh: "显示当前运行的是哪个构建",
        },
      },
    ],
  },
})
export class VersionCommand {
  @Bind("cli.version") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerVersionCommand(node(command), ctx.messages);
      },
    };
  }
}

/** One collected command: its data half and the code half its class bound. */
export interface BuiltinCommand {
  readonly id: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly code: CliCommandCode<Messages>;
}

/** The collector's face: the CLI's commands, in contribution order (the order help lists them in). */
@Interface()
export abstract class CliCommands {
  abstract list(): readonly BuiltinCommand[];
}

/** The slot `CliCommandsModule` owns: a command's key and summary, and the code half it binds. */
export interface CliCommandsSlots {
  commands: Slot<CliCommandData, CliCommandCode<Messages>>;
}

/** Owns the `commands` slot; its children are the CLI's commands. */
@Module({
  children: [
    AuthCommand,
    ConfigCommand,
    RunCommand,
    ChatCommand,
    SessionCommand,
    AgentCommand,
    ProjectCommand,
    PluginCommand,
    CostCommand,
    ScheduleCommand,
    OrgCommand,
    BrowserCommand,
    ServerCommand,
    ServerResetAdminPasswordCommand,
    ServerStatusCommand,
    ServerStopCommand,
    WebCommand,
    ExecCommand,
    UpdateCommand,
    VersionCommand,
  ],
})
export class CliCommandsModule {
  @Provide() cliCommands!: CliCommands;
  setup({ contributions }: ClassCtx) {
    // The kernel checked each entry against the slot's data type at boot, and resolved
    // every code half by its id.
    const commands: BuiltinCommand[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
      code: c.code as CliCommandCode<Messages>,
    }));
    this.cliCommands = { list: () => commands };
  }
}

/** The commands hold no live resources, so the registry holds nothing. */
const noResources: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

/** Boots `CliCommandsModule` against this package's generated table and returns what it collected. */
export async function bootBuiltinCommands(): Promise<readonly BuiltinCommand[]> {
  const ifaces = table as unknown as IfaceTable & { modules: ManifestTable };
  const root = moduleDefOf(CliCommandsModule, { manifests: ifaces.modules });
  const tree = await bootModules(root, { ifaces, resources: noResources });
  try {
    return tree.api<CliCommands>("CliCommandsModule", "cliCommands").list();
  } finally {
    tree.dispose();
  }
}
