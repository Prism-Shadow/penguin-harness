/**
 * `penguin plugin` — the plugins installed on the server: what the Plugins page's admin does,
 * for an Agent in a conversation or a script.
 *
 *   penguin plugin list [--project-id <id>] [--json] [--server <url>]
 *   penguin plugin install <specifier> [--overwrite] [--project-id <id>] [--json] [--server <url>]
 *   penguin plugin remove <name> [--project-id <id>] [--json] [--server <url>]
 *
 * `<specifier>` is an npm package name (`@scope/name`, `name@1.2.3`), an https link to a git
 * repository or a tarball (`https://github.com/o/r`, `github:o/r#tag`) — the server checks it and
 * installs it into its data root with npm — or a local package directory: a directory holding a
 * package.json (it wins over a name of the same spelling). A directory is read here first with the
 * plugin library's own reader (a package the library would refuse is reported and nothing is
 * sent), zipped without `node_modules`, `.git`, `.npmrc` or symlinks under one top-level
 * directory, and uploaded through the zip route the Plugins page's upload uses; another version of
 * the package on the server is replaced only with `--overwrite`. This is how an Agent installs a
 * package it built — a foreign plugin ported by the `plugin-porting` skill — since the server
 * never reads a path of its own disk.
 *
 * Installing and removing are an admin's: the CLI calls with the server's local API token, which
 * is the admin's — the authority an Agent's other `penguin` commands carry. A package of Skills,
 * hooks or MCP servers joins the plugin library (it is installed on Agents from there); a package
 * of server modules is also listed in the Project's plugins and loaded, which stops the agent runs
 * in progress on that server. After a directory install, each MCP server the package carries is
 * printed with its transport and its target — a URL the server connects to, or a command it runs.
 *
 * `list` shows both: the server modules the Project lists, with their state on this server, and
 * the packages of Skills, hooks or MCP servers installed on the server.
 * Docs: /docs/cli § "penguin plugin".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { zipSync } from "fflate";
import {
  libraryParts,
  readLibraryPackage,
  readPluginPackage,
  resolveMCPServer,
} from "@prismshadow/penguin-core";
import type { PluginMcpServer } from "@prismshadow/penguin-core";
import type {
  InstalledPlugin,
  InstalledPluginsResponse,
  PluginLibraryResponse,
} from "@prismshadow/penguin-server/api";
import { ApiError, resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const installedPath = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/plugins/installed`;

/** The server's caps on an uploaded package (its services/plugin-archive.ts), checked before anything is sent. */
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_BYTES = 14 * 1024 * 1024;

/** Never part of an uploaded package: what an install resolves, a checkout's history, npm's own configuration (the server refuses a zip carrying one). */
const LEFT_OUT = new Set(["node_modules", ".git", ".npmrc"]);

/** One listed server module's state on this server, in words. */
function moduleState(t: Messages, row: InstalledPlugin): string {
  if (row.here === false) return t.plugin.elsewhere();
  if (row.active) return t.plugin.active();
  if (row.error !== undefined) return t.plugin.failed(row.error);
  return t.plugin.pending();
}

/**
 * The local package directory `arg` names, or null when it names none (it is then a specifier for
 * the server): an existing directory holding a package.json — given as an absolute path, `./x`,
 * `../x`, `~/x`, or a bare name that happens to be such a directory here.
 */
export function packageDirectory(arg: string): string | null {
  const expanded =
    arg === "~" ? os.homedir() : arg.startsWith("~/") ? path.join(os.homedir(), arg.slice(2)) : arg;
  const dir = path.resolve(expanded);
  try {
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, "package.json"))
      ? dir
      : null;
  } catch {
    return null;
  }
}

/**
 * A package directory as the zip the server's upload route reads: every regular file under one
 * top-level `<rootName>/`, LEFT_OUT and symlinks skipped. Null past the server's caps — the upload
 * would be refused anyway, so nothing is sent.
 */
