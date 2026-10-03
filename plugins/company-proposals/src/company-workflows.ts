/**
 * An organization's company workflows: `<org dir>/workflows/<id>/`, each an Agent workflow's
 * package scoped to the organization, loaded by the server's WorkflowLoader with what
 * company-host.ts publishes into its tree. What a loaded workflow contributes to
 * `CompanyActionRegistry.actions` is the organization's company contributions (the registry's
 * CompanySource): contributing is taking effect, in that organization only.
 *
 * An organization's workflows load the first time its registry is asked about it (every load of
 * the plugin starts with none — a hot update loads them anew), and one workflow again whenever a
 * `workflow.*` Action changes it (workflow-actions.ts). A load that fails keeps the previous
 * instance serving and records why; with no previous instance, the workflow contributes nothing.
 * Loads and writes of one workflow are serialized; versions are kept beside the folders, under
 * `<org dir>/workflows-history/<id>/`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  OrgView,
  WorkflowFolderView,
  WorkflowLoader,
  WorkflowLoadOutcome,
  WorkflowVersion,
} from "@prismshadow/penguin-server/plugin";
import type { CompanyWorkflowView } from "@prismshadow/penguin-server/api";
import { ActionRefusal } from "./action-model.js";
import type { Contributed } from "./action-index.js";
import type { CompanySource } from "./action-registry.js";
import {
  COMPANY_ACTIONS_IFACE,
  COMPANY_HOST_IFACE,
  COMPANY_PACKAGE_TYPES,
  COMPANY_README,
  HOST_MODULE,
  REGISTRY_MODULE,
  SLOT_KEY,
  companyHost,
  companyKind,
  packageDir,
  type CompanyKind,
} from "./company-host.js";
import { companyDbPath } from "./schema.js";

type Tree = Extract<WorkflowLoadOutcome, { ok: true }>["tree"];

/** One workflow of an organization: the folder last loaded, and the instance serving. */
interface Instance {
  folder: WorkflowFolderView;
  tree: Tree | null;
  serving: string | null;
  contributions: Contributed[];
  loadedAt: string | null;
  error: string | null;
}

interface OrgState {
  instances: Map<string, Instance>;
  /** Every instance's contributions, by workflow id: a new array whenever one changes. */
  contributions: readonly Contributed[];
  ready: Promise<void>;
  /** The organization is being deleted: a load that ends now disposes its tree at once. */
  retired: boolean;
}

/** A company workflow's id: one path segment, the server's rule for a workflow folder. */
export const WORKFLOW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A file a write names: relative, `/`-separated, no `.`/`..`, nothing under a dot-directory. */
export function isWorkflowPath(rel: string): boolean {
  if (rel === "" || rel.length > 400 || rel.startsWith("/") || rel.includes("\\")) return false;
  const parts = rel.split("/");
  return parts.every((p) => p !== "" && !p.startsWith(".")) && parts[0] !== "node_modules";
}

/** What one write may carry. */
const MAX_FILES = 200;
const MAX_BYTES = 4 * 1024 * 1024;

export interface CompanyWorkflowsDeps {
  loader: WorkflowLoader;
  /** The data root (Paths.root). */
  root: string;
  log: (line: string) => void;
  now?: () => Date;
  /** This package's table and declarations; read from the package's directory by default. */
  kind?: CompanyKind;
}

export class CompanyWorkflows implements CompanySource {
  private readonly orgs = new Map<string, OrgState>();
  /** The chain of loads and writes per workflow (`<org key>/<id>`). */
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly kind: CompanyKind;
  private stopped = false;

