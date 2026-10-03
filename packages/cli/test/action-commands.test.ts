/**
 * `penguin org action` over a stub transport: each command is one route of the Action
 * registry, sent with the caller's identity, and prints what that route answered.
 */
import { describe, expect, it } from "vitest";
import type { ActionRunView } from "@prismshadow/penguin-server/api";
import { getMessages } from "../src/i18n.js";
import { registerOrgAction } from "../src/commands/action.js";
import { parseParams } from "../src/commands/action-client.js";
import { harness as mount } from "./action-kit.js";

const t = getMessages("en");

const run = (over: Partial<ActionRunView> = {}): ActionRunView => ({
  id: "r9",
  key: "proposal.approve",
  contribution: "company-proposals.action.approve",
  subjectKind: "proposal",
  subject: "proposal:12",
  commit: null,
  params: {},
  by: "agent:dev1",
  via: "cli",
  sessionId: null,
  requestId: null,
  startedAt: "2026-10-03T00:00:00.000Z",
  outcome: "succeeded",
  status: 200,
  code: null,
  message: null,
  result: { number: 12, status: "approved" },
  hookErrors: [],
  endedAt: "2026-10-03T00:00:01.000Z",
  ...over,
});

const harness = (answer: (method: string, suffix: string, body?: unknown) => unknown) =>
  mount((program, kit) => registerOrgAction(program.command("org"), t, kit), answer);

describe("penguin org action", () => {
  it("ls lists the bound Actions, with the guard's answer for a subject; --all lists every contribution", async () => {
    const h = harness((_m, suffix) =>
      suffix.startsWith("/contributions")
        ? {
            contributions: [
              {
                id: "acme.guard.approve",
                kind: "guard",
                key: "proposal.approve",
                from: "AcmeModule",
                builtin: false,
                enabled: false,
                position: 0,
                config: {},
                subjects: [],
                when: null,
                description: "",
              },
            ],
            skipped: [],
          }
        : {
            actions: [
              {
                key: "proposal.approve",
                contribution: "company-proposals.action.approve",
                subjects: ["proposal"],
                params: {},
                description: "Approve",
                builtin: true,
                allowed: false,
                refusal: { status: 409, code: "proposal_status", message: "merged" },
              },
            ],
          },
    );
    await h.exec(["org", "action", "ls", "--subject", "proposal:12"]);
    expect(h.calls[0]).toEqual({ method: "GET", suffix: "?agentId=dev1&subject=proposal%3A12" });
    expect(h.out.join("")).toContain("proposal.approve");
    expect(h.out.join("")).toContain("no (proposal_status)");
    await h.exec(["org", "action", "ls", "--all"]);
    expect(h.calls[1]).toEqual({ method: "GET", suffix: "/contributions?agentId=dev1" });
    expect(h.out.join("")).toContain("acme.guard.approve");
  });

  it("run posts the subject and the parameters by key; exec by contribution; both print the result", async () => {
    const h = harness(() => ({ run: run(), result: { number: 12, status: "approved" } }));
    await h.exec([
      "org",
      "action",
      "run",
      "proposal.reject",
      "proposal:12",
      "--param",
      "reason=superseded by #13",
      "--params",
      '{"extra":1}',
      "--request-id",
      "abc",
    ]);
    expect(h.calls[0]).toEqual({
      method: "POST",
      suffix: "/proposal.reject/runs",
      body: {
        subject: "proposal:12",
        params: { extra: 1, reason: "superseded by #13" },
        via: "cli",
        requestId: "abc",
        agentId: "dev1",
      },
    });
    expect(JSON.parse(h.out[0]!)).toEqual({ number: 12, status: "approved" });
    await h.exec(["org", "action", "exec", "company-proposals.action.approve", "proposal:12"]);
    expect(h.calls[1]!.suffix).toBe("/by-id/company-proposals.action.approve/runs");
  });

  it("a run that started a process is followed to its end", async () => {
    const h = harness((method) =>
      method === "POST"
        ? { run: run({ key: "deploy.x", outcome: null, result: null }), result: null }
        : { run: run({ key: "deploy.x" }), output: "done\n", from: 0, next: 5 },
    );
    await h.exec(["org", "action", "run", "deploy.x", "proposal:12"]);
    expect(h.calls[1]!.suffix).toBe("/runs/r9?agentId=dev1&from=0");
    expect(h.out.join("")).toContain("done\n");
    expect(h.errors).toEqual([]);
  });

  it("runs pages the Activity with its filters and prints the next cursor", async () => {
    const h = harness(() => ({ runs: [run()], next: "2026-10-03T00:00:00.000Z|r9" }));
    await h.exec([
      "org",
      "action",
      "runs",
      "--subject",
      "proposal:12",
      "--by",
      "agent:dev1",
      "--key",
      "proposal.approve",
      "--limit",
      "1",
    ]);
    expect(h.calls[0]!.suffix).toBe(
      "/runs?agentId=dev1&subject=proposal%3A12&by=agent%3Adev1&key=proposal.approve&limit=1",
    );
    expect(h.out.join("")).toContain("proposal:12");
    expect(h.out.at(-1)).toBe(`${t.org.actionRunsNext("2026-10-03T00:00:00.000Z|r9")}\n`);
    await h.exec(["org", "action", "runs", "--limit", "500"]);
    expect(h.errors).toEqual([t.org.actionLimitInvalid("500")]);
  });

  it("check lists the conflicts, or says there are none", async () => {
    let conflicts: unknown[] = [
      { key: "proposal.approve", kind: "guard", contributions: ["a.guard", "b.guard"] },
    ];
    const h = harness(() => ({ conflicts, skipped: [] }));
    await h.exec(["org", "action", "check"]);
    expect(h.calls[0]).toEqual({ method: "GET", suffix: "/check?agentId=dev1" });
    expect(h.out[0]).toBe(
      `${t.org.actionConflict("proposal.approve", "guard", "a.guard, b.guard")}\n`,
    );
    conflicts = [];
    await h.exec(["org", "action", "check"]);
    expect(h.out[1]).toBe(`${t.org.actionCheckNone}\n`);
  });

  it("bind runs action.bind on the organization with the contribution, on or off, position and config", async () => {
    const h = harness(() => ({
      run: run({ key: "action.bind" }),
      result: { contribution: "acme.deploy", enabled: true, position: 2, config: { a: 1 } },
    }));
    await h.exec([
      "org",
      "action",
      "bind",
      "acme.deploy",
      "--on",
      "--position",
      "2",
      "--config",
      '{"a":1}',
    ]);
    expect(h.calls[0]).toEqual({
      method: "POST",
      suffix: "/action.bind/runs",
      body: {
        subject: "organization",
        params: { contribution: "acme.deploy", enabled: true, position: 2, config: { a: 1 } },
        via: "cli",
        agentId: "dev1",
      },
    });
    expect(h.out[0]).toBe(`${t.org.actionBound("acme.deploy", true, 2)}\n`);
    await h.exec(["org", "action", "bind", "acme.deploy"]);
    expect(h.errors).toEqual([t.org.actionBindOneOf]);
  });
});

describe("parseParams", () => {
  it("takes a value as JSON when it parses, else as the string; refuses a flag without a name", () => {
    expect(parseParams(["n=3", "s=hello", 'o={"a":true}'], undefined)).toEqual({
      params: { n: 3, s: "hello", o: { a: true } },
    });
    expect(parseParams(["=x"], undefined)).toEqual({ error: "=x" });
    expect(parseParams([], "[1]")).toEqual({ error: "[1]" });
  });
});
