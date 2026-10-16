/**
 * The server package's CLI commands, as data: the `cli.commands` contributions its manifest
 * declares. The five keys are the serve group the package owns — `server`, `web`, and the
 * `server` command's subcommands — and the `server` key opens its subtree to other
 * packages (a plugin may contribute `server.*`).
 *
 * This module is DATA ONLY: the CLI host reads it (through `serverCliCommands` on the
 * builtin path, or the package's generated table) to list and dispatch these commands
 * without importing the code half; the code half is `registerCliCommands` (cli/serve.ts),
 * imported on a dispatch hit alone. The summaries here are what `penguin --help` prints,
 * in both languages; the commands' other text lives in cli/messages.ts.
 *
 * The summaries are duplicated nowhere: the code half reads them back off this declaration
 * (`serverCliCommands`) when it registers, so help and the registered command cannot drift.
 */
import { moduleMetaOf, Module } from "@prismshadow/penguin-core/kernel";
import type { CliCommandEntry } from "@prismshadow/penguin-core/plugin";

/**
 * Carries the server package's `cli.commands` contributions into its generated table.
 * The entries are inline on purpose: the interface-table generator reads this literal
 * statically, and an identifier or a spread is one more thing for it to resolve.
 */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "server-cli.server",
        key: "server",
        subtree: "open",
        summary: {
          en: "Start the Web service (HTTP API and the built-in frontend, same process); subcommand reset-admin-password resets a forgotten admin password",
          zh: "启动 Web 服务（HTTP API 与内置前端，同一进程）；子命令 reset-admin-password 重置忘记的管理员密码",
        },
      },
      {
        id: "server-cli.web",
        key: "web",
        summary: {
          en: "Start the Web service and open the UI in a browser once it is ready",
          zh: "启动 Web 服务，就绪后用浏览器打开界面",
        },
      },
      {
        id: "server-cli.status",
        key: "server.status",
        summary: {
          en: "Print this data root's server state and machine id as one line of JSON",
          zh: "以单行 JSON 打印本数据根目录的服务状态与本机 id",
        },
      },
      {
        id: "server-cli.stop",
        key: "server.stop",
        summary: {
          en: "Stop the server running on this data root and report the outcome as JSON",
          zh: "停止本数据根目录上运行的服务，并以 JSON 报告结果",
        },
      },
      {
        id: "server-cli.reset-admin-password",
        key: "server.reset-admin-password",
        summary: {
          en: "Reset the Web admin account so the next server start prints a new first-login link (the server must be stopped)",
          zh: "重置 Web 管理员账号，下次启动服务时会打印新的首次登录链接（须先停止服务）",
        },
      },
    ],
  },
})
export class ServerCli {}

/** The serve group's command declarations, read back off the class the generator projects. */
export function serverCliCommands(): readonly CliCommandEntry[] {
  const contributed = moduleMetaOf(ServerCli).contributes?.["cli.commands"];
  if (contributed === undefined) {
    throw new Error("ServerCli declares no cli.commands contributions");
  }
  return contributed as readonly CliCommandEntry[];
}

/** One command's summary in the given language, for registering the real command's description. */
export function serverCliSummary(key: string, language: "en" | "zh"): string {
  const entry = serverCliCommands().find((entry) => entry.key === key);
  if (entry === undefined) throw new Error(`ServerCli declares no command keyed '${key}'`);
  return entry.summary[language];
}
