/**
 * The skill hint (skill-hint.ts): a proposal or roadmap write refused or failed for an employee
 * answers with the error followed by one line naming the `penguin-proposal` skill and how to
 * load it; a person's answer is the error alone, and so is an employee's on any other Action.
 * The recorded run keeps the plain message.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRefusal, type ActionCode, type Contributed } from "../src/index.js";
import { skillHint } from "../src/skill-hint.js";
import { actionApp } from "./action-harness.js";
import { BOSS, DEV, ORG, PROJECT, fakeOrg } from "./fake-org.js";

const refuse: ActionCode = {
  guard: () => {
    throw new ActionRefusal(409, "not_established", "Roadmap #3 is discussing.");
  },
  run: async () => ({}),
};
const fail: ActionCode = {
  run: async () => {
    throw new Error("the write broke");
  },
};

const contribution = (id: string, key: string, code: ActionCode): Contributed => ({
  id,
  from: "CompanyProposalsPlugin",
  data: { kind: "action", key, subjects: ["organization"] },
  code,
});

describe("the skill hint on a refused or failed write", () => {
  let org: Awaited<ReturnType<typeof fakeOrg>>;
  let app: ReturnType<typeof actionApp>;
  beforeEach(async () => {
    org = await fakeOrg();
    app = actionApp({
      gateway: org.gateway,
      root: org.root,
      project: PROJECT,
      org: ORG,
      contributions: [
        contribution("t.roadmap", "roadmap.test", refuse),
        contribution("t.proposal", "proposal.test", fail),
        contribution("t.other", "other.test", refuse),
      ],
    });
  });
  afterEach(async () => {
    app.registry.stop();
    await org.cleanup();
  });

  const messageOf = (body: Record<string, unknown>): string =>
    (body.error as { message: string }).message;

  it("follows an employee's refused roadmap write and failed proposal write", async () => {
    const refused = await app.run("roadmap.test", "organization", {}, DEV);
    expect(refused.status).toBe(409);
    expect(messageOf(refused.body)).toBe(`Roadmap #3 is discussing.\n${skillHint("acme_dev")}`);
    expect(skillHint("acme_dev")).toContain(
      "<app_data_dir>/agents/acme_dev/agent_state/skills/penguin-proposal/SKILL.md",
    );
    const failed = await app.run("proposal.test", "organization", {}, DEV);
    expect(failed.status).toBe(500);
    expect(messageOf(failed.body).endsWith(skillHint("acme_dev"))).toBe(true);
    // The run's record keeps the error as it was.
    const runs = (await app.get("/runs?key=roadmap.test")).body.runs as Array<{
      message: string | null;
    }>;
    expect(runs[0]?.message).toBe("Roadmap #3 is discussing.");
  });

  it("leaves a person's error alone, and an employee's on another Action", async () => {
    const person = await app.run("roadmap.test", "organization", {}, BOSS);
    expect(messageOf(person.body)).toBe("Roadmap #3 is discussing.");
    const other = await app.run("other.test", "organization", {}, DEV);
    expect(messageOf(other.body)).toBe("Roadmap #3 is discussing.");
  });
});
