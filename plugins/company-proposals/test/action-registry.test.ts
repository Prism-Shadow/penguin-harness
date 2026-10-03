/**
 * The registry over contributions of the test's own: a key resolved to one bound contribution,
 * an ambiguous key answered only when invoked (with each contribution's exact invocation),
 * `exec` by id, a company contribution invisible until bound, a guard replacement handed the
 * default, hooks in their binding order, and how each refusal and failure ends — and a retry
 * with the same request id answered with the first run.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  ActionRefusal,
  companyDbPath,
  openCompanyDb,
  type ActionCode,
  type Contributed,
  type Guard,
  type GuardCode,
  type HookCode,
} from "../src/index.js";
import { immediate } from "../src/schema.js";
import { actionApp } from "./action-harness.js";
import { BOSS, DEV, ORG, PROJECT, fakeOrg, type FakeOrgGateway } from "./fake-org.js";

/** A write of the test's own: one row in a table of company.db, the run's start row in its transaction. */
function noteAction(
  db: () => DatabaseSync,
  opts: { fail?: boolean; guard?: Guard } = {},
): ActionCode {
  return {
    ...(opts.guard !== undefined ? { guard: opts.guard } : {}),
    run: async (ctx) => {
      immediate(db(), () => {
        ctx.act.guard({
          caller: ctx.caller,
          subject: ctx.subject,
          state: null,
          params: ctx.params,
        });
        db()
          .prepare(`INSERT INTO notes (text) VALUES (?)`)
          .run(String(ctx.params.text ?? ""));
        ctx.act.inTx?.(db());
        if (opts.fail === true) throw new Error("the write broke");
      });
      return { noted: ctx.params.text ?? "" };
    },
  };
}

const action = (
  id: string,
  key: string,
  from = "CompanyProposalsPlugin",
): Omit<Contributed, "code"> => ({
  id,
  from,
  data: { kind: "action", key, subjects: ["organization"], params: { "text?": "string" } },
});

