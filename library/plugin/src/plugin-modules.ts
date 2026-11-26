/**
 * A library plugin's server modules, brought along when the plugin is installed on an Agent
 * (PRFC-0031).
 *
 * THE TRUTH IS PER SERVER. There is one module tree per process, so "does this Agent's plugin
 * have its server module" means "does that module run in this server's tree". It is derived on
 * every read — from the plugin host and the Project tables' closure — and nothing about it is
 * stored in an Agent.
 *
 * THE RULE is plugin/module-rule.ts. Built in means: on this server the package resolves from a
 * prefix the running build ships, and its table only adds modules (`replaces` empty). Everything
 * under `<root>/plugins` is not built in, whoever published it.
 *
 * WHAT IS WRITTEN is only this server's own `[plugins.<machineId>]` table of the Project — never
 * the shared table, never another machine's — so nothing travels through the fleet sync. Nothing
 * here runs npm, fetches an address or unpacks an archive: it lists a package the loader already
 * resolves on this server. A listing that changes this server's closure re-assembles the App at
 * once, through the same queue the administrator's edits take (services/plugin-tables.ts); since
 * PRFC-0015 that hands running Tasks, pending approvals and queued follow-ups over intact.
 *
 * THE LEDGER (`plugin_module_requests`, one row per package) records who asked and what the
 * administrator decided, and every change is a log line naming its actor. It is not what runs:
 * a row whose module an administrator unlisted by hand is stale, and the next ask overwrites it.
 *
 * PREINSTALLED MODULES (PRFC-0030, plugin/preinstall.ts) are listed by Project creation
 * (`preinstall`) under the same rule, with the system as the actor; the ones a Project predates
 * were listed once at boot (preinstall-once.ts), which also seeded their ledger row. Enabling one
 * an administrator stopped lists it in every Project again. One behind a system app
 * (plugin/system-app-modules.ts) cannot be stopped: a stop answers 409, and so does any table
 * edit here that would unlist it.
 *
 * Everything this touches survives a swap — the files, the database, the channel hub, the plugin
 * host claimed per call — so the generation that started a request may finish it after `ensure`
 * re-assembled the App.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "@prismshadow/penguin-library-db";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import {
  effectivePluginTable,
  type LibraryPlugin,
  type PluginTables,
} from "@prismshadow/penguin-core";
import type { Users } from "@prismshadow/penguin-library-auth";
import { MachinesRepo } from "@prismshadow/penguin-library-machine/machine";
import type {
  Members,
  ProjectConfigStore,
  Projects,
  ServerEvent,
} from "@prismshadow/penguin-library-project";
import type {
  PluginModulePreinstalls,
  PluginModuleRequestRow,
  PluginModuleRequests,
  PluginModuleVia,
} from "@prismshadow/penguin-library-setting";
import type {
  PluginModuleAction,
  PluginModuleRequest,
  PluginModuleRequestsResponse,
  PluginModuleState,
  PluginModuleStatus,
} from "./types.js";
import type {
  PluginChannels,
  PluginClock,
  PluginHmr,
  PluginLog,
  PluginProcessConfig,
  PluginReassembly,
} from "./ports.js";
import { HttpError } from "@prismshadow/penguin-library-http/errors";
import type { ModuleActor, PluginModules } from "./mechanisms.js";
import { pluginHostFrom } from "./host.js";
import type { PluginLibrary } from "./library-module.js";
import {
  listProjectIds,
  pluginBases,
  readPluginClosure,
  readPluginDeclaration,
  type PluginBase,
} from "./loader.js";
import { moduleStep } from "./module-rule.js";
import { isBuiltin } from "./builtin.js";
import { isPreinstalled, preinstalledModules } from "./preinstall.js";
import { isSystemAppModule } from "./system-app-modules.js";
import { pluginTableEdits, withOwnListing, type PluginTableEdits } from "./plugin-tables.js";

/** What the process's plugin host holds, claimed per call: the host belongs to the process. */
interface Running {
  loaded: ReadonlySet<string>;
  skipped: ReadonlyMap<string, string>;
  unsatisfied: ReadonlyMap<string, { disabled: boolean; reason: string }>;
}

