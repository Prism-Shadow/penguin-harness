/**
 * The plugins a PROJECT asks for, and which of them this process is actually running:
 *
 *   GET    /                      this Project's list, joined with what the process runs,
 *                                 plus which plugins the build ships (any member)
 *   POST   / { specifier,         fetch the package into the plugin store if this server runs it
 *            machineId?,          and it is not on the machine — the index entry the ask
 *            integrity? }         resolves to, checked against that entry's integrity — add it
 *                                 to this Project's shared table (pinned to `integrity` when
 *                                 given) — or to that machine's own table — and apply (admin)
 *   PUT    / { plugins }          rewrite this Project's shared table, and apply (admin)
 *   DELETE /?specifier=…          drop it from every table of this Project — or, with
 *          [&machineId=…]         `machineId`, from that machine's own table — and apply (admin)
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
 * hmr/platform.ts): the new create() reads the closure, activates the generation it resolves
 * to (plugin/activation.ts) and imports what it names — no
 * process restart, ptys and connections delivered across it exactly as a push delivers
 * them. What a push does not deliver, this does not either: agent runs in flight are
 * stopped and pending approvals denied, in EVERY Project, because there is one tree. The
 * page says so before an admin applies a change. The edit itself travels with the
 * re-assembly (ReassemblyChange): written in its queue, so two admins' edits of one file
 * never interleave, and undone when the new tree fails to boot — the previous App is
 * restored on the previous list, and the answer is "did not take".
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type {
  InstalledPlugin,
  InstalledPluginsResponse,
  PluginIndexEntry,
  UnsatisfiedPlugin,
} from "../../api/types.js";
import { HttpError } from "../errors.js";
import { readJson, requireValidId } from "../validate.js";
import type { DatabaseSync } from "node:sqlite";
import {
  effectivePluginTable,
  PLUGIN_MACHINE_ID,
  type PluginTables,
} from "@prismshadow/penguin-core";
import type { Config, Db, Hmr, Reassembly, ReassemblyChange } from "../../hmr/capabilities.js";
import {
  PACKAGE_NAME,
  PLUGINS_FILE,
  pluginBases,
  readPluginDeclaration,
  shippedBases,
  shippedPlugins,
} from "../../plugin/loader.js";
import { PluginInstallError } from "../../plugin/install.js";
import { pickIndexEntry, satisfies } from "../../api/plugin-pick.js";
import {
  fetchIntoStore,
  PluginIntegrityMismatch,
  PluginStoreError,
  readStore,
} from "../../plugin/store.js";
import { INTEGRITY, mergeIndexes } from "../../plugin/registry.js";
import { resolveRegistries } from "./plugins.js";
import { PluginHost, pluginHostFrom, PLUGINS_RESOURCE_ID } from "../../plugin/host.js";
import { Access, ProjectConfigStore } from "../../mechanisms/projects.js";
import type { Machines } from "../../machines/service.js";
import { MachinesRepo } from "../../db/repos/machines.js";

export interface InstalledPluginsDeps {
  root: string;
  /** This server's own machine id: the `[plugins.<machineId>]` table that is its own. */
  machineId: string;
  /** The current version's assets, where the builtin plugins a push carried live. */
  assetsDir: () => string | null;
  /** The merged plugin index (plugin/registry.ts mergeIndexes): what a download is chosen from. */
  index: () => Promise<PluginIndexEntry[]>;
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
  /**
   * Hands this Project's list to the machines it uses, strict parity. Not awaited: the
   * person editing is not the one who should wait for a set of ssh tunnels — the same rule
   * the model config changes under.
   */
  syncFleet: (projectId: string) => void;
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

  const tablesOf = (projectId: string): Promise<PluginTables> =>
    deps.projectConfig.getPluginTables(projectId).catch((err: unknown) => {
      // A Project whose config will not parse cannot be answered for — its models are just
      // as unreadable — and saying "no plugins" would read as a healthy empty deployment.
      throw new HttpError(
        400,
        "invalid_plugins_file",
        `${projectId}: ${PLUGINS_FILE} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  const view = async (projectId: string): Promise<InstalledPluginsResponse> => {
    const tables = await tablesOf(projectId);
    const here = effectivePluginTable(tables, deps.machineId);
    // Every name any table lists, shared ones first: the page shows where each one runs.
    const names = [
      ...new Set([
        ...Object.keys(tables.all),
        ...Object.values(tables.machines).flatMap((t) => Object.keys(t)),
      ]),
    ];
    const { loaded, skipped, unsatisfied } = deps.running();
    const bases = pluginBases(deps.root);
    const shipped = await shippedPlugins(deps.assetsDir());
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
        // The loader's own reason first: a name activation could not place (a pin no stored
        // entry has) is not in the generation either, and "not installed" would hide why.
        const reason = skipped.get(specifier) ?? declared.error;
        plugins.push({
          specifier,
          active: false,
          builtin: false,
          modules: [],
          replaces: [],
          ...(where.here ? { error: reason } : {}),
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
        builtin: shipped.includes(specifier),
        modules: declared.modules,
        replaces: declared.replaces,
        ...(declared.version === undefined ? {} : { version: declared.version }),
        ...(!active && failure !== undefined ? { error: failure } : {}),
        ...(unmet !== undefined
          ? { unsatisfied: { disabled: unmet.disabled, reason: unmet.reason } }
          : {}),
        ...where,
      });
    }
    return {
      plugins,
      // What the build ships, asked for or not: the Plugins page marks these rows "built in",
      // and asking for one is a list edit rather than a download.
      shipped,
      file: PLUGINS_FILE,
      machineId: deps.machineId,
      platform: process.platform,
      // A plugin this server is asked to run that neither runs nor failed is waiting for a
      // runtime that can re-assemble the App — otherwise applying already loaded it. One
      // this build cannot run is not waiting: a restart boots the same build.
      restartPending: plugins.some(
        (p) => p.here && !p.active && p.error === undefined && p.unsatisfied === undefined,
      ),
    };
  };

  app.get("/", async (c) => c.json(await view(scope(c))));

  const requireAdmin = (c: { var: AppEnv["Variables"] }) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
  };

  /** A package specifier, optionally with a version range — never a path or a URL. */
  const specifierOf = (value: unknown): string => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^\s/]+)?$/.test(s)) {
      throw new HttpError(400, "bad_request", "specifier must be an npm package name.");
    }
    return s;
  };

  /** A pinned content, npm's `sha512-<base64>` integrity, or undefined when none is asked. */
  const integrityOf = (value: unknown): string | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || !INTEGRITY.test(value)) {
      throw new HttpError(
        400,
        "bad_request",
        "integrity must be npm's: sha512- and 88 base64 characters.",
      );
    }
    return value;
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
   * fetched into the plugin store by POST, which is the verb that runs npm. Otherwise PUT
   * would be the way to list a package that is not on disk, exactly the state these routes
   * exist to avoid.
   */
  const requireOnMachine = async (names: readonly string[]) => {
    if (names.length === 0) return;
    const onMachine = new Set([
      ...(await shippedPlugins(deps.assetsDir())),
      ...(await readStore(deps.root)).map((e) => e.name),
    ]);
    for (const name of names) {
      if (!onMachine.has(name)) {
        throw new HttpError(
          400,
          "plugin_not_installed",
          `'${name}' is not installed on this machine; install it with POST first.`,
        );
      }
    }
  };

  /**
   * Writes an edit of this Project's tables. When what THIS server runs changes, the edit is a
   * re-assembly change: read and written inside the re-assembly's queue, so two edits never
   * interleave, and undone — the tables as they were — when the new tree fails to boot. An
   * edit that only concerns other machines is written as it is: re-assembling would stop
   * every agent run in flight here for a tree that stays the same.
   */
  const edit = async (projectId: string, next: (tables: PluginTables) => PluginTables) => {
    const current = await tablesOf(projectId);
    const same = (a: PluginTables, b: PluginTables) =>
      JSON.stringify(effectivePluginTable(a, deps.machineId)) ===
      JSON.stringify(effectivePluginTable(b, deps.machineId));
    if (same(current, next(current))) {
      await deps.projectConfig.setPluginTables(projectId, next(current));
      return;
    }
    let previous: PluginTables | null = null;
    await deps.apply({
      write: async () => {
        previous = await deps.projectConfig.getPluginTables(projectId);
        await deps.projectConfig.setPluginTables(projectId, next(previous));
      },
      undo: async () => {
        if (previous !== null) await deps.projectConfig.setPluginTables(projectId, previous);
      },
    });
  };

  app.post("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const body = await readJson(c);
    const specifier = specifierOf(body.specifier);
    const machineId = machineOf(body.machineId);
    // A plugin the build ships is already on the machine: asking for it is consent, not a
    // download. Everything else goes through npm — the package first, the list second, since
    // a listed plugin that is not on disk is exactly the state this route exists to avoid,
    // and npm failing must leave the deployment unchanged. A plugin asked of another machine
    // only is downloaded THERE, by that machine, when the list reaches it.
    const integrity = integrityOf(body.integrity);
    const runsHere = machineId === null || machineId === deps.machineId;
    // `pkg@1.2.3` installs that version, and the table records it as what this Project asks
    // of the package; the key is the bare name, which is what the loader resolves.
    const at = specifier.lastIndexOf("@");
    const name = at > 0 ? specifier.slice(0, at) : specifier;
    const version = at > 0 ? specifier.slice(at + 1) : undefined;
    const onMachine =
      (await shippedPlugins(deps.assetsDir())).includes(name) ||
      (await readStore(deps.root)).some(
        (e) =>
          e.name === name &&
          satisfies(e.version, version) &&
          (integrity === undefined || e.integrity === integrity),
      );
    if (runsHere && !onMachine) {
      // A download is always of an index entry that names its content: the highest
      // version the ask admits (or the pinned content), fetched as that exact version and
      // compared with the entry's integrity before it enters the store.
      const pick = pickIndexEntry(await deps.index(), name, { version, integrity });
      if ("refused" in pick) throw new HttpError(400, "plugin_not_installable", pick.refused);
      const expected = pick.integrity;
      // pickIndexEntry never takes an entry without one; said here so the fetch is never unchecked.
      if (expected === undefined) {
        throw new HttpError(400, "plugin_not_installable", `'${name}' names no integrity`);
      }
      try {
        // Into the plugin store (plugin/store.ts), and nowhere else: the re-assembly the list
        // edit asks for activates a generation that links the stored entry.
        await fetchIntoStore(deps.root, `${pick.name}@${pick.version}`, {
          expected,
        });
      } catch (err) {
        if (err instanceof PluginInstallError) {
          throw new HttpError(400, "plugin_install_failed", `npm: ${err.message}`);
        }
        if (err instanceof PluginIntegrityMismatch) {
          throw new HttpError(400, "plugin_integrity_mismatch", err.message);
        }
        if (err instanceof PluginStoreError) {
          throw new HttpError(400, "plugin_store_failed", err.message);
        }
        throw err;
      }
    }
    // A pin names the content itself: activation takes that entry and no other.
    const requirement = {
      ...(version !== undefined ? { version } : {}),
      ...(integrity !== undefined ? { integrity } : {}),
    };
    await edit(projectId, (tables) =>
      machineId === null
        ? { ...tables, all: { ...tables.all, [name]: requirement } }
        : {
            ...tables,
            machines: {
              ...tables.machines,
              [machineId]: { ...tables.machines[machineId], [name]: requirement },
            },
          },
    );
    deps.syncFleet(projectId);
    return c.json(await view(projectId));
  });

  app.delete("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const specifier = specifierOf(c.req.query("specifier"));
    const machineId = machineOf(c.req.query("machineId"));
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
    // Nothing is uninstalled: the re-assembly activates a generation without the package once
    // no Project asks THIS server for it, and its store entry stays for the next that does.
    deps.syncFleet(projectId);
    return c.json(await view(projectId));
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
    return c.json(await view(projectId));
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
        // Ahead of the registry group, whose "/" would otherwise answer here.
        order: 60,
      },
    ],
  },
})
export class InstalledPluginRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly reassembly!: Reassembly;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly access!: Access;
  @Use() private readonly machines!: Machines;
  @Use() private readonly db!: Db;
  @Bind("InstalledPluginRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const hmr = this.hmr;
    const root = this.config.root;
    // Its own cache of the published index: read only when a download is chosen.
    const registries = resolveRegistries({
      indexUrl: this.config.pluginIndexUrl,
      root,
      assetsDir: () => hmr.assetsDir(),
      bases: () => [...pluginBases(root), ...shippedBases(hmr.assetsDir())],
    });
    this.routes = installedPluginRoutes({
      root,
      machineId: new MachinesRepo(this.db as unknown as DatabaseSync).ownId(),
      assetsDir: () => hmr.assetsDir(),
      index: () => mergeIndexes(registries),
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
      // The plugin list rides the same trip the model config takes to a Project's machines.
      syncFleet: (projectId) => void this.machines.syncModelsEverywhere(projectId),
    });
  }
}
