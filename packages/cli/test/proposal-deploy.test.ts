/**
 * The deploy command over a stub transport: the deploy Action it runs (`deploy.<id>`) on which
 * subject, with the head looked at and the arguments after `--` untouched; how it follows the
 * run to its end and what it exits with; the dry run and `--json` answers.
 */
import { describe, expect, it } from "vitest";
import type { ActionRunResponse, ActionRunView } from "@prismshadow/penguin-server/api";
import { getMessages } from "../src/i18n.js";
import { registerProposalDeploy } from "../src/commands/proposal-deploy.js";
import { harness as mount } from "./action-kit.js";

const t = getMessages("en");
const HEAD = "c".repeat(40);

const run = (over: Partial<ActionRunView> = {}): ActionRunView => ({
  id: "r1",
  key: "deploy.staging",
  contribution: "acme-deploy.staging",
  subjectKind: "proposal",
  subject: "proposal:4",
  commit: HEAD,
  params: {},
  by: "agent:dev1",
  via: "cli",
  sessionId: null,
  requestId: null,
  startedAt: "2026-10-01T00:00:00.000Z",
  outcome: null,
  status: null,
  code: null,
  message: null,
  result: null,
  hookErrors: [],
  endedAt: null,
  ...over,
});

const harness = (answer: (method: string, suffix: string, body?: unknown) => unknown) =>
  mount((program, kit) => registerProposalDeploy(program.command("proposal"), t, kit), answer);

describe("penguin org proposal deploy", () => {
  it("runs deploy.<id> on the proposal with the head and the arguments after -- as they are, then follows the run to its end", async () => {
    const pages: ActionRunResponse[] = [
      { run: run(), output: "building\n", from: 0, next: 9 },
      { run: run(), output: "", from: 9, next: 9 },
      {
        run: run({ outcome: "succeeded", result: { exitCode: 0, head: HEAD } }),
        output: "pushed\n",
        from: 9,
        next: 16,
      },
    ];
    const h = harness((method) =>
      method === "POST" ? { run: run(), result: null } : pages.shift(),
    );
    await h.exec([
      "proposal",
      "deploy",
      "#4",
      "--to",
      "staging",
      "--head",
      "cccc",
      "--",
      "--extra-args",
      "two words",
    ]);
    expect(h.calls[0]).toEqual({
      method: "POST",
      suffix: "/deploy.staging/runs",
      body: {
        subject: "proposal:4",
        params: { expectedHead: "cccc", args: ["--extra-args", "two words"] },
        via: "cli",
        agentId: "dev1",
      },
    });
    expect(h.calls.slice(1).map((c) => c.suffix)).toEqual([
      "/runs/r1?agentId=dev1&from=0",
      "/runs/r1?agentId=dev1&from=9",
      "/runs/r1?agentId=dev1&from=9",
    ]);
    expect(h.sleeps).toBe(2);
    expect(h.out.join("")).toBe(
      `${t.org.proposalDeployStarted("r1", "deploy.staging", "proposal:4", HEAD.slice(0, 12))}\nbuilding\npushed\n${t.org.proposalDeploySucceeded("r1", HEAD.slice(0, 12))}\n`,
    );
    expect(h.errors).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it("--pr names a PR of the delivery repository; a failed run fails with its outcome, exit code and message", async () => {
    const h = harness((method) =>
      method === "POST"
        ? { run: run({ subject: "pr:11" }), result: null }
        : {
            run: run({
              outcome: "failed",
              code: "deploy_failed",
              message: "deploy.staging exited with 2.",
              result: { exitCode: 2, error: null },
            }),
            output: "boom\n",
            from: 0,
            next: 5,
          },
    );
    await h.exec(["proposal", "deploy", "--pr", "11", "--to", "staging"]);
    expect(h.calls[0]!.body).toMatchObject({ subject: "pr:11", params: {} });
    expect(h.errors).toEqual([
      t.org.proposalDeployFailed("r1", "failed", 2, "deploy.staging exited with 2."),
    ]);
    expect(h.exits).toEqual([2]);
  });

  it("a dry run asks whether the Action is bound and allowed on the subject, running nothing; --json prints the answer and does not follow", async () => {
    const dry = harness(() => ({
      actions: [
        {
          key: "deploy.staging",
          contribution: "acme-deploy.staging",
          subjects: ["proposal"],
          params: {},
          description: "",
          builtin: false,
          allowed: true,
        },
      ],
    }));
    await dry.exec(["proposal", "deploy", "4", "--to", "staging", "--dry-run"]);
    expect(dry.calls).toEqual([{ method: "GET", suffix: "?agentId=dev1&subject=proposal%3A4" }]);
    expect(dry.out.join("")).toBe(
      `${t.org.proposalDeployPlanned("deploy.staging", "proposal:4", true, "")}\n`,
    );
    const json = harness(() => ({ run: run(), result: null }));
    await json.exec(["proposal", "deploy", "4", "--to", "staging", "--json"]);
    expect(json.calls).toHaveLength(1);
    expect(JSON.parse(json.out.join(""))).toEqual({ run: run(), result: null });
  });

  it("refuses a number that is not one, or both a number and --pr, sending nothing", async () => {
    const h = harness(() => ({}));
    await h.exec(["proposal", "deploy", "x", "--to", "staging"]);
    await h.exec(["proposal", "deploy", "4", "--pr", "5", "--to", "staging"]);
    expect(h.calls).toEqual([]);
    expect(h.errors).toEqual([t.org.proposalNumberInvalid("x"), t.org.proposalDeployUsage]);
  });
});