/** The requester of a row no person was behind (company mode's reconcile). */
const NOBODY = "";

const CHANGED: ServerEvent = { type: "plugin_modules_changed" };

/** Why an enable that re-assembled did not take: the platform logs the boot error itself. */
const BOOT_FAILED =
  "The server could not start with this module, so the change was undone and the previous plugins keep running.";

@Component()
export class PluginModulesService implements PluginModules {
  @Use() private readonly config!: PluginProcessConfig;
  @Use() private readonly hmr!: PluginHmr;
  @Use() private readonly reassembly!: PluginReassembly;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly db!: Db;
  @Use() private readonly library!: PluginLibrary;
  @Use() private readonly ledger!: PluginModuleRequests;
  /** Which Projects each preinstalled module was handled for (PRFC-0030). */
  @Use() private readonly preinstalls!: PluginModulePreinstalls;
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  @Use() private readonly users!: Users;
  @Use() private readonly channels!: PluginChannels;
  @Use() private readonly log!: PluginLog;
  @Use() private readonly clock!: PluginClock;
  private machineId = "";
  private tables!: PluginTableEdits;

  setup() {
    this.machineId = new MachinesRepo(this.db as unknown as DatabaseSync).ownId();
    const reassembly = this.reassembly;
    this.tables = pluginTableEdits({
      machineId: this.machineId,
      projectConfig: this.projectConfig,
      apply: (change) => reassembly.reassemble(change),
      isLocked: (pkg) => isSystemAppModule(pkg, this.bases()),
    });
  }

  async status(projectId: string, viewer: ModuleActor): Promise<PluginModuleStatus[]> {
    const plugins = this.hybrids();
    if (plugins.length === 0) return [];
    const here = await this.effective(projectId).catch(() => ({}));
    const running = this.running();
    const closure = await readPluginClosure(this.config.root, this.machineId);
    const bases = this.bases();
    const out: PluginModuleStatus[] = [];
    for (const plugin of plugins) {
      const pkg = plugin.packageName;
      const { state, reason } = stateOf(pkg, running, closure);
      const row = this.ledger.get(pkg);
      const request =
        row === null || row.decision === "enabled"
          ? undefined
          : {
              status: row.decision === null ? ("pending" as const) : ("declined" as const),
              mine: row.requestedBy === viewer.userId,
              requestedAt: row.requestedAt,
            };
      out.push({
        plugin: plugin.name,
        package: pkg,
        builtin: await isBuiltin(pkg, bases),
        state,
        listed: pkg in here,
        ...(reason !== undefined ? { reason } : {}),
        ...(request !== undefined ? { request } : {}),
      });
    }
    return out;
  }

