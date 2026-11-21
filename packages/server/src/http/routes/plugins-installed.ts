/**
 * The plugins a PROJECT asks for, and which of them this process is actually running:
 *
 *   GET    /                      this Project's list, joined with what the process runs,
 *                                 plus which plugins the build ships (any member)
 *   POST   / { specifier,         npm-install the package if this server runs it and the build
 *            machineId? }         does not ship it, add it to this Project's shared table — or
 *                                 to that machine's own table — and apply (admin). The specifier
 *                                 is a registry name, or an https link to a git repository or a
 *                                 tarball (plugin/source.ts), which installs here only
 *   POST   /archive               install an uploaded package zip on this server (admin); 409
 *          { dataBase64,          plugin_exists when another version is installed, unless
 *            overwrite? }         `overwrite`
 *   PUT    / { plugins }          rewrite this Project's shared table, and apply (admin)
 *   DELETE /?specifier=…          drop it from every table of this Project — or, with
 *          [&machineId=…]         `machineId`, from that machine's own table — and apply (admin);
 *                                 the package leaves the disk once nothing lists it here
 *
 * WHAT A TABLE LISTS is server modules: a package of Skills, hooks or MCP servers alone is the
 * library's (core lists every package of the prefix that carries them), installed into Agents
 * rather than loaded, so installing one writes no table. And a package from a link or a zip is
 * listed in THIS machine's own table, never the shared one: another machine handed its name
 * would fetch whatever the registry has under that name.
 *
 * WHAT IS REFUSED after the fact: the prefix resolves before the shipped plugins, so a package
 * under the name of a module the build ships would replace it for every Project — a zip saying
 * so is refused before it installs, and a link (whose name npm reads) is removed again; so is a
 * package that turns out to be no plugin at all. The refusal says that its install scripts have
 * already run.
 *
 * WHERE THE LIST LIVES. In the Project's own config (the `[plugins]` table of `.project_config.toml`,
 * package name → requirement, Cargo's `[dependencies]` shape, plus a `[plugins.<machineId>]`
 * table for what one machine runs besides — PluginTables in core),
 * beside its models — because machines are lent to Projects, so a Project's list is what
 * says which machines a plugin has to reach (PRFC-0010). The data root's old `plugins.json`
 * is not read any more, deliberately without a migration: a deployment that had one starts
 * with no plugins until each Project asks again.
 *
 * WHAT ACTUALLY RUNS is the CLOSURE — the union over this root's Projects — because loading
 * is per process: there is one module tree. So a plugin any Project asks for is in the tree,
 * and what it contributes is visible to all of them. A row here is therefore "this Project
 * asked for it" joined with "the process has it", which are two different facts.
 *
 * APPLYING. A write asks the App to re-assemble itself (the platform's own `Reassembly`,
 * hmr/platform.ts): the new create() reads the closure and imports what it names — no
 * process restart, ptys and connections delivered across it exactly as a push delivers
 * them, and the Agent state with them (PRFC-0015): the bundle is the same, so its shape is
 * too, and running Tasks, pending approvals and queued follow-ups go on in every Project. What
 * the new App rebuilds is the scheduler and the messaging bridge. The edit itself travels with
 * the re-assembly (ReassemblyChange, services/plugin-tables.ts): written in its queue, so two
 * admins' edits of one file never interleave, and undone when the new tree fails to boot — the
 * previous App is restored on the previous list, and the answer is "did not take".
 *
 * MODULES OF LIBRARY PLUGINS. A library plugin that also ships server modules is listed here by
 * an Agent install too, in this server's own table (services/plugin-modules.ts, PRFC-0031); the
 * view answers how each such module stands for the Project (`modules`).
 */