  constructor(private readonly deps: CompanyWorkflowsDeps) {
    this.kind = deps.kind ?? companyKind(packageDir());
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private orgDir(org: OrgView): string {
    return path.dirname(companyDbPath(this.deps.root, org.projectId, org.orgId));
  }

  dir(org: OrgView): string {
    return path.join(this.orgDir(org), "workflows");
  }

  historyDir(org: OrgView): string {
    return path.join(this.orgDir(org), "workflows-history");
  }

  /** The organization's company contributions, its workflows loaded first if they are not yet. */
  async contributions(org: OrgView): Promise<readonly Contributed[]> {
    return (await this.state(org)).contributions;
  }

  private async state(org: OrgView): Promise<OrgState> {
    const key = `${org.projectId}/${org.orgId}`;
    let st = this.orgs.get(key);
    if (st === undefined) {
      const fresh: OrgState = {
        instances: new Map(),
        contributions: [],
        ready: Promise.resolve(),
        retired: false,
      };
      fresh.ready = (async () => {
        if (this.stopped) return;
        for (const folder of await this.deps.loader.folders(this.dir(org))) {
          if (fresh.retired) return;
          await this.serial(org, folder.id, () => this.loadNow(org, fresh, folder));
        }
      })().catch((err: unknown) =>
        this.deps.log(
          `[company-workflows] ${key}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      this.orgs.set(key, fresh);
      st = fresh;
    }
    await st.ready;
    return st;
  }

  private serial<T>(org: OrgView, id: string, task: () => Promise<T>): Promise<T> {
    const key = `${org.projectId}/${org.orgId}/${id}`;
    const run = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
    this.queues.set(key, run);
    void run
      .finally(() => {
        if (this.queues.get(key) === run) this.queues.delete(key);
      })
      .catch(() => undefined);
    return run;
  }

  /** Loads `folder` into the organization; a failure keeps what served before. */
  private async loadNow(org: OrgView, st: OrgState, folder: WorkflowFolderView): Promise<Instance> {
    const previous = st.instances.get(folder.id);
    const loadedAt = this.now().toISOString();
    const outcome: WorkflowLoadOutcome =
      this.kind.table === null
        ? {
            ok: false,
            error:
              "company-proposals carries no ifaces.json: build the package to load company workflows",
          }
        : await this.deps.loader.load({
            folder,
            label: `${org.projectId}/${org.orgId}/workflows/${folder.id}`,
            historyDir: this.historyDir(org),
            table: this.kind.table,
            harness: {
              keys: [COMPANY_HOST_IFACE],
              packageTypes: COMPANY_PACKAGE_TYPES,
              readme: COMPANY_README,
            },
            typeModules: this.kind.typeModules,
            main: null,
            published: (table) => {
              const decl = table.ifaces[COMPANY_HOST_IFACE];
              if (decl === undefined) throw new Error(`${COMPANY_HOST_IFACE} is not in the table`);
              return {
                ifaces: { [HOST_MODULE]: { host: decl } },
                values: { [HOST_MODULE]: { host: companyHost(org, folder.id, this.deps.log) } },
              };
            },
            sinks: { [REGISTRY_MODULE]: COMPANY_ACTIONS_IFACE },
          });
    let next: Instance;
    if (outcome.ok) {
      next = {
        folder,
        tree: outcome.tree,
        serving: folder.revision,
        contributions: (outcome.contributions[SLOT_KEY] ?? []).map((c) => ({
          id: c.id,
          from: c.from,
          data: c.data as Record<string, unknown>,
          code: c.code,
          workflow: folder.id,
        })),
        loadedAt,
        error: null,
      };
      previous?.tree?.dispose();
    } else {
      next = {
        folder,
        tree: previous?.tree ?? null,
        serving: previous?.serving ?? null,
        contributions: previous?.contributions ?? [],
        loadedAt: previous?.loadedAt ?? null,
        error: outcome.error,
      };
    }
    if (this.stopped || st.retired) {
      next.tree?.dispose();
      return next;
    }
    st.instances.set(folder.id, next);
    this.collect(st);
    return next;
  }

  private collect(st: OrgState): void {
    st.contributions = [...st.instances.keys()]
      .sort()
      .flatMap((id) => st.instances.get(id)!.contributions);
  }

  private viewOf(i: Instance): CompanyWorkflowView {
    return {
      id: i.folder.id,
      name: i.folder.pkg.name,
      version: i.folder.pkg.version,
      revision: i.folder.revision,
      serving: i.serving,
      loadedAt: i.loadedAt,
      error: i.error,
      contributions: i.contributions.map((c) => c.id),
      skipped: [],
      files: i.folder.files,
    };
  }

  async list(org: OrgView): Promise<CompanyWorkflowView[]> {
    const st = await this.state(org);
    return [...st.instances.keys()].sort().map((id) => this.viewOf(st.instances.get(id)!));
  }

  /** One workflow's state; 404 when the organization has none by that id. */
  async view(org: OrgView, id: string): Promise<CompanyWorkflowView> {
    const st = await this.state(org);
    const i = st.instances.get(id);
    if (i === undefined) throw notFound(id);
    return this.viewOf(i);
  }

  /** Loads the folder on disk again (after it was changed in place); 404 when it is no workflow. */
  async reload(org: OrgView, id: string): Promise<CompanyWorkflowView> {
    const st = await this.state(org);
    return this.serial(org, id, async () => this.viewOf(await this.reloadNow(org, st, id)));
  }

  private async reloadNow(org: OrgView, st: OrgState, id: string): Promise<Instance> {
    const folder = WORKFLOW_ID.test(id)
      ? await this.deps.loader.folder(path.join(this.dir(org), id), id)
      : null;
    if (folder === null) {
      this.forget(st, id);
      throw notFound(id);
    }
    return this.loadNow(org, st, folder);
  }

  /**
   * Writes files of workflow `id` — content to write, null to delete — and loads it. `replace`
   * deletes every other file of the folder (a whole directory put in place). The folder is
   * created when it is new; a write that leaves no package.json is refused.
   */
  async write(
    org: OrgView,
    id: string,
    files: Readonly<Record<string, string | null>>,
    replace: boolean,
  ): Promise<CompanyWorkflowView> {
    if (!WORKFLOW_ID.test(id)) {
      throw new ActionRefusal(400, "bad_workflow_id", `Not a workflow id: ${id}.`);
    }
    const entries = Object.entries(files);
    if (entries.length > MAX_FILES) {
      throw new ActionRefusal(400, "bad_files", `A write carries at most ${MAX_FILES} files.`);
    }
    let bytes = 0;
    for (const [rel, content] of entries) {
      if (!isWorkflowPath(rel)) {
        throw new ActionRefusal(400, "bad_path", `Not a path a workflow file may have: ${rel}.`);
      }
      if (content !== null && typeof content !== "string") {
        throw new ActionRefusal(400, "bad_files", `${rel}: the content is a string, or null.`);
      }
      bytes += content === null ? 0 : Buffer.byteLength(content);
    }
    if (bytes > MAX_BYTES) {
      throw new ActionRefusal(400, "bad_files", `A write carries at most ${MAX_BYTES} bytes.`);
    }
    const st = await this.state(org);
    return this.serial(org, id, async () => {
      const dir = path.join(this.dir(org), id);
      const before = await this.deps.loader.folder(dir, id);
      const keep = (rel: string) => rel in files && files[rel] !== null;
      if (before === null && !keep("package.json")) {
        throw new ActionRefusal(
          400,
          "not_a_workflow",
          `Workflow ${id} does not exist; its first write carries package.json and index.ts.`,
        );
      }
      if (replace && before !== null) {
        for (const rel of before.files) {
          if (!keep(rel)) await fs.rm(path.join(dir, rel), { force: true });
        }
      }
      for (const [rel, content] of entries) {
        const file = path.join(dir, rel);
        if (content === null) {
          await fs.rm(file, { force: true });
          continue;
        }
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content);
      }
      return this.viewOf(await this.reloadNow(org, st, id));
    });
  }

  /** Deletes the workflow and its versions; its contributions leave the organization. */
  async remove(org: OrgView, id: string): Promise<void> {
    const st = await this.state(org);
    await this.serial(org, id, async () => {
      if (!WORKFLOW_ID.test(id) || !st.instances.has(id)) {
        const exists = WORKFLOW_ID.test(id)
          ? await this.deps.loader.folder(path.join(this.dir(org), id), id)
          : null;
        if (exists === null) throw notFound(id);
      }
      this.forget(st, id);
      await fs.rm(path.join(this.dir(org), id), { recursive: true, force: true });
      await fs.rm(path.join(this.historyDir(org), id), { recursive: true, force: true });
    });
  }

  /** Makes the workflow a recorded version again, and loads it. */
  async rollback(org: OrgView, id: string, revision: string): Promise<CompanyWorkflowView> {
    const st = await this.state(org);
    return this.serial(org, id, async () => {
      const restored = WORKFLOW_ID.test(id)
        ? await this.deps.loader.restore(
            this.historyDir(org),
            path.join(this.dir(org), id),
            id,
            revision,
          )
        : false;
      if (!restored) {
        throw new ActionRefusal(
          404,
          "version_not_found",
          `Workflow ${id} has no version ${revision}: \`penguin org workflow history ${id}\` lists them.`,
        );
      }
      return this.viewOf(await this.reloadNow(org, st, id));
    });
  }