  async ensure(
    projectId: string,
    plugins: readonly string[],
    actor: ModuleActor | null,
    ask: "install" | "explicit",
    agentId?: string,
  ): Promise<PluginModuleAction[]> {
    const actions: PluginModuleAction[] = [];
    let changed = false;
    for (const name of [...new Set(plugins)]) {
      const plugin = this.library.get(name);
      if (plugin === undefined || !plugin.modules) continue;
      try {
        const outcome = await this.ensureOne(projectId, plugin, actor, ask, agentId ?? null);
        if (outcome === null) continue;
        actions.push(outcome.action);
        changed ||= outcome.changed;
      } catch (err) {
        actions.push({
          plugin: name,
          action: "failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (changed) this.announce(projectId);
    return actions;
  }

  async preinstall(projectId: string): Promise<void> {
    try {
      const modules = await preinstalledModules(this.bases());
      if (modules.length === 0) return;
      const here = await this.effective(projectId);
      const closure = await readPluginClosure(this.config.root, this.machineId);
      const running = this.running();
      const steps = modules.map(({ package: pkg }) => ({
        pkg,
        step: moduleStep({
          listed: pkg in here,
          inClosure: closure.includes(pkg),
          running: running.loaded.has(pkg),
          builtin: true,
          declined: this.ledger.get(pkg)?.decision === "declined",
          admin: false,
          explicit: false,
          system: true,
        }),
      }));
      const listing = steps.filter((s) => s.step === "list" || s.step === "load").map((s) => s.pkg);
      // Handled, so the one-time listing at boot passes this Project over from now on (it is new,
      // not one that predates the module): listed, listed already, or stopped by the administrator.
      const handled = () => {
        for (const { package: pkg } of modules)
          this.preinstalls.record(pkg, [projectId], this.now());
      };
      if (listing.length === 0) return handled();
      const next = (tables: PluginTables) => withOwnListing(tables, this.machineId, listing);
      // One write for all of them; inside a re-assembly only when one is not in the closure yet.
      if (steps.some((s) => s.step === "load")) await this.tables.edit(projectId, next);
      else
        await this.projectConfig.setPluginTables(
          projectId,
          next(await this.tables.tablesOf(projectId)),
        );
      const listed = await this.effective(projectId);
      for (const pkg of listing) {
        this.log.line(
          pkg in listed
            ? `[plugins] module ${pkg}: listed for ${projectId} (preinstalled)`
            : `[plugins] module ${pkg}: not listed for ${projectId} (preinstalled): ${BOOT_FAILED}`,
        );
      }
      // A module that broke the boot is handled too: listed again at every boot, it would break
      // each one before the administrator could stop it.
      handled();
    } catch (err) {
      // Not recorded: the next boot's one-time listing tries this Project again.
      this.log.line(
        `[plugins] ${projectId}: the preinstalled modules were not listed, the next boot tries again: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async askForPackage(
    projectId: string,
    pkg: string,
    actor: ModuleActor,
    agentId: string | null,
  ): Promise<PluginModuleAction[]> {
    const plugin = pkg.replace(/^@[^/]+\//, "");
    const row = this.ledger.get(pkg);
    if (row !== null && row.decision === "declined") return [{ plugin, action: "blocked" }];
    if (row === null || row.decision !== null) {
      this.ledger.upsert({
        package: pkg,
        plugin,
        projectId,
        agentId,
        requestedBy: actor.userId,
        requestedAt: this.now(),
        decision: null,
        decidedBy: null,
        decidedAt: null,
        via: null,
      });
      this.say(pkg, "requested", projectId, actor.userId, null);
      this.announce(projectId);
    }
    return [{ plugin, action: "requested" }];
  }

  async requests(): Promise<PluginModuleRequestsResponse> {
    const rows = this.ledger.list();
    const running = this.running();
    const closure = await readPluginClosure(this.config.root, this.machineId);
    const bases = this.bases();
    const requests: PluginModuleRequest[] = [];
    for (const row of rows) {
      const project = row.projectId === null ? null : this.projects.findById(row.projectId);
      const projectName =
        project === null
          ? null
          : ((await this.projectConfig.getName(project.projectId).catch(() => undefined)) ??
            project.projectId);
      requests.push({
        package: row.package,
        plugin: row.plugin,
        projectId: project === null ? null : project.projectId,
        projectName,
        agentId: row.agentId,
        requestedBy: row.requestedBy,
        requestedByName:
          row.requestedBy === NOBODY
            ? null
            : (this.users.findById(row.requestedBy)?.displayName ?? null),
        requestedAt: row.requestedAt,
        decision: row.decision,
        decidedBy: row.decidedBy,
        decidedAt: row.decidedAt,
        via: row.via,
        builtin: await isBuiltin(row.package, bases),
        preinstalled: await isPreinstalled(row.package, bases),
        systemApp: await isSystemAppModule(row.package, bases),
        state: stateOf(row.package, running, closure).state,
        onServer: !("error" in (await readPluginDeclaration(row.package, bases))),
      });
    }
    return { requests, pending: rows.filter((r) => r.decision === null).length };
  }

  async decide(
    pkg: string,
    decision: "enable" | "decline",
    admin: ModuleActor,
  ): Promise<PluginModuleRequestsResponse> {
    const row = this.ledger.get(pkg);
    if (row === null) {
      throw new HttpError(404, "unknown_request", `Nobody asked this server to run ${pkg}.`);
    }
    if (decision === "decline" && (await isSystemAppModule(pkg, this.bases()))) {
      throw new HttpError(
        409,
        "system_app_module_locked",
        `${pkg} provides a system app, so its module cannot be stopped.`,
      );
    }
    const at = this.now();
    if (decision === "enable" && (await isPreinstalled(pkg, this.bases()))) {
      // A preinstalled module is every Project's (PRFC-0030): enabled again, it is listed in
      // every Project, as its one-time listing did — its seeded row names no Project at all.
      const listed = await this.listEverywhere(pkg);
      if (listed === null) throw new HttpError(409, "module_failed", BOOT_FAILED);
      this.ledger.decide(pkg, "enabled", admin.userId, at, "admin");
      this.log.line(
        `[plugins] module ${pkg}: enabled for every Project by ${admin.userId} (admin)`,
      );
      this.announce(...listed);
      return this.requests();
    }
    if (decision === "enable") {
      const projectId = row.projectId;
      if (projectId === null || this.projects.findById(projectId) === null) {
        throw new HttpError(
          409,
          "project_gone",
          `The Project that asked for ${pkg} is gone: the request can only be declined.`,
        );
      }
      // A package asked for before it was on this server (askForPackage) is installed there
      // first, by the administrator's Plugins page; until then there is nothing to list.
      if ("error" in (await readPluginDeclaration(pkg, this.bases()))) {
        throw new HttpError(
          409,
          "plugin_not_on_server",
          `${pkg} is not on this server yet: install it on the server first, then enable it.`,
        );
      }
      const took = await this.listHere(projectId, pkg);
      if (!took) throw new HttpError(409, "module_failed", BOOT_FAILED);
      const requester = row.requestedBy === NOBODY ? null : this.users.findById(row.requestedBy);
      const via: PluginModuleVia = requester !== null && !requester.isAdmin ? "approval" : "admin";
      this.ledger.decide(pkg, "enabled", admin.userId, at, via);
      this.say(pkg, "enabled", projectId, admin.userId, via);
      this.announce(projectId);
      return this.requests();
    }
    const { stillListedBy, unlisted } = await this.unlistEverywhere(pkg);
    this.ledger.decide(pkg, "declined", admin.userId, at, null);
    this.say(pkg, "declined", row.projectId, admin.userId, null);
    this.announce(row.projectId, ...unlisted);
    return {
      ...(await this.requests()),
      ...(stillListedBy.length > 0 ? { stillListedBy } : {}),
    };
  }

  /** One plugin's step and what it did; null when there was nothing to do. */
  private async ensureOne(
    projectId: string,
    plugin: LibraryPlugin,
    actor: ModuleActor | null,
    ask: "install" | "explicit",
    agentId: string | null,
  ): Promise<{ action: PluginModuleAction; changed: boolean } | null> {
    const pkg = plugin.packageName;
    const here = await this.effective(projectId);
    const closure = await readPluginClosure(this.config.root, this.machineId);
    const running = this.running();
    const builtin = await isBuiltin(pkg, this.bases());
    const row = this.ledger.get(pkg);
    const step = moduleStep({
      listed: pkg in here,
      inClosure: closure.includes(pkg),
      running: running.loaded.has(pkg) && running.unsatisfied.get(pkg)?.disabled !== true,
      builtin,
      declined: row?.decision === "declined",
      admin: actor?.isAdmin === true,
      explicit: ask === "explicit",
      system: actor === null,
    });
    const who = actor?.userId ?? NOBODY;
    const at = this.now();
    switch (step) {
      case "none":
        return null;
      case "blocked":
        return { action: { plugin: plugin.name, action: "blocked" }, changed: false };
      case "request": {
        // A second member asking for the same package finds the standing request and changes
        // nothing; an enabled row here is stale (the module is not running), so it is overwritten.
        const standing = row !== null && row.decision === null;
        if (!standing) {
          this.ledger.upsert({
            package: pkg,
            plugin: plugin.name,
            projectId,
            agentId,
            requestedBy: who,
            requestedAt: at,
            decision: null,
            decidedBy: null,
            decidedAt: null,
            via: null,
          });
          this.say(pkg, "requested", projectId, who, null);
        }
        return { action: { plugin: plugin.name, action: "requested" }, changed: !standing };
      }
      case "list":
      case "load": {
        const took =
          step === "list"
            ? await this.writeHere(projectId, pkg)
            : await this.tables.edit(projectId, (tables) =>
                withOwnListing(tables, this.machineId, [pkg]),
              );
        // False with the listing undone is a boot that failed; false with it in place is a
        // runtime that cannot re-assemble, and the restart that reads it applies it.
        if (!took && !(pkg in (await this.effective(projectId)))) {
          return {
            action: { plugin: plugin.name, action: "failed", reason: BOOT_FAILED },
            changed: false,
          };
        }
        const via: PluginModuleVia = builtin ? "builtin" : "admin";
        this.record(row, step, { pkg, plugin: plugin.name, projectId, agentId, who, at, via });
        // Listed, and the tree booted: whether the module itself came up is the host's to say.
        // Waiting for a restart is enabled too — the listing is what was asked for.
        const now = this.running();
        const unmet = now.unsatisfied.get(pkg);
        const reason = now.loaded.has(pkg)
          ? unmet?.disabled === true
            ? unmet.reason
            : undefined
          : now.skipped.get(pkg);
        return {
          action:
            reason !== undefined
              ? { plugin: plugin.name, action: "failed", reason }
              : { plugin: plugin.name, action: "enabled" },
          changed: true,
        };
      }
    }
  }

  /** The ledger after a `list` or `load`: who enabled it, and how. */
  private record(
    row: PluginModuleRequestRow | null,
    step: "list" | "load",
    next: {
      pkg: string;
      plugin: string;
      projectId: string;
      agentId: string | null;
      who: string;
      at: string;
      via: PluginModuleVia;
    },
  ): void {
    const { pkg, plugin, projectId, agentId, who, at, via } = next;
    // Listed in a second Project while it already runs as enabled: the row stands.
    if (row !== null && row.decision === "enabled" && step === "list") {
      this.say(pkg, "enabled", projectId, who, row.via);
      return;
    }
    // Somebody's standing request, met by this install: decided now, and the asker stays named.
    if (row !== null && row.decision === null) {
      const asker = row.requestedBy === NOBODY ? null : this.users.findById(row.requestedBy);
      const decidedVia: PluginModuleVia =
        via === "builtin" ? "builtin" : asker !== null && !asker.isAdmin ? "approval" : "admin";
      this.ledger.decide(pkg, "enabled", who, at, decidedVia);
      this.say(pkg, "enabled", projectId, who, decidedVia);
      return;
    }
    // No row, a stale one, or an administrator enabling a stopped module again.
    this.ledger.upsert({
      package: pkg,
      plugin,
      projectId,
      agentId,
      requestedBy: who,
      requestedAt: at,
      decision: "enabled",
      decidedBy: who,
      decidedAt: at,
      via,
    });
    this.say(pkg, "enabled", projectId, who, via);
  }

  /**
   * Lists `pkg` in this server's own table of the Project: written as it is when the package is
   * already in the closure (the tree would be the same), as a re-assembly change otherwise.
   * Answers whether the App took it.
   */
  private async listHere(projectId: string, pkg: string): Promise<boolean> {
    if (pkg in (await this.effective(projectId))) return true;
    const closure = await readPluginClosure(this.config.root, this.machineId);
    if (closure.includes(pkg)) return this.writeHere(projectId, pkg);
    const took = await this.tables.edit(projectId, (tables) =>
      withOwnListing(tables, this.machineId, [pkg]),
    );
    return took || pkg in (await this.effective(projectId));
  }

  /** Writes `pkg` into this server's own table of the Project, with no re-assembly. */
  private async writeHere(projectId: string, pkg: string): Promise<boolean> {
    const tables = await this.tables.tablesOf(projectId);
    await this.projectConfig.setPluginTables(
      projectId,
      withOwnListing(tables, this.machineId, [pkg]),
    );
    return true;
  }

  /**
   * Lists `pkg` in this server's own table of every Project that does not ask this server for it
   * yet, in one change: re-assembled only when no Project keeps it in the closure already. Each
   * Project is recorded as handled for it (PRFC-0030). Answers the Projects it listed it in, or
   * null when the App did not take it (a listing waiting for a restart took).
   */
  private async listEverywhere(pkg: string): Promise<string[] | null> {
    const root = this.config.root;
    const projectIds = await listProjectIds(root);
    const missing: string[] = [];
    for (const projectId of projectIds) {
      const tables = await this.projectConfig.getPluginTables(projectId).catch(() => null);
      if (tables === null) continue;
      if (!(pkg in effectivePluginTable(tables, this.machineId))) missing.push(projectId);
    }
    const previous = new Map<string, PluginTables>();
    const write = async () => {
      for (const projectId of missing) {
        const tables = await this.projectConfig.getPluginTables(projectId);
        previous.set(projectId, tables);
        await this.projectConfig.setPluginTables(
          projectId,
          withOwnListing(tables, this.machineId, [pkg]),
        );
      }
    };
    if (missing.length > 0) {
      if ((await readPluginClosure(root, this.machineId)).includes(pkg)) await write();
      else {
        const took = await this.reassembly.reassemble({
          write,
          undo: async () => {
            for (const [projectId, tables] of previous) {
              await this.projectConfig.setPluginTables(projectId, tables);
            }
          },
        });
        if (!took && !(await readPluginClosure(root, this.machineId)).includes(pkg)) return null;
      }
    }
    this.preinstalls.record(pkg, projectIds, this.now());
    return missing;
  }

  /**
   * Stops a module here: `pkg` leaves this server's own table of every Project, in one change,
   * re-assembled only when no shared table keeps it in the closure. Answers the Projects whose
   * shared table still lists it — those listings are the administrator's own, removed on the
   * Plugins page — and the ones whose own table it left.
   */
  private async unlistEverywhere(pkg: string): Promise<{
    stillListedBy: Array<{ projectId: string; projectName: string }>;
    /** The Projects whose own table it left. */
    unlisted: string[];
  }> {
    const root = this.config.root;
    const own: string[] = [];
    const shared: string[] = [];
    for (const projectId of await listProjectIds(root)) {
      const tables = await this.projectConfig.getPluginTables(projectId).catch(() => null);
      if (tables === null) continue;
      if (pkg in (tables.machines[this.machineId] ?? {})) own.push(projectId);
      if (pkg in tables.all) shared.push(projectId);
    }
    const stillListedBy = await Promise.all(
      shared.map(async (projectId) => ({
        projectId,
        projectName:
          (await this.projectConfig.getName(projectId).catch(() => undefined)) ?? projectId,
      })),
    );
    if (own.length === 0) return { stillListedBy, unlisted: [] };
    const previous = new Map<string, PluginTables>();
    const write = async () => {
      for (const projectId of own) {
        const tables = await this.projectConfig.getPluginTables(projectId);
        previous.set(projectId, tables);
        await this.projectConfig.setPluginTables(
          projectId,
          withoutOwn(tables, this.machineId, pkg),
        );
      }
    };
    if (shared.length > 0) {
      // A shared table keeps it in the closure: the tree is the same, nothing to re-assemble.
      await write();
      return { stillListedBy, unlisted: own };
    }
    const took = await this.reassembly.reassemble({
      write,
      undo: async () => {
        for (const [projectId, tables] of previous) {
          await this.projectConfig.setPluginTables(projectId, tables);
        }
      },
    });
    if (!took && own.some((projectId) => previous.has(projectId))) {
      const still = await readPluginClosure(root, this.machineId);
      if (still.includes(pkg)) throw new HttpError(409, "module_failed", BOOT_FAILED);
    }
    return { stillListedBy, unlisted: own };
  }

  /** The library plugins that also ship server modules; none when the library will not read. */
  private hybrids(): LibraryPlugin[] {
    try {
      return this.library.list().filter((plugin) => plugin.modules);
    } catch {
      return [];
    }
  }

  /** What this Project asks this server for: its shared table and this server's own. */
  private async effective(projectId: string): Promise<Record<string, unknown>> {
    return effectivePluginTable(await this.tables.tablesOf(projectId), this.machineId);
  }

  private running(): Running {
    const host = pluginHostFrom(this.hmr.resources);
    return {
      loaded: new Set(host.entries().keys()),
      skipped: host.skipped(),
      // A host registered by a generation older than this record has none to give.
      unsatisfied: typeof host.unsatisfied === "function" ? host.unsatisfied() : new Map(),
    };
  }

  /** Read per call: a push moves the shipped prefix to a new assets directory. */
  private bases(): PluginBase[] {
    return pluginBases(this.config.root, this.hmr.assetsDir());
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  /** The log line every change writes, naming its actor. */
  private say(
    pkg: string,
    what: "enabled" | "requested" | "declined",
    projectId: string | null,
    who: string,
    via: PluginModuleVia | null,
  ): void {
    this.log.line(
      `[plugins] module ${pkg}: ${what} for ${projectId ?? "(no Project)"} by ${who === NOBODY ? "(system)" : who}${via !== null ? ` (${via})` : ""}`,
    );
  }

  /**
   * Tells the administrator, and everyone who can see the Projects named, to read again — each
   * user once. Only to a user
   * with GET /api/events open (`peek`, never `get`). Never throws: a page reads again on its
   * next visit.
   */
  private announce(...projectIds: Array<string | null>): void {
    try {
      const audience = new Set<string>();
      for (const user of this.users.list()) if (user.isAdmin) audience.add(user.userId);
      for (const projectId of new Set(projectIds)) {
        if (projectId === null) continue;
        const owner = this.projects.findById(projectId)?.ownerUserId;
        if (owner !== undefined) audience.add(owner);
        for (const member of this.members.list(projectId)) audience.add(member.userId);
      }
      for (const userId of audience) {
        this.channels.peekUser(userId)?.publish(CHANGED, "server_event");
      }
    } catch {
      // Best effort.
    }
  }
}

/** `pkg` taken out of this server's own table. */
function withoutOwn(tables: PluginTables, machineId: string, pkg: string): PluginTables {
  const kept = { ...tables.machines[machineId] };
  delete kept[pkg];
  return { ...tables, machines: { ...tables.machines, [machineId]: kept } };
}

/** How a package's module stands here, from the host and the closure (see PluginModuleState). */
function stateOf(
  pkg: string,
  running: Running,
  closure: readonly string[],
): { state: PluginModuleState; reason?: string } {
  const unmet = running.unsatisfied.get(pkg);
  if (running.loaded.has(pkg)) {
    return unmet !== undefined
      ? { state: "unsatisfied", reason: unmet.reason }
      : { state: "running" };
  }
  const failure = running.skipped.get(pkg);
  if (failure !== undefined) return { state: "failed", reason: failure };
  return closure.includes(pkg) ? { state: "restart" } : { state: "off" };
}