import { Hono } from "hono";
import path from "node:path";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type {
  InstalledPlugin,
  InstalledPluginsResponse,
  PluginInstallOutcome,
  PluginModuleStatus,
  UnsatisfiedPlugin,
} from "../../api/types.js";
import { HttpError } from "../errors.js";
import { eventStream } from "../event-stream.js";
import { readJson, requireString, requireValidId } from "../validate.js";
import type { DatabaseSync } from "node:sqlite";
import {
  effectivePluginTable,
  libraryParts,
  PLUGIN_MACHINE_ID,
  type PluginRequirement,
  type PluginTables,
} from "@prismshadow/penguin-core";
import type { Config, Db, Hmr, Reassembly, ReassemblyChange } from "../../hmr/capabilities.js";
import {
  discoverBuiltinPlugins,
  PACKAGE_NAME,
  loadPlugins,
  PLUGINS_FILE,
  pluginBases,
  readPluginClosure,
  readPluginDeclaration,
} from "../../plugin/loader.js";
import type { ModuleActor, PluginModules, PluginPackages } from "../../mechanisms/plugins.js";
import { pluginTableEdits } from "../../services/plugin-tables.js";
import {
  currentNpmRegistry,
  installedPackageDir,
  linkPluginDirectory,
  linkedPackages,
  PluginInstallError,
  pluginsPrefix,
  readInstalledVersion,
  type InstalledPackage,
} from "../../plugin/install.js";
import { indexChannelLookup, type IndexChannel } from "../../plugin/registry.js";
import { IndexSources } from "../../plugin/index-config.js";
import { parsePluginSource, type PluginSource } from "../../plugin/source.js";
import { parsePluginArchive } from "../../services/plugin-archive.js";
import {
  integrityOf,
  offlineArchiveFor,
  offlineArchives,
  type OfflineArchive,
} from "../../plugin/offline-archives.js";
import { PluginHost, pluginHostFrom, PLUGINS_RESOURCE_ID } from "../../plugin/host.js";
import { Access, ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { Machines } from "../../machines/service.js";
import { MachinesRepo } from "@prismshadow/penguin-library-machine/machine";

/** How a channel install reports its download as it runs: bytes received, the total when known. */
export type InstallProgress = (received: number, total: number | null) => void;

/** Where an install is getting the package from, as the install stream's `stage` events say. */
export type InstallSource = "registry" | "link" | "channel" | "offline";

/** A step of an install, as the stream reports it (05 「安装从不卡住」). */
export type InstallStage = { stage: "installing"; source: InstallSource } | { stage: "loading" };

/**
 * A failure of `installNamedOrChanneled`: npm's words, then what the fallback said, as one message
 * (what the CLI prints), keeping why npm failed, which registry it named, npm's words alone and the
 * fallback's alone (what the route leads with).
 */
function failureLike(
  err: PluginInstallError,
  fallback: string,
  worthSaying = true,
): PluginInstallError {
  const out = new PluginInstallError(`${err.message}. ${fallback}`);
  if (err.reason !== undefined) out.reason = err.reason;
  if (err.registry !== undefined) out.registry = err.registry;
  out.npmSaid = err.message;
  if (worthSaying) out.fallback = fallback;
  // An install made without npm said it in its own words; what is added keeps them its own.
  if (err.withoutNpm === true) out.withoutNpm = true;
  return out;
}

/**
 * Installs by name or link, npm first. A name npm cannot serve can still come from two places,
 * in this order:
 *
 * - The OFFLINE ARCHIVE the build carries for it (plugin/offline-archives.ts) — when npm answered
 *   that the package or version is not on the registry ("unavailable"), could not reach the
 *   registry ("unreachable"), or is not on this machine at all ("missing"). Its bytes are checked
 *   against the sha512 recorded beside them before anything installs.
 * - The published index's github release channel for the version asked for — only when npm
 *   answered "unavailable": a channel is not the answer to a registry that refused, a dependency
 *   that will not resolve or a script that died. Its asset is fetched, sha512-verified and
 *   installed (installPluginChannel); a channel listed without an integrity is a refusal with the
 *   reason, and an entry with no channel leaves npm's failure as the answer, naming that the
 *   index had nothing to fall through to either.
 *
 * Everything surfaces as a PluginInstallError that keeps npm's reason, which the route renders as
 * a specific refusal. `onProgress` rides along to the channel install only — npm's own downloads
 * are npm's to report; `onStage` hears each source as it is tried.
 */
export async function installNamedOrChanneled(
  root: string,
  source: PluginSource,
  io: {
    install: (root: string, spec: string) => Promise<InstalledPackage>;
    channelOf?: (
      name: string,
      version?: string,
    ) => Promise<{ channel: IndexChannel | null; fault: string | null }>;
    installChannel: (
      root: string,
      channel: IndexChannel,
      opts?: { onProgress?: InstallProgress },
    ) => Promise<InstalledPackage>;
    onProgress?: InstallProgress;
    /** The offline archive an install of the name may come from, or null. */
    offline?: (name: string, version?: string) => OfflineArchive | null;
    installTarball?: (root: string, file: string, name: string) => Promise<InstalledPackage>;
    onStage?: (stage: InstallStage) => void;
  },
): Promise<InstalledPackage> {
  io.onStage?.({ stage: "installing", source: source.kind === "name" ? "registry" : "link" });
  try {
    return await io.install(root, source.spec);
  } catch (err) {
    if (!(err instanceof PluginInstallError) || source.kind !== "name") throw err;
    const archive =
      err.reason === "unavailable" || err.reason === "unreachable" || err.reason === "missing"
        ? (io.offline?.(source.name, source.version) ?? null)
        : null;
    if (archive !== null && io.installTarball !== undefined) {
      io.onStage?.({ stage: "installing", source: "offline" });
      const { file, integrity } = await archive.tarball();
      if ((await integrityOf(file)) !== integrity) {
        throw failureLike(
          err,
          `The offline archive of ${archive.name} ${archive.version} does not match the sha512 recorded with it, so it was not used.`,
        );
      }
      try {
        return await io.installTarball(root, file, archive.name);
      } catch (offlineErr) {
        if (offlineErr instanceof PluginInstallError) {
          throw failureLike(err, `Its offline archive: ${offlineErr.message}`);
        }
        throw offlineErr;
      }
    }
    if (err.reason !== "unavailable") throw err;
    const resolved = (await io.channelOf?.(source.name, source.version)) ?? {
      channel: null,
      fault: null,
    };
    if (resolved.fault !== null) {
      throw failureLike(err, resolved.fault);
    }
    if (resolved.channel === null) {
      throw failureLike(
        err,
        `The published plugin index lists no installable github channel for ${source.name} either.`,
        false,
      );
    }
    io.onStage?.({ stage: "installing", source: "channel" });
    try {
      return await io.installChannel(root, resolved.channel, { onProgress: io.onProgress });
    } catch (channelErr) {
      if (channelErr instanceof PluginInstallError) {
        throw failureLike(err, `Its index channel: ${channelErr.message}`);
      }
      throw channelErr;
    }
  }
}

export interface InstalledPluginsDeps {
  root: string;
  /** This server's own machine id: the `[plugins.<machineId>]` table that is its own. */
  machineId: string;
  /** The current version's assets, where the builtin plugins a push carried live. */
  assetsDir: () => string | null;
  /** What the process's plugin host holds, by specifier, and what it could not load, with why. */
  running: () => {
    loaded: ReadonlySet<string>;
    skipped: ReadonlyMap<string, string>;
    /** Loaded plugins the running build cannot fully run, by specifier. */
    unsatisfied: ReadonlyMap<string, UnsatisfiedPlugin>;
  };
  projectConfig: ProjectConfigStore;
  access: Access;
  /**
   * Writes the change and re-assembles the App on it. Answers whether the running tree is
   * the new one; false when its boot failed (the change is then undone and the previous
   * App restored) or when the runtime cannot re-assemble at all (the change stays written,
   * for the restart that will read it).
   */
  apply: (change: ReassemblyChange) => Promise<boolean>;
  /** How packages reach and leave this server's prefix: npm, unless a test stands in. */
  packages: PluginPackages;
  /**
   * What the published index lists as a name's github release channel for a requested
   * version, consulted only after npm has answered that the name (or its requested version)
   * is not on the registry (indexChannelLookup); absent = no published index is configured,
   * so npm's failure is the whole answer.
   */
  channelOf?: (
    name: string,
    version?: string,
  ) => Promise<{ channel: IndexChannel | null; fault: string | null }>;
  /**
   * How a verified channel's bytes install, with the download's progress on its way in;
   * absent, the packages node installs them (with npm, or without it where there is none).
   */
  installChannel?: (
    root: string,
    channel: IndexChannel,
    opts?: { onProgress?: InstallProgress },
  ) => Promise<InstalledPackage>;
  /**
   * Hands this Project's list to the machines it uses, strict parity. Not awaited: the
   * person editing is not the one who should wait for a set of ssh tunnels — the same rule
   * the model config changes under.
   */
  syncFleet: (projectId: string) => void;
  /**
   * Links a local package directory into the prefix (`penguin plugin link`); absent in tests
   * that stand in `packages` and do not exercise links. npm's own link: `npm install <dir>`
   * records a `file:` dependency and puts the symlink in node_modules, so the link and its
   * record are npm's to keep in step. Whether the name may replace a package the build ships
   * is the route's call — the link itself only sees npm's rules.
   */
  link?: (dir: string, overwrite: boolean) => Promise<InstalledPackage>;
  /**
   * How each library plugin that ships server modules stands on this server for the Project, as
   * the viewer sees it (PRFC-0031); absent in tests that build these routes alone.
   */
  modules?: (projectId: string, viewer: ModuleActor) => Promise<PluginModuleStatus[]>;
  /**
   * The offline archives the build carries (plugin/offline-archives.ts), read per install: a
   * name npm cannot serve installs from one of them; absent = none.
   */
  offline?: () => readonly OfflineArchive[];
  /** The registry npm installs from, for the refusal's words; null = npm's own configuration. */
  registry?: () => string | null;
}

/** How long an install stream may stay silent before it sends a `ping` (the 40 s idle cut needs two missed). */
const INSTALL_BEAT_MS = 20_000;
/**
 * How long an install's answer waits for the App to re-assemble on what it listed. A module whose
 * start runs longer — a first-run download it awaited, which a module must not do — does not hold
 * the answer: the install says the module is still starting, and the swap finishes on its own.
 */
const LOAD_WAIT_MS = 60_000;

/** A registry address as a refusal names it: its host, or the address itself when it will not parse. */
function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

export function installedPluginRoutes(deps: InstalledPluginsDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const scope = (c: {
    req: { param(n: string): string | undefined };
    var: AppEnv["Variables"];
  }) => {
    const projectId = requireValidId(c as never, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return projectId;
  };

  // Reading and editing the Project's tables, shared with the plugin-modules service.
  const { tablesOf, edit, list } = pluginTableEdits(deps);

  const view = async (
    projectId: string,
    viewer: ModuleActor,
  ): Promise<InstalledPluginsResponse> => {
    const tables = await tablesOf(projectId);
    const here = effectivePluginTable(tables, deps.machineId);
    // Every name any table lists, shared ones first, then the names linked into the prefix:
    // the page shows where each one runs. A linked name no table lists is the author's row
    // before any Project asked for it — present with its disk truth, not active.
    const names = [
      ...new Set([
        ...Object.keys(tables.all),
        ...Object.values(tables.machines).flatMap((t) => Object.keys(t)),
      ]),
    ];
    // npm link's own records: the prefix manifest's `file:` dependencies naming a directory
    // whose node_modules entry exists (linkedPackages: a `file:` naming a tarball is an
    // uploaded zip's install, not a link; a dangling link stays in the table so its row
    // reports its fault).
    const links = await linkedPackages(pluginsPrefix(deps.root));
    for (const [name] of links) {
      if (!names.includes(name)) names.push(name);
    }
    const linkTable = links;
    const { loaded, skipped, unsatisfied } = deps.running();
    const bases = pluginBases(deps.root, deps.assetsDir());
    // `builtin` on a row is where the package CAME FROM, a tag, not a second way of being
    // asked for. What the package declares is read from its files; whether the process holds
    // it, and why not, is the host's — a load that failed says so, rather than passing as a
    // restart that would not help. A plugin listed only for other machines is not on this
    // one by design, so its missing files are not an error here.
    const plugins: InstalledPlugin[] = [];
    for (const specifier of names) {
      const where = {
        everywhere: specifier in tables.all,
        machines: Object.entries(tables.machines)
          .filter(([, t]) => specifier in t)
          .map(([id]) => id),
        here: specifier in here,
      };
      const declared = await readPluginDeclaration(specifier, bases);
      if ("error" in declared) {
        plugins.push({
          specifier,
          active: false,
          builtin: false,
          modules: [],
          replaces: [],
          // A link's row exists because the link exists, not because a Project asked: the
          // fault IS its disk truth, and the page reads it wherever the row shows.
          ...(where.here || linkTable.has(specifier) ? { error: declared.error } : {}),
          ...where,
        });
        continue;
      }
      // Loaded, yet this build cannot fully run it (plugin/unsatisfied.ts): left out of the
      // tree, or in it minus the contributions this build has no slot for.
      const unmet = where.here ? unsatisfied.get(specifier) : undefined;
      const active = where.here && loaded.has(specifier) && unmet?.disabled !== true;
      const failure = where.here ? skipped.get(specifier) : undefined;
      plugins.push({
        specifier,
        active,
        builtin: declared.builtin,
        modules: declared.modules,
        replaces: declared.replaces,
        ...(linkTable.has(specifier) ? { linked: true, linkPath: linkTable.get(specifier) } : {}),
        ...(!active && failure !== undefined ? { error: failure } : {}),
        ...(unmet !== undefined
          ? { unsatisfied: { disabled: unmet.disabled, reason: unmet.reason } }
          : {}),
        ...where,
      });
    }
    return {
      plugins,
      // What the build ships, asked for or not: the catalogue marks these rows "built in",
      // and asking for one is a list edit rather than a download.
      shipped: await discoverBuiltinPlugins(bases),
      file: PLUGINS_FILE,
      machineId: deps.machineId,
      // A plugin this server is asked to run that neither runs nor failed is waiting for a
      // runtime that can re-assemble the App — otherwise applying already loaded it. One
      // this build cannot run is not waiting: a restart boots the same build.
      restartPending: plugins.some(
        (p) => p.here && !p.active && p.error === undefined && p.unsatisfied === undefined,
      ),
      ...(deps.modules !== undefined ? { modules: await deps.modules(projectId, viewer) } : {}),
    };
  };

  /** Who is looking, as the module statuses need it (whether a standing request is theirs). */
  const viewerOf = (c: { var: AppEnv["Variables"] }): ModuleActor => ({
    userId: c.var.user.userId,
    isAdmin: c.var.user.isAdmin,
  });

  app.get("/", async (c) => c.json(await view(scope(c), viewerOf(c))));

  const requireAdmin = (c: { var: AppEnv["Variables"] }) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
  };

  /** A package name, as a table lists it — never a version, a path or a link. */
  const nameOf = (value: unknown): string => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!PACKAGE_NAME.test(s)) {
      throw new HttpError(400, "bad_request", "specifier must be an npm package name.");
    }
    return s;
  };

  /** What POST may install: a registry name, an https link, or a local directory to link. */
  const sourceOf = (value: unknown): PluginSource => {
    try {
      return parsePluginSource(value);
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
  };

  /** A body asking for a directory link: `linkPluginDirectory`'s overwrite, off unless asked. */
  const linkOptions = (
    body: Record<string, unknown>,
  ): { dir: string; overwrite: boolean; force: boolean } => {
    const dir = typeof body.dir === "string" ? body.dir.trim() : "";
    if (dir === "" || !path.isAbsolute(dir)) {
      throw new HttpError(
        400,
        "bad_request",
        "link needs the absolute path of a local package directory.",
      );
    }
    return { dir, overwrite: body.overwrite === true, force: body.force === true };
  };

  /** What the installer said: npm's words as npm's, an install made without npm in its own. */
  const installerSaid = (err: PluginInstallError) =>
    err.withoutNpm === true ? err.message : `npm: ${err.message}`;

  /**
   * npm's failure, as the answer: what it said, never a 500 — and, when npm could not serve the
   * name at all, said plainly first (05 「安装从不卡住」): not published yet (404 / ETARGET), or a
   * registry that did not answer, each with its own code, so the page can offer the next step.
   */
  const viaNpm = async (
    run: () => Promise<InstalledPackage>,
    asked?: PluginSource,
  ): Promise<InstalledPackage> => {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof PluginInstallError)) throw err;
      const registry = err.registry ?? deps.registry?.() ?? null;
      const where = registry !== null ? hostOf(registry) : "the npm registry";
      // The cause first, in one sentence the page can show under the card; npm's own words ride
      // along as a detail, and a fallback's only when it has something to say.
      const then = err.fallback !== undefined ? ` ${err.fallback}` : "";
      const npm = { npm: err.npmSaid ?? err.message };
      if (err.reason === "unavailable" && asked?.kind === "name") {
        const what = asked.version !== undefined ? `${asked.name}@${asked.version}` : asked.name;
        throw new HttpError(
          400,
          "plugin_not_published",
          `${what} is not published on ${where} yet.${then}`,
          undefined,
          npm,
        );
      }
      if (err.reason === "unreachable") {
        throw new HttpError(
          400,
          "plugin_source_unreachable",
          `${where} did not answer.${then}`,
          undefined,
          npm,
        );
      }
      throw new HttpError(400, "plugin_install_failed", installerSaid(err));
    }
  };

  /**
   * Installs made without npm (the marker their result carried, taken off before the answer
   * shows it): no script of theirs ran, so a refusal of one does not say it did.
   */
  const scriptless = new WeakSet<InstalledPackage>();

  /**
   * The route's install of a specifier: npm first, then the offline archive the build carries, then
   * the published index's channel (installNamedOrChanneled). `onStage` hears each source tried.
   */
  const installSpecifier = async (
    source: PluginSource,
    onProgress?: InstallProgress,
    onStage?: (stage: InstallStage) => void,
  ): Promise<InstalledPackage> => {
    const archives = deps.offline?.() ?? [];
    const { withoutNpm, ...installed } = await viaNpm(
      () =>
        installNamedOrChanneled(deps.root, source, {
          install: (root, spec) => deps.packages.install(root, spec),
          channelOf: deps.channelOf,
          installChannel: (root, channel, opts) =>
            deps.installChannel !== undefined
              ? deps.installChannel(root, channel, opts)
              : deps.packages.installChannel(root, channel, opts),
          onProgress,
          offline: (name, version) => offlineArchiveFor(archives, name, version),
          installTarball: (root, file, name) => deps.packages.installTarball(root, file, name),
          ...(onStage !== undefined ? { onStage } : {}),
        }),
      source,
    );
    if (withoutNpm === true) scriptless.add(installed);
    return installed;
  };

  /** What a package in this server's prefix is, by its table (core plugin/kinds.ts): a library plugin (Skills, hooks, MCP servers or workbenches), server modules, or both. */
  const kindsOf = (name: string): { library: boolean; modules: boolean } => {
    const parts = libraryParts(installedPackageDir(pluginsPrefix(deps.root), name));
    return {
      library: parts.skills || parts.hooks || parts.mcp || parts.workbenches,
      modules: parts.modules,
    };
  };

  /** The machine a verb is scoped to — its own table — or null for the shared table. */
  const machineOf = (value: unknown): string | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !PLUGIN_MACHINE_ID.test(value)) {
      throw new HttpError(400, "bad_request", "machineId must be a machine's own id.");
    }
    return value;
  };

  /**
   * A name a list REWRITE adds must already be on this machine — shipped with the build or
   * installed under the data root by POST, which is the verb that runs npm. Otherwise PUT
   * would be the way to list a package that is not on disk, exactly the state these routes
   * exist to avoid.
   */
  const requireOnMachine = async (names: readonly string[]) => {
    if (names.length === 0) return;
    const bases = pluginBases(deps.root, deps.assetsDir());
    for (const name of names) {
      const declared = await readPluginDeclaration(name, bases);
      if ("error" in declared) {
        throw new HttpError(
          400,
          "plugin_not_installed",
          `'${name}' is not installed on this machine; install it with POST first.`,
        );
      }
    }
  };

  /** The names of the server modules this build ships: a package under one of them would shadow it. */
  const shippedNames = () => discoverBuiltinPlugins(pluginBases(deps.root, deps.assetsDir()));

  /**
   * Takes back a package an install just put in the prefix and refuses the install: one under the
   * name of a shipped module (409 `plugin_shipped`), or one that is no plugin (400
   * `not_a_plugin`). Its install scripts have run by now, and the refusal says so — and says so
   * too when taking it back failed, which leaves it for the operator to remove. An install made
   * without npm ran nothing of the package, and the refusal says only what happened.
   */
  const refuseInstalled = async (
    installed: InstalledPackage,
    status: 400 | 409,
    code: string,
    why: string,
  ): Promise<never> => {
    const ran = !scriptless.has(installed);
    let undone = ran
      ? `It was removed again, but its install scripts had already run on the server.`
      : `It was removed again.`;
    try {
      await deps.packages.remove(deps.root, installed.name);
    } catch (err) {
      const failed = `removing it failed (${err instanceof Error ? err.message : String(err)}): remove it from ${pluginsPrefix(deps.root)} by hand.`;
      undone = ran
        ? `Its install scripts had already run on the server, and ${failed}`
        : `It is in the prefix, and ${failed}`;
    }
    throw new HttpError(status, code, `${why} ${undone}`);
  };

  /** What an install put in the prefix, checked before anything lists it (see the header). */
  const vetInstalled = async (installed: InstalledPackage) => {
    if ((await shippedNames()).includes(installed.name)) {
      return refuseInstalled(
        installed,
        409,
        "plugin_shipped",
        `${installed.name} ships with this server: a package under its name would replace it for every Project.`,
      );
    }
    const kinds = kindsOf(installed.name);
    if (!kinds.library && !kinds.modules) {
      return refuseInstalled(
        installed,
        400,
        "not_a_plugin",
        `${installed.name} is not a PenguinHarness plugin: its ifaces.json contributes no Skills, hook package, MCP servers or workbenches, and lists no server modules with a code entry (a package without an ifaces.json was never built: its build runs penguin-gen-ifaces).`,
      );
    }
    return kinds;
  };

  /** The answer to an install: the Project's list, and what landed on this server. */
  const answer = async (
    projectId: string,
    viewer: ModuleActor,
    installed: InstalledPackage | null,
    extra: Partial<PluginInstallOutcome> = {},
  ): Promise<InstalledPluginsResponse> => ({
    ...(await view(projectId, viewer)),
    ...(installed !== null
      ? { installed: { ...installed, ...kindsOf(installed.name), ...extra } }
      : {}),
  });

  /**
   * The install itself, answer and all — the verb both transports of POST run. Everything
   * that can refuse (the session, the body, npm, the vetting) refuses here, so a stream
   * answer carries exactly the errors the JSON one would have.
   */
  const performInstall = async (
    projectId: string,
    viewer: ModuleActor,
    source: PluginSource,
    machineId: string | null,
    report: { onProgress?: InstallProgress; onStage?: (stage: InstallStage) => void } = {},
  ): Promise<InstalledPluginsResponse> => {
    const runsHere = machineId === null || machineId === deps.machineId;
    // Where the package came from: the last source the chain tried is the one that served it.
    let from: InstallSource | undefined;
    const onStage = (stage: InstallStage) => {
      if (stage.stage === "installing") from = stage.source;
      report.onStage?.(stage);
    };
    /** The listing's re-assembly outlasted LOAD_WAIT_MS: the answer says the module is still starting. */
    let loading = false;
    /** Lists `name` — re-assembling the App when the tree changes, which the stream says first. */
    const listing = async (name: string, requirement: PluginRequirement, table: string | null) => {
      report.onStage?.({ stage: "loading" });
      const listed = list(projectId, name, requirement, table).then(() => "listed" as const);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const slow = new Promise<"slow">((resolve) => {
        timer = setTimeout(() => resolve("slow"), LOAD_WAIT_MS);
      });
      try {
        if ((await Promise.race([listed, slow])) === "slow") {
          loading = true;
          // It finishes, or is undone, on its own; nobody is left to tell but the log.
          listed.catch((err: unknown) =>
            console.warn(
              `[plugins] ${name}: the re-assembly after its install failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
      } finally {
        clearTimeout(timer);
      }
      deps.syncFleet(projectId);
    };
    const outcome = (): Partial<PluginInstallOutcome> => (from !== undefined ? { from } : {});
    const answered = async (installed: InstalledPackage | null) => ({
      ...(await answer(projectId, viewer, installed, outcome())),
      ...(loading ? { loading: true as const } : {}),
    });
    if (source.kind === "link") {
      // A link names no package another machine could fetch by name: it installs here, and is
      // listed for this machine alone.
      if (!runsHere) {
        throw new HttpError(
          400,
          "bad_request",
          "A link installs on this server only; install it on that machine from its own Plugins page.",
        );
      }
      const installed = await installSpecifier(source, report.onProgress, onStage);
      if ((await vetInstalled(installed)).modules) {
        await listing(installed.name, {}, deps.machineId);
      }
      return answered(installed);
    }
    // A plugin the build ships is already on the machine: asking for it is consent, not a
    // download. Everything else goes through npm — the package first, the list second, since
    // a listed plugin that is not on disk is exactly the state this route exists to avoid,
    // and npm failing must leave the deployment unchanged. A plugin asked of another machine
    // only is downloaded THERE, by that machine, when the list reaches it.
    const shipped = await shippedNames();
    const installed =
      runsHere && !shipped.includes(source.name)
        ? await installSpecifier(source, report.onProgress, onStage)
        : null;
    // A package of Skills, hooks or MCP servers alone is the library's from here on: no table
    // loads it.
    const kinds = installed !== null ? await vetInstalled(installed) : null;
    if (kinds === null || kinds.modules) {
      // `pkg@1.2.3` installs that version, and the table records it as what this Project asks
      // of the package; the key is the bare name, which is what the loader resolves.
      await listing(
        source.name,
        source.version === undefined ? {} : { version: source.version },
        machineId,
      );
    }
    return answered(installed);
  };

  app.post("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const body = await readJson(c);
    const source = sourceOf(body.specifier);
    const machineId = machineOf(body.machineId);
    if (!(c.req.header("accept") ?? "").includes("text/event-stream")) {
      return c.json(await performInstall(projectId, viewerOf(c), source, machineId));
    }
    // The same install, read as it arrives (05 「安装从不卡住」): `npm` at once, `stage` as each
    // source is tried and before the App re-assembles, `download` while a channel's bytes come
    // in (npm's own download is npm's to report), `result` the finished list. A `ping` every
    // INSTALL_BEAT_MS keeps a long install's stream from reading as dead: the event-stream
    // socket is cut after 40 s of silence (app.ts), and the page would be told the install
    // failed while it carried on. A failure that the JSON answer would have carried as a status
    // rides as an `error` event with that status, so the page raises the same error either way.
    return eventStream(c, async (sink) => {
      sink.beat(INSTALL_BEAT_MS);
      const event = (name: string, data: unknown) =>
        void sink.send(name, null, JSON.stringify(data)).catch(() => undefined);
      try {
        await sink.send("npm", null, "{}");
        const next = await performInstall(projectId, viewerOf(c), source, machineId, {
          onProgress: (received, total) => event("download", { received, total }),
          onStage: (stage) => event("stage", stage),
        });
        await sink.send("result", null, JSON.stringify(next));
      } catch (err) {
        const [status, code, message] =
          err instanceof HttpError
            ? [err.status, err.code, err.message]
            : [500, "internal_error", err instanceof Error ? err.message : String(err)];
        await sink
          .send("error", null, JSON.stringify({ status, code, message }))
          .catch(() => undefined);
      }
    });
  });

  /**
   * Links a local package directory into the prefix (`penguin plugin link`, admin). The
   * directory is vetted exactly as an install vets what it put in the prefix — a shipped
   * name, or a package that is no plugin, refuses and takes the link back out. The linked
   * package is this server's own: not listed by any Project's table, it loads only when a
   * Project asks for the name, and a Project listing it after a link resolves the author's
   * directory on this machine alone (a link names no bytes another machine could fetch).
   */
  app.post("/link", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const body = await readJson(c);
    const { dir, overwrite, force } = linkOptions(body);
    if (deps.link === undefined) {
      throw new HttpError(400, "bad_request", "linking is not available on this server.");
    }
    let linked: InstalledPackage;
    try {
      linked = await deps.link(dir, overwrite);
    } catch (err) {
      if (err instanceof PluginInstallError) {
        throw new HttpError(400, "plugin_link_refused", err.message);
      }
      throw err;
    }
    if ((await shippedNames()).includes(linked.name) && force !== true) {
      await deps.packages.remove(deps.root, linked.name);
      throw new HttpError(
        409,
        "plugin_shipped",
        `${linked.name} ships with this server: a package under its name would replace it for every Project. Pass force (penguin plugin link --force) to replace it anyway — the build's own copy returns when this link is removed.`,
      );
    }
    const kinds = kindsOf(linked.name);
    if (!kinds.library && !kinds.modules) {
      await deps.packages.remove(deps.root, linked.name);
      throw new HttpError(
        400,
        "not_a_plugin",
        `${linked.name} is not a PenguinHarness plugin: its ifaces.json contributes no Skills, hook package, MCP servers or workbenches, and lists no server modules with a code entry (a package without an ifaces.json was never built: its build runs penguin-gen-ifaces).`,
      );
    }
    return c.json(await answer(projectId, viewerOf(c), { name: linked.name, version: null }), 201);
  });

  app.post("/archive", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
    const archive = await parsePluginArchive(new Uint8Array(Buffer.from(dataBase64, "base64")));
    // The prefix resolves first: a zip under a shipped module's name would replace it.
    if ((await shippedNames()).includes(archive.name)) {
      throw new HttpError(
        409,
        "plugin_shipped",
        `${archive.name} ships with this server: a package under its name would replace it for every Project.`,
      );
    }
    const current = await readInstalledVersion(pluginsPrefix(deps.root), archive.name);
    if (current === archive.version) {
      return c.json(
        await answer(
          projectId,
          viewerOf(c),
          { name: archive.name, version: current },
          { unchanged: true },
        ),
      );
    }
    // Another version is on this server: replacing it is the admin's to confirm. The message
    // tail is what the dialog's question is built from (pinned by the route test).
    if (current !== null && body.overwrite !== true) {
      throw new HttpError(
        409,
        "plugin_exists",
        `Plugin ${archive.name} is installed at ${current}; the zip holds ${archive.version}.`,
      );
    }
    const installed = await viaNpm(() =>
      deps.packages.installFiles(deps.root, Object.fromEntries(archive.files)),
    );
    // Uploaded, so this server's alone (see the header): listed for this machine only.
    if (kindsOf(installed.name).modules) {
      await list(projectId, installed.name, {}, deps.machineId);
      deps.syncFleet(projectId);
    }
    return c.json(await answer(projectId, viewerOf(c), installed), 201);
  });

  app.delete("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const specifier = nameOf(c.req.query("specifier"));
    const machineId = machineOf(c.req.query("machineId"));
    // A link goes with this verb too: `npm uninstall` takes a `file:` dependency out the same
    // way it takes any package out — the symlink and the manifest entry both go, the author's
    // directory stays. npm's uninstall is idempotent, so is this. An uploaded zip's tarball
    // install is also a `file:` dependency, but it is not a LINK (linkedPackages leaves it
    // out) — it goes through the Project-table removal below like any install.
    if ((await linkedPackages(pluginsPrefix(deps.root))).has(specifier)) {
      if (!(await readPluginClosure(deps.root, deps.machineId)).includes(specifier)) {
        await deps.packages.remove(deps.root, specifier);
      }
      deps.syncFleet(projectId);
      return c.json(await view(projectId, viewerOf(c)));
    }
    const without = (table: PluginTables["all"] | undefined) => {
      const kept = { ...table };
      delete kept[specifier];
      return kept;
    };
    await edit(projectId, (tables) =>
      machineId === null
        ? {
            all: without(tables.all),
            machines: Object.fromEntries(
              Object.entries(tables.machines).map(([id, t]) => [id, without(t)]),
            ),
          }
        : {
            ...tables,
            machines: { ...tables.machines, [machineId]: without(tables.machines[machineId]) },
          },
    );
    // The package goes too — but only once no Project asks THIS server for it. The prefix is
    // the harness's to keep tidy; removing it while another Project still lists it would
    // break that Project at the next load.
    if (!(await readPluginClosure(deps.root, deps.machineId)).includes(specifier)) {
      try {
        await deps.packages.remove(deps.root, specifier);
      } catch (err) {
        if (err instanceof PluginInstallError) {
          throw new HttpError(500, "plugin_remove_failed", installerSaid(err));
        }
        throw err;
      }
    }
    deps.syncFleet(projectId);
    return c.json(await view(projectId, viewerOf(c)));
  });

  app.put("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const body = await readJson(c);
    const list = body.plugins;
    if (!Array.isArray(list)) {
      throw new HttpError(400, "bad_request", "plugins must be an array of package specifiers.");
    }
    // Names only, over the wire — a version is asked with POST, which installs it. A name
    // the shared table already carries was consented to when it was written and keeps what
    // the file asked of it; a NEW one must be on the machine. Machine tables are not touched:
    // this is the verb the fleet sync speaks, and what it hands over is the shared list.
    const names = list.map((value) => {
      const s = typeof value === "string" ? value.trim() : "";
      if (!PACKAGE_NAME.test(s)) {
        throw new HttpError(400, "bad_request", "plugins must be an array of package names.");
      }
      return s;
    });
    const already = await deps.projectConfig
      .getPluginTables(projectId)
      .then((t) => t.all)
      .catch(() => ({}));
    await requireOnMachine(names.filter((s) => !(s in already)));
    await edit(projectId, (tables) => ({
      ...tables,
      all: Object.fromEntries(names.map((s) => [s, tables.all[s] ?? {}])),
    }));
    deps.syncFleet(projectId);
    return c.json(await view(projectId, viewerOf(c)));
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "InstalledPluginRoutes.routes",
        prefix: "/api/projects/:projectId/plugins/installed",
        auth: "user",
        // Ahead of the catalogue group, whose "/" would otherwise answer here.
        order: 60,
      },
    ],
  },
})
export class InstalledPluginRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly sources!: IndexSources;
  @Use() private readonly reassembly!: Reassembly;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly access!: Access;
  @Use() private readonly machines!: Machines;
  @Use() private readonly db!: Db;
  @Use() private readonly packages!: PluginPackages;
  @Use() private readonly pluginModules!: PluginModules;
  @Bind("InstalledPluginRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const hmr = this.hmr;
    this.routes = installedPluginRoutes({
      root: this.config.root,
      machineId: new MachinesRepo(this.db as unknown as DatabaseSync).ownId(),
      assetsDir: () => hmr.assetsDir(),
      // Claimed per call rather than captured: the host belongs to the process, and a hot
      // swap hands the same one to the next platform.
      running: () => {
        const host = pluginHostFrom(hmr.resources);
        return {
          loaded: new Set(host.entries().keys()),
          skipped: host.skipped(),
          // A host registered by a generation older than this record has none to give.
          unsatisfied: typeof host.unsatisfied === "function" ? host.unsatisfied() : new Map(),
        };
      },
      projectConfig: this.projectConfig,
      access: this.access,
      apply: (change) => this.reassembly.reassemble(change),
      packages: this.packages,
      // The configured index sources' github channels, for a name npm has no answer for; looked
      // up only then, cached at the listing's cadence (indexChannelLookup). The sources are
      // read per lookup: the plugin-index settings group's document, changed without a restart.
      // One attempt per address, 10 s each: the install has already waited on npm, and a source
      // that does not answer must not hold the answer for the three tries a listing gives it.
      channelOf: indexChannelLookup(() => this.sources.urls(), { attempts: 1, timeoutMs: 10_000 }),
      // The plugin list rides the same trip the model config takes to a Project's machines.
      syncFleet: (projectId) => void this.machines.syncConfigEverywhere(projectId),
      // `penguin plugin link`: the npm prefix is this server's own disk, so a local directory
      // links straight into it.
      link: (dir, overwrite) => linkPluginDirectory(this.config.root, dir, overwrite),
      modules: (projectId, viewer) => this.pluginModules.status(projectId, viewer),
      // Read per install: a push moves the builtin prefix, and the archives with it.
      offline: () => offlineArchives(pluginBases(this.config.root, hmr.assetsDir())),
      registry: () => currentNpmRegistry(),
    });
  }
}