function zipPackage(dir: string, rootName: string): { zip: Uint8Array; files: number } | null {
  const out: Record<string, Uint8Array> = {};
  let files = 0;
  let total = 0;
  const walk = (abs: string, rel: string): boolean => {
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (LEFT_OUT.has(entry.name)) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!walk(childAbs, childRel)) return false;
      } else if (entry.isFile()) {
        // Sized before a byte is read: a file past the caps is never loaded (one over 2 GiB
        // could not be read whole at all).
        const size = fs.statSync(childAbs).size;
        files += 1;
        total += size;
        if (files > MAX_FILES || size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) return false;
        out[`${rootName}/${childRel}`] = new Uint8Array(fs.readFileSync(childAbs));
      }
    }
    return true;
  };
  if (!walk(dir, "")) return null;
  const zip = zipSync(out);
  return zip.byteLength > MAX_ZIP_BYTES ? null : { zip, files };
}

/** An MCP server's line after an install: its name, its transport and what it reaches — a URL, or the command it runs. */
function mcpServerLine(t: Messages, server: PluginMcpServer): string {
  // The library's reader resolved every server it lists, so this does not throw.
  const transport = resolveMCPServer({ name: server.name, config: server.config }).transport;
  const target =
    transport.kind === "stdio" ? [transport.command, ...transport.args].join(" ") : transport.url;
  return t.plugin.mcpServerLine(server.name, transport.kind, target);
}

/**
 * Checks a local package directory the way the server's library will read it and uploads it as a
 * zip. Throws (nothing sent) for a package the library would refuse, one that is no plugin at all,
 * or one past the caps; a 409 `plugin_exists` comes back with the way to replace it. Answers the
 * server's response and the MCP servers the package carries, as the library read them.
 */
async function uploadDirectory(
  client: ServerClient,
  t: Messages,
  projectId: string,
  dir: string,
  overwrite: boolean,
): Promise<{ res: InstalledPluginsResponse; mcpServers: PluginMcpServer[] }> {
  let name: string;
  let pluginName: string;
  let version: string;
  let mcpServers: PluginMcpServer[] = [];
  const parts = libraryParts(dir);
  const library = parts.skills || parts.hooks || parts.mcp;
  try {
    ({ name, pluginName, version } = readPluginPackage(dir).manifest);
    if (library) mcpServers = readLibraryPackage(dir).mcpServers;
  } catch (err) {
    throw new Error(t.plugin.dirRefused(dir, err instanceof Error ? err.message : String(err)));
  }
  if (!library && !fs.existsSync(path.join(dir, "ifaces.json"))) {
    throw new Error(t.plugin.dirNotPlugin(dir));
  }
  const packed = zipPackage(dir, pluginName);
  if (packed === null) throw new Error(t.plugin.dirTooLarge(dir));
  process.stderr.write(`${t.plugin.uploading(name, version, packed.files)}\n`);
  try {
    const res = await client.request<InstalledPluginsResponse>(
      "POST",
      `${installedPath(projectId)}/archive`,
      {
        dataBase64: Buffer.from(packed.zip).toString("base64"),
        ...(overwrite ? { overwrite: true } : {}),
      },
    );
    return { res, mcpServers };
  } catch (err) {
    if (err instanceof ApiError && err.code === "plugin_exists") {
      throw new Error(`${err.message}\n${t.plugin.overwriteHint()}`);
    }
    throw err;
  }
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
    .option("--overwrite", t.plugin.overwriteOpt)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (specifier: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const dir = packageDirectory(specifier);
      const { res, mcpServers } =
        dir !== null
          ? await uploadDirectory(client, t, projectId, dir, opts.overwrite === true)
          : {
              res: await client.request<InstalledPluginsResponse>(
                "POST",
                installedPath(projectId),
                { specifier },
              ),
              mcpServers: [],
            };
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
      const lines = [
        done.unchanged === true
          ? t.plugin.unchanged(done.name, done.version)
          : t.plugin.installed(done.name, done.version),
      ];
      if (done.library) lines.push(t.plugin.libraryNext());
      for (const server of mcpServers) lines.push(mcpServerLine(t, server));
      if (done.modules && done.unchanged !== true) {
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
