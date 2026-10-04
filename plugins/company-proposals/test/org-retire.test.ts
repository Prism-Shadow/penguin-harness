/**
 * Deleting an organization, as this plugin takes part in it (org-retire.ts): with the store open,
 * a PR graph refresh in flight and a deploy script running, the host's delete — mark, retire,
 * move — finds the refresh aborted, the script stopped and the connection closed before the
 * directory moves. An organization created afterwards under the same id reads an empty store;
 * another organization keeps its connection and its refresh.
 */
import { readdirSync, readlinkSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import type { ProposalDeployRun } from "@prismshadow/penguin-server/api";
import {
  DeployService,
  ProposalService,
  companyDbPath,
  retireListeners,
  retireRegistered,
} from "../src/index.js";
import type { DeployProcess, RetireListener, StartProcess } from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";
import type { RemoteRefs } from "../src/ports.js";
import { FakeForge, FakeMirror } from "./graph-fakes.js";

const PROJECT = "proj";
const ACME = "acme";
const GLOBEX = "globex";
const BOSS: OrgActor = { userId: "boss" };
const HEAD = "a".repeat(40);

/** A mirror whose `ls-remote` waits until released, or rejects when its refresh is aborted. */
class HeldMirror extends FakeMirror {
  aborted = false;
  private release: (() => void) | null = null;
  readonly entered: Promise<void>;
  private enter!: () => void;

  constructor() {
    super(new Map([["refs/heads/dev", "d".repeat(40)]]), "dev");
    this.entered = new Promise((r) => {
      this.enter = r;
    });
  }

  override lsRemote(signal?: AbortSignal): Promise<RemoteRefs> {
    this.enter();
    return new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => {
        this.aborted = true;
        reject(new Error("aborted"));
      });
      this.release = () => resolve(super.lsRemote());
    });
  }

  let(): void {
    this.release?.();
  }
}

class FakeProcess implements DeployProcess {
  readonly signals: string[] = [];
  private readonly exits: Array<(code: number | null, error: string | null) => void> = [];
  onOutput(): void {}
  onExit(l: (code: number | null, error: string | null) => void): void {
    this.exits.push(l);
  }
  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    // A real child exits a moment after the signal, not inside the call.
    if (signal === "SIGTERM")
      setTimeout(() => this.exits.forEach((l) => l(null, "killed by SIGTERM")), 5);
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

let root: string;
const deleting = new Set<string>();
const mirrors = new Map<string, HeldMirror>();
const processes: FakeProcess[] = [];
let service: ProposalService;
let deploys: DeployService;
let listener: RetireListener;

const orgDir = (orgId: string) => path.join(root, PROJECT, "organizations", orgId);

const view = (orgId: string): OrgView => ({
  projectId: PROJECT,
  orgId,
  name: orgId,
  status: "active",
  language: "en",
  workspace: path.join(orgDir(orgId), "workspace"),
  employees: [{ agentId: `${orgId}_dev`, name: "Dev", title: "Engineer", reportsTo: null }],
  userIds: ["boss"],
  machineId: null,
});

/** The host, as far as this plugin sees it: an organization is there while its directory is and no delete runs. */
const gateway = {
  companyModeEnabled: () => true,
  organization: async (_p: string, orgId: string) => {
    if (deleting.has(orgId)) return null;
    return fs.access(orgDir(orgId)).then(
      () => view(orgId),
      () => null,
    );
  },
  principalOf: async (_p: string, _o: string, a: OrgActor) =>
    a.agentId !== undefined ? `agent:${a.agentId}` : `user:${a.userId}`,
  deliverToDesk: async () => ({ sessionId: "desk", queued: false }),
  notifyProject: () => undefined,
} as unknown as OrgGateway;

const gh: RunGh = async () =>
  JSON.stringify({
    head: { sha: HEAD, ref: "feat/thing" },
    html_url: "https://github.com/acme/site/pull/11",
  });

const start: StartProcess = () => {
  const p = new FakeProcess();
  processes.push(p);
  return p;
};

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-retire-"));
  for (const orgId of [ACME, GLOBEX]) await fs.mkdir(view(orgId).workspace, { recursive: true });
  mirrors.clear();
  for (const orgId of [ACME, GLOBEX]) mirrors.set(orgId, new HeldMirror());
  processes.length = 0;
  service = new ProposalService({
    gateway,
    agents: {
      pluginVersion: async () => ({ installed: "1", library: "1" }),
      updatePlugin: async () => {},
    },
    root,
    log: { line: () => undefined },
    pluginConfig: { get: () => ({ deliveryRepo: "acme/site", deliveryBase: "dev" }) },
    forge: new FakeForge([]),
    mirrorFor: (dir) => mirrors.get(path.basename(dir))!,
  });
  deploys = new DeployService({
    scope: (projectId, orgId, actor) => service.deployScope(projectId, orgId, actor),
    root,
    log: () => undefined,
    gh,
    start,
    onFinished: (projectId, orgId) => service.deployFinished(projectId, orgId),
  });
  // What the plugin's module registers at setup (index.ts).
  listener = (org) =>
    service.retire(org.projectId, org.orgId, () => deploys.retire(org.projectId, org.orgId));
  retireListeners.add(listener);
});

