import { existsSync } from "node:fs";
import path from "node:path";
import type { AppEnv } from "@prismshadow/penguin-server/internal";

  SkillMetadataItem,
} from "@prismshadow/penguin-server/api";
import { HttpError } from "@prismshadow/penguin-server/internal";
import { readJson, requireString, requireValidId } from "@prismshadow/penguin-server/internal";

} from "../plugin/install.js";
import { parsePluginSource, type PluginSource } from "../plugin/source.js";
import { parsePluginArchive } from "../services/plugin-archive.js";
import { PluginHost, pluginHostFrom, PLUGINS_RESOURCE_ID } from "../plugin/host.js";
import type { PluginSkills } from "../plugin/skills.js";
import { toSkillItem } from "@prismshadow/penguin-server/internal";
import { Access, ProjectConfigStore } from "@prismshadow/penguin-server/internal";

import type { Machines } from "@penguinharness/plugin-machines/server";
import { MachinesRepo } from "@prismshadow/penguin-server/internal";

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
          ...(where.here ? { error: declared.error } : {}),
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
    };
  };

  app.get("/", async (c) => c.json(await view(scope(c))));

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

  /** What POST may install: a registry name, or an https link (plugin/source.ts). */
  const sourceOf = (value: unknown): PluginSource => {
    try {
      return parsePluginSource(value);
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
  };

  /** npm's failure, as the answer: what it said, never a 500. */
  const viaNpm = async (run: () => Promise<InstalledPackage>): Promise<InstalledPackage> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof PluginInstallError) {
        throw new HttpError(400, "plugin_install_failed", `npm: ${err.message}`);
      }
      throw err;
    }
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

  /** Lists `name` in this Project's shared table, or — with `machineId` — in that machine's own. */
  const list = (
    projectId: string,
    name: string,
    requirement: PluginRequirement,
    machineId: string | null,
  ) =>
    edit(projectId, (tables) =>
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

  /** The names of the server modules this build ships: a package under one of them would shadow it. */
  const shippedNames = () => discoverBuiltinPlugins(pluginBases(deps.root, deps.assetsDir()));

  /**
   * Takes back a package an install just put in the prefix and refuses the install: one under the
   * name of a shipped module (409 `plugin_shipped`), or one that is no plugin (400
   * `not_a_plugin`). Its install scripts have run by now, and the refusal says so — and says so
   * too when taking it back failed, which leaves it for the operator to remove.
   */
  const refuseInstalled = async (
    name: string,
    status: 400 | 409,
    code: string,
    why: string,
  ): Promise<never> => {
    let undone = `It was removed again, but its install scripts had already run on the server.`;
    try {
      await deps.packages.remove(deps.root, name);
    } catch (err) {
      undone = `Its install scripts had already run on the server, and removing it failed (${err instanceof Error ? err.message : String(err)}): remove it from ${pluginsPrefix(deps.root)} by hand.`;
    }
    throw new HttpError(status, code, `${why} ${undone}`);
  };

  /** What an install put in the prefix, checked before anything lists it (see the header). */
  const vetInstalled = async (installed: InstalledPackage) => {
    if ((await shippedNames()).includes(installed.name)) {
      return refuseInstalled(
        installed.name,
        409,
        "plugin_shipped",
        `${installed.name} ships with this server: a package under its name would replace it for every Project.`,
      );
    }
    const kinds = kindsOf(installed.name);
    if (!kinds.library && !kinds.modules) {
      return refuseInstalled(
        installed.name,
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
    installed: InstalledPackage | null,
    extra: Partial<PluginInstallOutcome> = {},
  ): Promise<InstalledPluginsResponse> => ({
    ...(await view(projectId)),
    ...(installed !== null
      ? { installed: { ...installed, ...kindsOf(installed.name), ...extra } }
      : {}),
  });

  app.post("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const body = await readJson(c);
    const source = sourceOf(body.specifier);
    const machineId = machineOf(body.machineId);
    const runsHere = machineId === null || machineId === deps.machineId;
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
      const installed = await viaNpm(() => deps.packages.install(deps.root, source.spec));
      if ((await vetInstalled(installed)).modules) {
        await list(projectId, installed.name, {}, deps.machineId);
        deps.syncFleet(projectId);
      }
      return c.json(await answer(projectId, installed));
    }
    // A plugin the build ships is already on the machine: asking for it is consent, not a
    // download. Everything else goes through npm — the package first, the list second, since
    // a listed plugin that is not on disk is exactly the state this route exists to avoid,
    // and npm failing must leave the deployment unchanged. A plugin asked of another machine
    // only is downloaded THERE, by that machine, when the list reaches it.
    const shipped = await shippedNames();
    const installed =
      runsHere && !shipped.includes(source.name)
        ? await viaNpm(() => deps.packages.install(deps.root, source.spec))
        : null;
    // A package of Skills, hooks or MCP servers alone is the library's from here on: no table
    // loads it.
    const kinds = installed !== null ? await vetInstalled(installed) : null;
    if (kinds === null || kinds.modules) {
      // `pkg@1.2.3` installs that version, and the table records it as what this Project asks
      // of the package; the key is the bare name, which is what the loader resolves.
      await list(
        projectId,
        source.name,
        source.version === undefined ? {} : { version: source.version },
        machineId,
      );
      deps.syncFleet(projectId);
    }
    return c.json(await answer(projectId, installed));
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
        await answer(projectId, { name: archive.name, version: current }, { unchanged: true }),
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
    return c.json(await answer(projectId, installed), 201);
  });

  app.delete("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const specifier = nameOf(c.req.query("specifier"));
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
    // The package goes too — but only once no Project asks THIS server for it. The prefix is
    // the harness's to keep tidy; removing it while another Project still lists it would
    // break that Project at the next load.
    if (!(await readPluginClosure(deps.root, deps.machineId)).includes(specifier)) {
      try {
        await deps.packages.remove(deps.root, specifier);
      } catch (err) {
        if (err instanceof PluginInstallError) {
          throw new HttpError(500, "plugin_remove_failed", `npm: ${err.message}`);
        }
        throw err;
      }
    }
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
        // Ahead of the catalogue group, whose "/" would otherwise answer here.
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
  @Use() private readonly packages!: PluginPackages;
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
      // The plugin list rides the same trip the model config takes to a Project's machines.
      syncFleet: (projectId) => void this.machines.syncConfigEverywhere(projectId),
    });
  }
}
