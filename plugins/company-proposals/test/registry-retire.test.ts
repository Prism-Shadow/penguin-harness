/**
 * Deleting an organization, as the Action registry takes part in it (registry-module.ts's
 * retirement, org-retire.ts): with a run's process going in each of two organizations and their
 * company workflows loaded, the host's delete — mark, retire, move — finds the deleted
 * organization's process stopped, its run's end recorded, its connection closed and its
 * workflow trees disposed before the directory moves. The other organization keeps its run and
 * its trees; an organization created afterwards under the same id runs again.
 */
import { readdirSync, readlinkSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  OrgActor,
  OrgGateway,
  OrgView,
  WorkflowFolderView,
  WorkflowLoader,
} from "@prismshadow/penguin-server/plugin";
import {
  ActionFailure,
  CompanyWorkflows,
  retireRegistered,
  runRetireListeners,
  type ActionCode,
  type Contributed,
  type DeployProcess,
  type RetireListener,
  type StartProcess,
} from "../src/index.js";
import { actionApp, type ActionApp } from "./action-harness.js";

const PROJECT = "proj";
const ACME = "acme";
const GLOBEX = "globex";

class FakeProcess implements DeployProcess {
  readonly signals: string[] = [];
  private readonly exits: Array<(code: number | null, error: string | null) => void> = [];
  constructor(readonly cwd: string) {}
  onOutput(): void {}
  onExit(l: (code: number | null, error: string | null) => void): void {
    this.exits.push(l);
  }
  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    // A real child exits a moment after the signal, not inside the call.
    if (signal === "SIGTERM") setTimeout(() => this.exits.forEach((l) => l(null, null)), 5);
  }
}

/** Every open file descriptor's target, where the platform lists them (Linux). */
function openFiles(): string[] | null {
  try {
    return readdirSync("/proc/self/fd").flatMap((fd) => {
      try {
        return [readlinkSync(`/proc/self/fd/${fd}`)];
      } catch {
        return [];
      }
    });
  } catch {
    return null;
  }
}

/** A run that starts one process and fails unless it exits 0, as a deploy does (deploy.ts). */
const processAction: ActionCode = {
  run: async (ctx) => {
    const end = await ctx.process(["deploy"]);
    if (end.exitCode !== 0) throw new ActionFailure(500, "deploy_failed", "the process stopped");
    return end;
  },
};

const contributions: Contributed[] = [
  {
    id: "t.deploy",
    from: "CompanyProposalsPlugin",
    data: { kind: "action", key: "test.deploy", subjects: ["organization"] },
    code: processAction,
  },
];

let root: string;
const deleting = new Set<string>();
const processes: FakeProcess[] = [];
/** The trees the fake loader handed out, by organization, and the ones disposed. */
const trees: string[] = [];
const disposed: string[] = [];
let workflows: CompanyWorkflows;
let a: ActionApp;
let listener: RetireListener;

const orgDir = (orgId: string) => path.join(root, PROJECT, "organizations", orgId);

const view = (orgId: string): OrgView => ({
  projectId: PROJECT,
  orgId,
  name: orgId,
  status: "active",
  language: "en",
  workspace: path.join(orgDir(orgId), "workspace"),
  employees: [],
  userIds: ["boss"],
  machineId: null,
});

/** The host, as far as the registry sees it: an organization is there while its directory is and no delete runs. */
const gateway = {
  companyModeEnabled: () => true,
  organization: async (_p: string, orgId: string) => {
    if (deleting.has(orgId)) return null;
    return fs.access(orgDir(orgId)).then(
      () => view(orgId),
      () => null,
    );
  },
  principalOf: async (_p: string, _o: string, a: OrgActor) => `user:${a.userId}`,
} as unknown as OrgGateway;

/** One workflow folder in every organization, loaded into a tree that records its disposal. */
const loader = {
  folders: async (base: string): Promise<WorkflowFolderView[]> => [
    {
      id: "w",
      dir: path.join(base, "w"),
      files: [],
      revision: "r1",
      uiRev: null,
      pkg: { name: "w", version: null },
    },
  ],
  load: async (req: { label: string }) => {
    trees.push(req.label);
    return {
      ok: true,
      tree: { dispose: () => disposed.push(req.label) },
      manifests: [],
      contributions: {},
    };
  },
} as unknown as WorkflowLoader;