afterEach(async () => {
  retireListeners.delete(listener);
  for (const m of mirrors.values()) m.let();
  service.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("deleting an organization", () => {
  it("aborts its refresh, stops its deploy and closes its store before the move; others keep theirs", async () => {
    for (const orgId of [ACME, GLOBEX]) {
      await service.create(
        PROJECT,
        orgId,
        { author: `${orgId}_dev`, brief: `Work of ${orgId}` },
        BOSS,
      );
      // A read starts the first refresh, which waits in ls-remote.
      await service.graph(PROJECT, orgId, BOSS);
      await mirrors.get(orgId)!.entered;
    }
    await deploys.register(PROJECT, ACME, BOSS, true, { id: "staging", command: ["deploy"] });
    const started = await deploys.start(PROJECT, ACME, BOSS, { script: "staging", pr: 11 });
    const run = (started as { run: ProposalDeployRun }).run;
    expect(run.status).toBe("running");

    const db = companyDbPath(root, PROJECT, ACME);
    let heldAtMove: string[] | null = null;
    const trashed = await hostDelete(ACME, () => {
      heldAtMove = openFiles()?.filter((f) => f.startsWith(path.dirname(db))) ?? null;
    });

    // Before the move: the refresh was aborted, the script stopped, the connection closed.
    expect(mirrors.get(ACME)!.aborted).toBe(true);
    expect(processes[0]!.signals).toContain("SIGTERM");
    if (heldAtMove !== null) expect(heldAtMove).toEqual([]);
    // The run's outcome is recorded as any killed run's, and the trashed store kept its data.
    expect(run).toMatchObject({ status: "failed", error: "killed by SIGTERM" });
    const old = new DatabaseSync(path.join(trashed, "company.db"), { readOnly: true });
    expect((old.prepare("SELECT count(*) AS n FROM proposals").get() as { n: number }).n).toBe(1);
    old.close();

    // The other organization is untouched: its refresh still waits, its store still answers.
    expect(mirrors.get(GLOBEX)!.aborted).toBe(false);
    mirrors.get(GLOBEX)!.let();
    await service.graphSettled(PROJECT, GLOBEX);
    expect((await service.list(PROJECT, GLOBEX, BOSS)).proposals).toHaveLength(1);

    // While the delete ran nothing reopened the organization; one created afterwards under the
    // same id starts from an empty store.
    expect(
      await fs.access(orgDir(ACME)).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await fs.mkdir(view(ACME).workspace, { recursive: true });
    expect((await service.list(PROJECT, ACME, BOSS)).proposals).toEqual([]);
  });

  it("answers a forced graph refresh in flight when the delete runs with 404 org_not_found", async () => {
    await service.create(PROJECT, ACME, { author: `${ACME}_dev`, brief: "Work" }, BOSS);
    // The refresh button: the read waits for a forced refresh, which waits in ls-remote.
    const reading = service.graph(PROJECT, ACME, BOSS, { refresh: true });
    const settled = reading.then(
      () => null,
      (err: unknown) => err,
    );
    await mirrors.get(ACME)!.entered;

    await hostDelete(ACME, () => undefined);

    expect(mirrors.get(ACME)!.aborted).toBe(true);
    expect(await settled).toMatchObject({ status: 404, code: "org_not_found" });
    // As every request after the delete.
    await expect(service.graph(PROJECT, ACME, BOSS, { refresh: true })).rejects.toMatchObject({
      status: 404,
      code: "org_not_found",
    });
  });

  it("opens a retired organization again once the gateway finds it (a delete whose move failed)", async () => {
    await service.create(PROJECT, ACME, { author: `${ACME}_dev`, brief: "Work" }, BOSS);
    deleting.add(ACME);
    await listener({ projectId: PROJECT, orgId: ACME });
    await expect(service.list(PROJECT, ACME, BOSS)).rejects.toMatchObject({ status: 404 });
    deleting.delete(ACME);
    // The move failed, say: the organization is still there and opens again on the next read.
    expect((await service.list(PROJECT, ACME, BOSS)).proposals).toHaveLength(1);
  });
});
