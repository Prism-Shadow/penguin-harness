/**
 * `penguin org action` and `penguin org workflow` over a stub transport: each command is one
 * route — of the Action registry, or of the organization's company workflows — sent with the
 * caller's identity, and prints what that route answered; a workflow put sends a local
 * directory's files as one `workflow.write` run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionRunView } from "@prismshadow/penguin-server/api";
import { getMessages } from "../src/i18n.js";
import { registerOrgAction } from "../src/commands/action.js";
import { readWorkflowDir, registerOrgWorkflow } from "../src/commands/workflow.js";
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
  mount((program, kit) => {
    const org = program.command("org");
    registerOrgAction(org, t, kit);
    registerOrgWorkflow(org, t, kit);
  }, answer);

describe("penguin org action", () => {
  it("ls lists the Actions in force, with the guard's answer for a subject; --all lists every contribution", async () => {
    const h = harness((_m, suffix) =>
      suffix.startsWith("/contributions")
        ? {
            contributions: [
              {
                id: "acme.guard.approve",
                kind: "guard",
                key: "proposal.approve",
                from: "Workflow",
                builtin: false,
                workflow: "acme",
                replaced: false,
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
});

const view = (over: Record<string, unknown> = {}) => ({
  id: "deploy",
  name: "@acme/deploy",
  version: "0.1.0",
  revision: "aaaaaaaaaaaa",
  serving: "aaaaaaaaaaaa",
  loadedAt: "2026-10-03T00:00:00.000Z",
  error: null,
  contributions: ["acme.deploy.desktop"],
  skipped: [],
  files: ["index.ts", "package.json"],
  ...over,
});

describe("penguin org workflow", () => {
  it("ls and history read the workflow routes", async () => {
    const h = harness((_m, suffix) =>
      suffix.includes("/history")
        ? { versions: [{ revision: "aaaaaaaaaaaa", savedAt: "2026-10-03", files: ["a", "b"] }] }
        : { workflows: [view(), view({ id: "broken", serving: null, error: "TS2322 no\nmore" })] },
    );
    await h.exec(["org", "workflow", "ls"]);
    expect(h.calls[0]).toEqual({ method: "GET", suffix: "?agentId=dev1" });
    const out = h.out.join("");
    expect(out).toContain("deploy");
    expect(out).toContain("TS2322 no");
    await h.exec(["org", "workflow", "history", "deploy"]);
    expect(h.calls[1]).toEqual({ method: "GET", suffix: "/deploy/history?agentId=dev1" });
    expect(h.out.join("")).toContain("aaaaaaaaaaaa");
  });

  it("put sends a local directory as one workflow.write run, and reports whether it loaded", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-put-"));
    try {
      fs.writeFileSync(path.join(dir, "package.json"), "{}");
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src", "a.ts"), "export {};");
      fs.mkdirSync(path.join(dir, ".harness"));
      fs.writeFileSync(path.join(dir, ".harness", "plugin.d.ts"), "");
      fs.mkdirSync(path.join(dir, "node_modules"));
      expect(readWorkflowDir(dir)).toEqual({
        files: { "package.json": "{}", "src/a.ts": "export {};" },
      });
      let loaded = true;
      const h = harness(() => ({
        run: run({ key: "workflow.write", subject: "workflow:deploy" }),
        result: loaded
          ? { workflow: view(), loaded: true, error: null }
          : { workflow: view({ error: "TS2322 nope" }), loaded: false, error: "TS2322 nope" },
      }));
      await h.exec(["org", "workflow", "put", "deploy", dir]);
      expect(h.calls[0]).toEqual({
        method: "POST",
        suffix: "/workflow.write/runs",
        body: {
          subject: "workflow:deploy",
          params: { files: { "package.json": "{}", "src/a.ts": "export {};" }, replace: true },
          via: "cli",
          agentId: "dev1",
        },
      });
      expect(h.out[0]).toBe(`${t.org.workflowLoaded("deploy", "aaaaaaaaaaaa")}\n`);
      loaded = false;
      await h.exec(["org", "workflow", "put", "deploy", dir, "--keep"]);
      expect((h.calls[1]?.body as { params: Record<string, unknown> }).params.replace).toBe(
        undefined,
      );
      expect(h.errors).toEqual([t.org.workflowNotLoaded("deploy", "TS2322 nope")]);
      expect(h.exits).toEqual([1]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rm, reload and rollback each run their workflow.* Action on the workflow", async () => {
    const h = harness((_m, suffix) =>
      suffix.startsWith("/workflow.remove")
        ? { run: run({ key: "workflow.remove" }), result: { removed: "deploy" } }
        : { run: run(), result: { workflow: view(), loaded: true, error: null } },
    );
    await h.exec(["org", "workflow", "rm", "deploy"]);
    await h.exec(["org", "workflow", "reload", "deploy"]);
    await h.exec(["org", "workflow", "rollback", "deploy", "aaaaaaaaaaaa"]);
    expect(h.calls.map((c) => [c.suffix, (c.body as { params: unknown }).params])).toEqual([
      ["/workflow.remove/runs", {}],
      ["/workflow.reload/runs", {}],
      ["/workflow.rollback/runs", { revision: "aaaaaaaaaaaa" }],
    ]);
    expect(h.out[0]).toBe(`${t.org.workflowRemoved("deploy")}\n`);
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
