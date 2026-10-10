/**
 * `penguin plugin` — the plugins installed on the server: what the Plugins page's admin does,
 * for an Agent in a conversation or a script.
 *
 *   penguin plugin list [--project-id <id>] [--json] [--server <url>]
 *   penguin plugin install <specifier> [--project-id <id>] [--json] [--server <url>]
 *   penguin plugin remove <name> [--project-id <id>] [--json] [--server <url>]
 *
 * `<specifier>` is an npm package name (`@scope/name`, `name@1.2.3`) or an https link to a git
 * repository or a tarball (`https://github.com/o/r`, `github:o/r#tag`); the server checks it and
 * installs it into its data root with npm. Installing and removing are an admin's: the CLI
 * calls with the server's local API token, which is the admin's — the authority an Agent's
 * other `penguin` commands carry. A package of Skills or hooks joins the plugin library (it is
 * installed on Agents from there); a package of server modules is also listed in the Project's
 * plugins and loaded, which stops the agent runs in progress on that server.
 *
 * `list` shows both: the server modules the Project lists, with their state on this server, and
 * the packages of Skills or hooks installed on the server.
 * Docs: /docs/cli § "penguin plugin".
 */
import type { Command } from "commander";
import type {
  InstalledPlugin,
  InstalledPluginsResponse,
  PluginLibraryResponse,
} from "@prismshadow/penguin-server/api";
import { resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const installedPath = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/plugins/installed`;

/** One listed server module's state on this server, in words. */
function moduleState(t: Messages, row: InstalledPlugin): string {
  if (row.here === false) return t.plugin.elsewhere();
  if (row.active) return t.plugin.active();
  if (row.error !== undefined) return t.plugin.failed(row.error);
  return t.plugin.pending();
}

export function registerPluginCommand(program: Command, t: Messages): void {
  const plugin = program.command("plugin").description(t.plugin.desc);

  plugin
    .command("list")
    .alias("ls")
    .description(t.plugin.listDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const [listed, library] = await Promise.all([
        client.request<InstalledPluginsResponse>("GET", installedPath(projectId)),
        client.request<PluginLibraryResponse>("GET", "/api/plugins"),
      ]);
      const installed = library.groups
        .flatMap((g) => g.plugins)
        .filter((p) => p.source === "installed");
      if (opts.json === true) {
        process.stdout.write(
          `${JSON.stringify({ modules: listed.plugins, library: installed })}\n`,
        );
        return;
      }
      const rows = [
        ...listed.plugins.map((row) => [
          row.specifier,
          t.plugin.kindModules(),
          moduleState(t, row),
        ]),
        ...installed.map((p) => [p.package, t.plugin.kindLibrary(), `v${p.version}`]),
      ];
      if (rows.length === 0) {
        process.stdout.write(`${t.plugin.none()}\n`);
        return;
      }
      process.stdout.write(
        renderTable([t.plugin.colName(), t.plugin.colKind(), t.plugin.colState()], rows),
      );
    });

  plugin
    .command("install <specifier>")
    .description(t.plugin.installDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (specifier: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const res = await client.request<InstalledPluginsResponse>("POST", installedPath(projectId), {
        specifier,
      });
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      const done = res.installed;
      // A plugin the build ships installs without npm: the list is all that changed.
      if (done === undefined) {
        process.stdout.write(`${t.plugin.listedOnly(specifier, projectId)}\n`);
        return;
      }
      const lines = [t.plugin.installed(done.name, done.version)];
      if (done.library) lines.push(t.plugin.libraryNext());
      if (done.modules) {
        lines.push(res.restartPending ? t.plugin.restartNext() : t.plugin.modulesLoaded(projectId));
      }
      process.stdout.write(`${lines.join("\n")}\n`);
    });

  plugin
    .command("remove <name>")
    .description(t.plugin.removeDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (name: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const res = await client.request<InstalledPluginsResponse>(
        "DELETE",
        `${installedPath(projectId)}?specifier=${encodeURIComponent(name)}`,
      );
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      process.stdout.write(`${t.plugin.removed(name)}\n`);
    });
}