const start: StartProcess = (_argv, opts) => {
  const p = new FakeProcess(opts.cwd);
  processes.push(p);
  return p;
};

/** Starts the process Action in `orgId`; answers the run id. */
async function started(orgId: string): Promise<string> {
  const res = await a.app.request(`/p/${PROJECT}/o/${orgId}/actions/test.deploy/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": "boss" },
    body: JSON.stringify({ subject: "organization" }),
  });
  expect(res.status).toBe(202);
  return ((await res.json()) as { run: { id: string } }).run.id;
}

/** The host's delete, in its order: mark, retire, move (runtime/organization/retire.ts). */
async function hostDelete(orgId: string, beforeMove: () => void): Promise<string> {
  deleting.add(orgId);
  try {
    await retireRegistered({ projectId: PROJECT, orgId });
    beforeMove();
    const target = path.join(root, PROJECT, "organizations", ".trash", `${orgId}-1`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(orgDir(orgId), target);
    return target;
  } finally {
    deleting.delete(orgId);
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "registry-retire-"));
  for (const orgId of [ACME, GLOBEX]) await fs.mkdir(view(orgId).workspace, { recursive: true });
  processes.length = 0;
  trees.length = 0;
  disposed.length = 0;
  workflows = new CompanyWorkflows({
    loader,
    root,
    log: () => undefined,
    kind: { table: {} as never, typeModules: {} },
  });
  a = actionApp({
    gateway,
    root,
    project: PROJECT,
    org: ACME,
    contributions,
    deps: { company: workflows, start },
  });
  // What the registry's module registers at setup (registry-module.ts).
  listener = async (org) => {
    await a.registry.retire(org.projectId, org.orgId);
    await workflows.retire(org.projectId, org.orgId);
  };
  runRetireListeners.add(listener);
});

afterEach(async () => {
  runRetireListeners.delete(listener);
  for (const p of processes) p.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 20));
  a.registry.stop();
  workflows.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe("deleting an organization", () => {
  it("stops its runs' processes, records their ends, closes its store and drops its workflows before the move", async () => {
    const acmeRun = await started(ACME);
    await started(GLOBEX);
    expect(processes.map((p) => p.cwd)).toEqual([view(ACME).workspace, view(GLOBEX).workspace]);
    // Each organization's company workflow was loaded for its first run.
    expect(trees).toEqual([`${PROJECT}/${ACME}/workflows/w`, `${PROJECT}/${GLOBEX}/workflows/w`]);

    let heldAtMove: string[] | null = null;
    const trashed = await hostDelete(ACME, () => {
      heldAtMove = openFiles()?.filter((f) => f.startsWith(orgDir(ACME))) ?? null;
    });

    // Before the move: the process was stopped, the connection closed, the tree disposed.
    expect(processes[0]!.signals).toContain("SIGTERM");
    if (heldAtMove !== null) expect(heldAtMove).toEqual([]);
    expect(disposed).toEqual([`${PROJECT}/${ACME}/workflows/w`]);
    // The run's end was recorded before the store closed: failed, as a stopped process is.
    const db = new DatabaseSync(path.join(trashed, "company.db"), { readOnly: true });
    const end = db.prepare(`SELECT outcome FROM action_run_ends WHERE run_id = ?`).get(acmeRun) as
      { outcome: string } | undefined;
    db.close();
    expect(end?.outcome).toBe("failed");

    // The other organization is untouched: its process runs on, its tree stays.
    expect(processes[1]!.signals).toEqual([]);
    expect(disposed).not.toContain(`${PROJECT}/${GLOBEX}/workflows/w`);

    // An organization created afterwards under the same id runs again, its workflows loaded anew.
    await fs.mkdir(view(ACME).workspace, { recursive: true });
    await started(ACME);
    expect(trees.filter((t) => t === `${PROJECT}/${ACME}/workflows/w`)).toHaveLength(2);
  });

  it("refuses the organization while it is being deleted", async () => {
    await started(ACME);
    deleting.add(ACME);
    await listener({ projectId: PROJECT, orgId: ACME });
    const refused = await a.app.request(`/p/${PROJECT}/o/${ACME}/actions/test.deploy/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "boss" },
      body: JSON.stringify({ subject: "organization" }),
    });
    expect(refused.status).toBe(404);
    deleting.delete(ACME);
    // The move failed, say: the organization is still there and runs again.
    await started(ACME);
  });
});
