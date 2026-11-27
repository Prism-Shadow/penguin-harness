/**
 * One organization behind a fake gateway, for the Action tests: a person (`boss`) and three
 * employees, desks that take every line, sessions that open. The proposal service's own tests
 * keep a fuller fake (service.test.ts).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import { ProposalService } from "../src/index.js";
import { FakeForge, FakeMirror } from "./graph-fakes.js";
import type { RunGh } from "../src/pr-status.js";

export const PROJECT = "proj";
export const ORG = "acme";
export const BOSS: OrgActor = { userId: "boss" };
export const DEV: OrgActor = { userId: "boss", agentId: "acme_dev", sessionId: "desk-dev" };
export const IMPL: OrgActor = { userId: "boss", agentId: "acme_impl", sessionId: "desk-impl" };
export const QA: OrgActor = { userId: "boss", agentId: "acme_qa", sessionId: "desk-qa" };

export class FakeOrgGateway implements OrgGateway {
  enabled = true;
  org: OrgView;
  desks: Array<{ agentId: string; text: string }> = [];
  events: ServerEvent[] = [];

  constructor(workspace: string) {
    this.org = {
      projectId: PROJECT,
      orgId: ORG,
      name: "Acme",
      status: "active",
      language: "en",
      workspace,
      employees: [
        { agentId: "acme_dev", name: "Dev", title: "Engineer", reportsTo: null },
        { agentId: "acme_impl", name: "Impl", title: "Engineer", reportsTo: null },
        { agentId: "acme_qa", name: "QA", title: "Tester", reportsTo: null },
      ],
      userIds: ["boss"],
      machineId: null,
    };
  }
  companyModeEnabled(): boolean {
    return this.enabled;
  }
  async organization(): Promise<OrgView | null> {
    return this.org;
  }
  async principalOf(_p: string, _o: string, actor: OrgActor): Promise<string> {
    return actor.agentId !== undefined &&
      this.org.employees.some((e) => e.agentId === actor.agentId)
      ? `agent:${actor.agentId}`
      : `user:${actor.userId}`;
  }
  async deliverToDesk(_p: string, _o: string, agentId: string, text: string) {
    this.desks.push({ agentId, text });
    return { sessionId: `desk-${agentId}`, queued: false };
  }
  async openEmployeeSession() {
    return { sessionId: "session-1", workspace: this.org.workspace };
  }
  async openRoom(args: { channelId: string }) {
    return { channelId: args.channelId };
  }
  async changeRoomMembers() {
    return { added: [], removed: [] };
  }
  notifyProject(_p: string, event: ServerEvent): void {
    this.events.push(event);
  }
}

/** A proposal document whose scope is one file the workspace has. */
export const DOC = `---
title: Batch the notices
scope:
  - file: src/notices.ts
---

## Change

Batch them.

## Purpose

Fewer lines.

## Test

"one line per sweep".
`;

/** A data root with a shared workspace holding DOC's file, the gateway and a service over them. */
export async function fakeOrg(opts: { gh?: RunGh } = {}): Promise<{
  root: string;
  gateway: FakeOrgGateway;
  service: ProposalService;
  cleanup(): Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "company-actions-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "notices.ts"), "export {};\n");
  const gateway = new FakeOrgGateway(workspace);
  const mirror = new FakeMirror();
  const service = new ProposalService({
    gateway,
    agents: {
      pluginVersion: async () => ({ installed: null, library: null }),
      updatePlugin: async () => undefined,
      removeSkill: async () => undefined,
    },
    root,
    log: { line: () => undefined },
    forge: new FakeForge(),
    mirrorFor: () => mirror,
    ...(opts.gh !== undefined ? { gh: opts.gh } : {}),
  });
  return {
    root,
    gateway,
    service,
    cleanup: async () => {
      service.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
