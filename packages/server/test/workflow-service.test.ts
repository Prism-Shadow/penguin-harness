/**
 * Workflow service semantics on the org harness (real OrganizationService, temp dirs):
 * exit gates block `advance` until a prefixed ticket reaches review, transitions announce
 * themselves in the all-hands channel, export renders auditable Markdown, and definition
 * upgrades require a newer version while old instances report the mismatch.
 */
import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_ID } from "../src/organization/paths.js";
import { makeOrgHarness } from "./org-harness.js";
import type { OrgHarness } from "./org-harness.js";

const P = "p1";
const ORG = "tenderco";
const T0 = Date.parse("2026-11-01T01:00:00Z");
const ACTOR = { userId: "alice" };

async function tenderInstance(h: OrgHarness, bizKey = "term-99", title = "测试项目") {
  const { service } = h;
  await service.create(P, { orgId: ORG, name: "TenderCo", mission: "把招标做完" }, "alice");
  return service.createWorkflowInstance(
    P,
    ORG,
    { definitionId: "bidding-v1", bizKey, title },
    ACTOR,
  );
}

async function channelTexts(h: OrgHarness): Promise<string[]> {
  const { store } = h;
  const dir = store.dir(P, ORG);
  const days = await store.listMessageDays(dir, DEFAULT_CHANNEL_ID);
  const out: string[] = [];
  for (const day of days) {
    const { messages } = await store.readMessageDay(dir, DEFAULT_CHANNEL_ID, day);
    out.push(...messages.map((m) => m.text));
  }
  return out;
}

describe("workflow service", () => {
  let h: OrgHarness;
  beforeEach(async () => {
    h = await makeOrgHarness({ nowMs: T0 });
  });

  it("walks text-gated stages freely but holds prefixed gates until review", async () => {
    const { service } = h;
    const inst = await tenderInstance(h);
    expect(inst.currentStage).toBe("capture");
    // capture → terms → analysis → response: text gates only, no attachments needed.
    for (const want of ["terms", "analysis", "response"]) {
      const next = await service.advanceWorkflowInstance(P, ORG, inst.instanceId, {}, ACTOR);
      expect(next.currentStage).toBe(want);
      inst.currentStage = want;
    }
    // response → demo needs a resp-* ticket in review: blocked with its link.
    await expect(
      service.advanceWorkflowInstance(P, ORG, inst.instanceId, {}, ACTOR),
    ).rejects.toMatchObject({ code: "workflow_gate_unmet" });
    const ticket = await service.createTicket(P, ORG, { title: "响应文件", slug: "resp-doc" }, ACTOR);
    await service.attachWorkflowTicket(P, ORG, inst.instanceId, { ticketId: ticket.ticketId }, ACTOR);
    // Attached but still proposed: still held.
    await expect(
      service.advanceWorkflowInstance(P, ORG, inst.instanceId, {}, ACTOR),
    ).rejects.toMatchObject({ code: "workflow_gate_unmet" });
    await service.moveTicket(P, ORG, ticket.ticketId, "review", undefined, ACTOR);
    const demo = await service.advanceWorkflowInstance(P, ORG, inst.instanceId, {}, ACTOR);
    expect(demo.currentStage).toBe("demo");
    expect(demo.attachments).toContain(ticket.ticketId);
  });

  it("announces advances and rejects in the all-hands channel", async () => {
    const { service } = h;
    const inst = await tenderInstance(h, "term-7", "大厅广播项目");
    await service.advanceWorkflowInstance(P, ORG, inst.instanceId, {}, ACTOR);
    await service.rejectWorkflowInstance(
      P,
      ORG,
      inst.instanceId,
      { reason: "要点缺失" },
      ACTOR,
    );
    const texts = await channelTexts(h);
    const advanced = texts.find((t) => t.includes("推进") && t.includes("大厅广播项目"));
    const rejected = texts.find((t) => t.includes("驳回") && t.includes("要点缺失"));
    expect(advanced).toContain("线索抓取");
    expect(rejected).toContain("要点解析");
  });

  it("skips a skippable stage and exports the audit trail", async () => {
    const { service } = h;
    const inst = await tenderInstance(h);
    for (let i = 0; i < 3; i++) {
      const next = await service.advanceWorkflowInstance(P, ORG, inst.instanceId, {}, ACTOR);
      inst.currentStage = next.currentStage;
    }
    expect(inst.currentStage).toBe("response");
    // Leaving response still needs its own gates proven; demo is the skippable one.
    const ticket = await service.createTicket(P, ORG, { title: "响应文件", slug: "resp-doc" }, ACTOR);
    await service.attachWorkflowTicket(P, ORG, inst.instanceId, { ticketId: ticket.ticketId }, ACTOR);
    await service.moveTicket(P, ORG, ticket.ticketId, "review", undefined, ACTOR);
    // Pure-service project: skip demo straight into qa.
    const qa = await service.advanceWorkflowInstance(
      P,
      ORG,
      inst.instanceId,
      { skip: "demo" },
      ACTOR,
    );
    expect(qa.currentStage).toBe("qa");
    const exp = await service.workflowExport(P, ORG, inst.instanceId);
    expect(exp.filename).toBe(`workflow-${inst.instanceId}.md`);
    expect(exp.markdown).toContain("# 工作流实例：测试项目");
    expect(exp.markdown).toContain("推进 响应文件 → 质量门");
    expect(exp.markdown).toContain("## 时间线");
  });

  it("upgrades definitions only forward and flags old instances", async () => {
    const { service } = h;
    const inst = await tenderInstance(h);
    const v1 = await service.workflowDefinition(P, ORG, "bidding-v1");
    const seed = await fs.readFile(
      new URL("../src/organization/templates/bidding-v1.yaml", import.meta.url),
      "utf8",
    );
    // Same version: stale. Bad YAML: invalid. Wrong id: mismatch.
    await expect(
      service.writeWorkflowDefinition(P, ORG, "bidding-v1", seed),
    ).rejects.toMatchObject({ code: "workflow_version_stale" });
    await expect(service.writeWorkflowDefinition(P, ORG, "bidding-v1", "not: [valid")).rejects.toMatchObject({
      code: "workflow_invalid",
    });
    await expect(
      service.writeWorkflowDefinition(P, ORG, "other", "id: bidding-v1\nversion: 9\nname: X\nstages:\n  - {key: alpha, name: A, ownerRole: R}\n"),
    ).rejects.toMatchObject({ code: "workflow_id_mismatch" });
    // Forward: accepted, old instance flags the mismatch but keeps replaying.
    const yaml = [
      "id: bidding-v1",
      "version: 2",
      "name: 招投标交付流程",
      "description: v2",
      "bizKeyPrefix: term-",
      "stages:",
      ...v1.stages.map(
        (s) => `  - {key: ${s.key}, name: ${s.name}, ownerRole: ${s.ownerRole}}`,
      ),
    ].join("\n");
    const v2 = await service.writeWorkflowDefinition(P, ORG, "bidding-v1", yaml);
    expect(v2.version).toBe(2);
    const detail = await service.workflowInstance(P, ORG, inst.instanceId);
    expect(detail.versionMismatch).toBe(true);
    expect(detail.definitionVersion).toBe(1);
    const next = await service.advanceWorkflowInstance(P, ORG, inst.instanceId, {}, ACTOR);
    expect(next.currentStage).toBe("terms");
  });
});
