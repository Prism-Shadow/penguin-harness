/**
 * `penguin org roadmap item add | remove` over a stub transport: each command is one Action run
 * on the route `penguin org action run` posts to — the item's fields as the flags a command
 * takes, the caller's identity in the body — and prints what the run answered.
 */
import { describe, expect, it } from "vitest";
import type { ActionRunView } from "@prismshadow/penguin-server/api";
import { getMessages } from "../src/i18n.js";
import { registerOrgRoadmap } from "../src/commands/roadmap.js";
import { harness as mount } from "./action-kit.js";

const t = getMessages("en");

const run = (over: Partial<ActionRunView> = {}): ActionRunView => ({
  id: "r5",
  key: "roadmap.item.add",
  contribution: "company-roadmaps.action.item-add",
  subjectKind: "roadmap",
  subject: "roadmap:3",
  commit: null,
  params: {},
  by: "agent:dev1",
  via: "cli",
  sessionId: null,
  requestId: null,
  startedAt: "2026-10-07T00:00:00.000Z",
  outcome: "succeeded",
  status: 200,
  code: null,
  message: null,
  result: null,
  hookErrors: [],
  endedAt: "2026-10-07T00:00:01.000Z",
  ...over,
});

/** The roadmap the Actions answer: the draft after the write. */
const roadmap = {
  number: 3,
  name: "Company Proposal & Roadmap",
  status: "discussing",
  items: [{ key: "notice-batch", kind: "proposal", title: "Notice batch" }],
};

const harness = (answer: (method: string, suffix: string, body?: unknown) => unknown) =>
  mount((program, kit) => {
    registerOrgRoadmap(program.command("org"), t, kit);
  }, answer);

describe("penguin org roadmap item", () => {
  it("add posts one roadmap.item.add run, the item's fields as its params, and prints the roadmap", async () => {
    const h = harness(() => ({ run: run(), result: roadmap }));
    await h.exec([
      "org",
      "roadmap",
      "item",
      "add",
      "#3",
      "--key",
      "notice-batch",
      "--kind",
      "proposal",
      "--title",
      "Notice batch",
      "--brief",
      "One desk line a day.",
      "--owner",
      "penguin_ceo",
      "--cites",
      "Morning, Digest",
    ]);
    expect(h.calls[0]).toEqual({
      method: "POST",
      suffix: "/roadmap.item.add/runs",
      body: {
        subject: "roadmap:3",
        params: {
          key: "notice-batch",
          kind: "proposal",
          title: "Notice batch",
          brief: "One desk line a day.",
          owner: "penguin_ceo",
          cites: ["Morning", "Digest"],
        },
        via: "cli",
        agentId: "dev1",
      },
    });
    expect(JSON.parse(h.out[0]!)).toEqual(roadmap);
  });

  it("the list and typed flags land as themselves: employees a list, --stacked-on null a null, --proposal a number", async () => {
    const h = harness(() => ({ run: run({ subject: "roadmap:12" }), result: roadmap }));
    await h.exec([
      "org",
      "roadmap",
      "item",
      "add",
      "12",
      "--key",
      "child-room",
      "--kind",
      "roadmap",
      "--title",
      "The child room",
      "--brief",
      "A separate discussion.",
      "--employees",
      "penguin_ceo,penguin_dev_proposals",
    ]);
    expect((h.calls[0]!.body as { params: Record<string, unknown> }).params).toEqual({
      key: "child-room",
      kind: "roadmap",
      title: "The child room",
      brief: "A separate discussion.",
      employees: ["penguin_ceo", "penguin_dev_proposals"],
    });
    await h.exec([
      "org",
      "roadmap",
      "item",
      "add",
      "12",
      "--key",
      "notice-batch",
      "--kind",
      "proposal",
      "--title",
      "Notice batch",
      "--brief",
      "One desk line a day.",
      "--proposal",
      "74",
      "--stacked-on",
      "null",
    ]);
    expect((h.calls[1]!.body as { params: Record<string, unknown> }).params).toEqual({
      key: "notice-batch",
      kind: "proposal",
      title: "Notice batch",
      brief: "One desk line a day.",
      proposal: 74,
      stackedOn: null,
    });
    expect(h.errors).toEqual([]);
  });

  it("a number that is not one, or a --proposal that is not one, is refused before any request", async () => {
    const h = harness(() => ({ run: run(), result: roadmap }));
    await h.exec([
      "org",
      "roadmap",
      "item",
      "add",
      "three",
      "--key",
      "k",
      "--kind",
      "proposal",
      "--title",
      "T",
      "--brief",
      "B",
    ]);
    await h.exec([
      "org",
      "roadmap",
      "item",
      "add",
      "3",
      "--key",
      "k",
      "--kind",
      "proposal",
      "--title",
      "T",
      "--brief",
      "B",
      "--proposal",
      "seven",
    ]);
    await h.exec(["org", "roadmap", "item", "remove", "0", "k"]);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([
      t.org.roadmapNumberInvalid("three"),
      t.org.roadmapItemProposalInvalid("seven"),
      t.org.roadmapNumberInvalid("0"),
    ]);
  });

  it("remove posts roadmap.item.remove with the key, and --json prints the whole answer", async () => {
    const removeRun = run({
      key: "roadmap.item.remove",
      contribution: "company-roadmaps.action.item-remove",
    });
    const h = harness(() => ({ run: removeRun, result: roadmap }));
    await h.exec(["org", "roadmap", "item", "remove", "3", "notice-batch"]);
    expect(h.calls[0]).toEqual({
      method: "POST",
      suffix: "/roadmap.item.remove/runs",
      body: { subject: "roadmap:3", params: { key: "notice-batch" }, via: "cli", agentId: "dev1" },
    });
    expect(JSON.parse(h.out[0]!)).toEqual(roadmap);
    await h.exec(["org", "roadmap", "item", "remove", "3", "notice-batch", "--json"]);
    expect(JSON.parse(h.out[1]!)).toEqual({ run: removeRun, result: roadmap });
  });
});