  history(org: OrgView, id: string): Promise<WorkflowVersion[]> {
    return this.deps.loader.history(this.historyDir(org), id);
  }

  /** A file of the workflow as it is on disk; null when there is none. */
  async readFile(org: OrgView, id: string, rel: string): Promise<string | null> {
    if (!WORKFLOW_ID.test(id) || !isWorkflowPath(rel)) return null;
    try {
      return await fs.readFile(path.join(this.dir(org), id, rel), "utf8");
    } catch {
      return null;
    }
  }

  private forget(st: OrgState, id: string): void {
    st.instances.get(id)?.tree?.dispose();
    if (st.instances.delete(id)) this.collect(st);
  }

  /**
   * The organization is being deleted (org-retire.ts): its loads and writes in flight are
   * awaited, its trees disposed and what is kept of it dropped. Asked about again — an
   * organization created later under the same id — it loads from its folders anew.
   */
  async retire(projectId: string, orgId: string): Promise<void> {
    const key = `${projectId}/${orgId}`;
    const st = this.orgs.get(key);
    if (st === undefined) return;
    this.orgs.delete(key);
    st.retired = true;
    await st.ready;
    const pending = [...this.queues].filter(([k]) => k.startsWith(`${key}/`)).map(([, q]) => q);
    await Promise.all(pending.map((q) => q.catch(() => undefined)));
    for (const i of st.instances.values()) i.tree?.dispose();
    st.instances.clear();
    st.contributions = [];
  }

  /** The plugin is stopping: every tree goes, and nothing loads any more. */
  stop(): void {
    this.stopped = true;
    for (const st of this.orgs.values()) {
      for (const i of st.instances.values()) i.tree?.dispose();
      st.instances.clear();
      st.contributions = [];
    }
  }
}

function notFound(id: string): ActionRefusal {
  return new ActionRefusal(
    404,
    "workflow_not_found",
    `No company workflow ${id} in this organization.`,
  );
}