describe("the Action registry", () => {
  let org: Awaited<ReturnType<typeof fakeOrg>>;
  let gateway: FakeOrgGateway;
  let db: DatabaseSync;
  const notes = () =>
    (db.prepare(`SELECT text FROM notes ORDER BY rowid`).all() as Array<{ text: string }>).map(
      (r) => r.text,
    );

  beforeEach(async () => {
    org = await fakeOrg();
    gateway = org.gateway;
    db = openCompanyDb(
      companyDbPath(org.root, PROJECT, ORG),
      `CREATE TABLE IF NOT EXISTS notes (text TEXT NOT NULL);`,
    );
  });
  afterEach(async () => {
    db.close();
    await org.cleanup();
  });

  const appOf = (contributions: Contributed[]) =>
    actionApp({ gateway, root: org.root, project: PROJECT, org: ORG, contributions });

  it("resolves a key to its one bound contribution; an unknown key is 404", async () => {
    const a = appOf([{ ...action("t.note", "test.note"), code: noteAction(() => db) }]);
    const ran = await a.run("test.note", "organization", { text: "one" });
    expect(ran.status).toBe(200);
    expect(ran.body.result).toEqual({ noted: "one" });
    expect(ran.body.run).toMatchObject({
      key: "test.note",
      contribution: "t.note",
      outcome: "succeeded",
      by: "user:boss",
    });
    expect(notes()).toEqual(["one"]);
    expect((await a.run("test.none", "organization")).body).toMatchObject({
      error: { code: "action_not_found" },
    });
  });

  it("answers an ambiguous key only when invoked, listing each exact invocation; exec runs one by id", async () => {
    const a = appOf([
      { ...action("t.one", "test.note"), code: noteAction(() => db) },
      { ...action("t.two", "test.note"), code: noteAction(() => db) },
    ]);
    const amb = await a.run("test.note", "organization", { text: "x" });
    expect(amb.status).toBe(409);
    const error = amb.body.error as {
      code: string;
      contributions: Array<{ contribution: string; cli: string }>;
    };
    expect(error.code).toBe("action_ambiguous");
    expect(error.contributions.map((c) => c.cli)).toEqual([
      "penguin org action exec t.one",
      "penguin org action exec t.two",
    ]);
    const res = await a.app.request(`/p/${PROJECT}/o/${ORG}/actions/by-id/t.two/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "boss" },
      body: JSON.stringify({ subject: "organization", params: { text: "exact" } }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { run: { contribution: string } }).run.contribution).toBe(
      "t.two",
    );
    const check = await a.get("/check");
    expect(check.body.conflicts).toEqual([
      { key: "test.note", kind: "action", contributions: ["t.one", "t.two"] },
    ]);
  });

  it("a company module's contribution is invisible until the organization binds it, and gone again once unbound", async () => {
    const a = appOf([
      { ...action("co.note", "company.note", "SomeCompanyModule"), code: noteAction(() => db) },
    ]);
    expect((await a.run("company.note", "organization")).status).toBe(404);
    expect((await a.get("/")).body.actions).toEqual([]);
    const bound = await a.run("action.bind", "organization", {
      contribution: "co.note",
      enabled: true,
    });
    expect(bound.status).toBe(200);
    expect((await a.run("company.note", "organization", { text: "now" })).status).toBe(200);
    await a.run("action.bind", "organization", { contribution: "co.note", enabled: false });
    expect((await a.run("company.note", "organization")).status).toBe(404);
    // The bindings' history is the action.bind runs.
    const runs = (await a.get("/runs?key=action.bind")).body.runs as Array<{
      params: { enabled: boolean };
    }>;
    expect(runs.map((r) => r.params.enabled)).toEqual([false, true]);
  });

  it("action.bind is not replaced, hooked or unbound by a contribution", async () => {
    const a = appOf([
      {
        id: "co.bind-guard",
        from: "Co",
        data: { kind: "guard", key: "action.bind" },
        code: (() => () => undefined) as GuardCode,
      },
    ]);
    const refused = await a.run("action.bind", "organization", {
      contribution: "co.bind-guard",
      enabled: true,
    });
    expect(refused.body).toMatchObject({ error: { code: "bind_protected" } });
  });

  it("a guard replacement is handed the default guard; it may tighten or loosen it", async () => {
    let handed: Guard | null = null;
    const strict: Guard = ({ caller }) => {
      if (caller.agentId !== null) throw new ActionRefusal(403, "people_only", "No.");
    };
    const replace: GuardCode = (defaults) => {
      handed = defaults;
      return () => undefined;
    };
    const a = appOf([
      { ...action("t.note", "test.note"), code: noteAction(() => db, { guard: strict }) },
      { id: "co.loose", from: "Co", data: { kind: "guard", key: "test.note" }, code: replace },
    ]);
    expect((await a.run("test.note", "organization", {}, DEV)).body).toMatchObject({
      error: { code: "people_only" },
    });
    await a.run("action.bind", "organization", { contribution: "co.loose", enabled: true });
    expect((await a.run("test.note", "organization", { text: "loose" }, DEV)).status).toBe(200);
    expect(handed).toBe(strict);
  });

  it("runs the before and after hooks in their binding's position, then by id", async () => {
    const order: string[] = [];
    const hook =
      (name: string): HookCode =>
      (e) => {
        order.push(`${name}:${e.when}${e.outcome === undefined ? "" : `:${e.outcome}`}`);
      };
    const a = appOf([
      { ...action("t.note", "test.note"), code: noteAction(() => db) },
      {
        id: "h.b",
        from: "CompanyProposalsPlugin",
        data: { kind: "hook", key: "test.note", when: "before" },
        code: hook("b"),
      },
      {
        id: "h.a",
        from: "CompanyProposalsPlugin",
        data: { kind: "hook", key: "test.note", when: "before" },
        code: hook("a"),
      },
      {
        id: "h.after",
        from: "CompanyProposalsPlugin",
        data: { kind: "hook", key: "test.*", when: "after" },
        code: hook("z"),
      },
    ]);
    await a.run("test.note", "organization", { text: "1" });
    expect(order).toEqual(["a:before", "b:before", "z:after:succeeded"]);
    order.length = 0;
    await a.run("action.bind", "organization", { contribution: "h.a", enabled: true, position: 5 });
    await a.run("test.note", "organization", { text: "2" });
    expect(order).toEqual(["b:before", "a:before", "z:after:succeeded"]);
  });

  it("ends each way as it should: a guard or before hook refuses and nothing is written; a failed write rolls back; a failed after hook leaves the write", async () => {
    const no: Guard = () => {
      throw new ActionRefusal(409, "not_now", "Not now.");
    };
    const a = appOf([
      { ...action("t.refused", "test.refused"), code: noteAction(() => db, { guard: no }) },
      { ...action("t.hooked", "test.hooked"), code: noteAction(() => db) },
      {
        id: "h.no",
        from: "CompanyProposalsPlugin",
        data: { kind: "hook", key: "test.hooked", when: "before" },
        code: (() => {
          throw new Error("closed");
        }) as HookCode,
      },
      { ...action("t.broken", "test.broken"), code: noteAction(() => db, { fail: true }) },
      { ...action("t.after", "test.after"), code: noteAction(() => db) },
      {
        id: "h.bad",
        from: "CompanyProposalsPlugin",
        data: { kind: "hook", key: "test.after", when: "after" },
        code: (() => {
          throw new Error("mail down");
        }) as HookCode,
      },
    ]);
    const refused = await a.run("test.refused", "organization", { text: "r" });
    expect(refused.status).toBe(409);
    const hooked = await a.run("test.hooked", "organization", { text: "h" });
    expect(hooked.body).toMatchObject({ error: { code: "hook_refused" } });
    const broken = await a.run("test.broken", "organization", { text: "b" });
    expect(broken.status).toBe(500);
    const after = await a.run("test.after", "organization", { text: "a" });
    expect(after.status).toBe(200);
    expect(notes()).toEqual(["a"]);
    const runs = (await a.get("/runs")).body.runs as Array<{
      key: string;
      outcome: string;
      code: string | null;
      hookErrors: string[];
    }>;
    const byKey = Object.fromEntries(runs.map((r) => [r.key, r]));
    expect(byKey["test.refused"]).toMatchObject({ outcome: "refused", code: "not_now" });
    expect(byKey["test.hooked"]).toMatchObject({ outcome: "refused", code: "hook_refused" });
    expect(byKey["test.broken"]).toMatchObject({ outcome: "failed", code: "internal" });
    expect(byKey["test.after"]).toMatchObject({
      outcome: "succeeded",
      hookErrors: ["h.bad: mail down"],
    });
  });

  it("checks the subject and the parameters before anything runs, and records the refusal", async () => {
    const a = appOf([{ ...action("t.note", "test.note"), code: noteAction(() => db) }]);
    expect((await a.run("test.note", "proposal:1")).body).toMatchObject({
      error: { code: "bad_subject" },
    });
    expect((await a.run("test.note", "nonsense")).body).toMatchObject({
      error: { code: "bad_subject" },
    });
    expect((await a.run("test.note", "organization", { text: 3 })).body).toMatchObject({
      error: { code: "bad_params" },
    });
    expect((await a.run("test.note", "organization", { other: "x" })).body).toMatchObject({
      error: { code: "bad_params" },
    });
    const runs = (await a.get("/runs")).body.runs as Array<{ outcome: string }>;
    expect(runs.map((r) => r.outcome)).toEqual(["refused", "refused", "refused", "refused"]);
    expect(notes()).toEqual([]);
  });

  it("a retry with the same request id answers the first run and runs nothing", async () => {
    const a = appOf([{ ...action("t.note", "test.note"), code: noteAction(() => db) }]);
    const first = await a.run("test.note", "organization", { text: "once" }, BOSS, {
      requestId: "r-1",
    });
    const again = await a.run("test.note", "organization", { text: "once" }, BOSS, {
      requestId: "r-1",
    });
    expect((again.body.run as { id: string }).id).toBe((first.body.run as { id: string }).id);
    expect(again.body.result).toEqual({ noted: "once" });
    expect(notes()).toEqual(["once"]);
  });

  it("answers 404 while company mode is off and 403 to someone outside the Project", async () => {
    const a = appOf([{ ...action("t.note", "test.note"), code: noteAction(() => db) }]);
    expect((await a.run("test.note", "organization", {}, { userId: "stranger" })).status).toBe(403);
    gateway.enabled = false;
    expect((await a.run("test.note", "organization")).status).toBe(404);
  });
});
