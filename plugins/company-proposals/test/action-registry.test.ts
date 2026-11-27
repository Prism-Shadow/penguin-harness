/**
 * The registry over contributions of the test's own: a key resolved to one contribution, a
 * company workflow's taking the place of the built-in one on its key, an ambiguous key answered
 * only when invoked (with each contribution's exact invocation) and never recorded, two company
 * guards answered the same way, `exec` by an action's or a guard's id, the `workflow.*`
 * Actions out of a company workflow's reach, a guard replacement handed the default, hooks in
 * their order (built-in first, then by workflow and id), and how each refusal and failure ends
 * (a 5xx failure keeping its status) —
 * and a retry with the same request id answered with the first run; a write's notice resolved by
 * its key under the same rules, and a notify Action refused on its own.
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
import { actionApp, type ActionApp } from "./action-harness.js";
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

const action = (id: string, key: string, workflow?: string): Omit<Contributed, "code"> => ({
  id,
  from: workflow === undefined ? "CompanyProposalsPlugin" : "Workflow",
  data: { kind: "action", key, subjects: ["organization"], params: { "text?": "string" } },
  ...(workflow !== undefined ? { workflow } : {}),
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
  /** The registries the tests opened: stopped, so their store connections close. */
  const apps: ActionApp[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) a.registry.stop();
    db.close();
    await org.cleanup();
  });

  const appOf = (contributions: Contributed[]) => {
    const a = actionApp({ gateway, root: org.root, project: PROJECT, org: ORG, contributions });
    apps.push(a);
    return a;
  };

  /** `POST …/actions/by-id/<id>/runs`: one contribution named exactly. */
  const exec = (a: ReturnType<typeof appOf>, id: string, params: Record<string, unknown> = {}) =>
    a.run(`by-id/${id}`, "organization", params);

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
    // The ambiguity comes before any Action is chosen: no run is recorded for it.
    expect((await a.get("/runs")).body.runs).toEqual([]);
    const exact = await exec(a, "t.two", { text: "exact" });
    expect(exact.status).toBe(200);
    expect((exact.body.run as { contribution: string }).contribution).toBe("t.two");
    const check = await a.get("/check");
    expect(check.body.conflicts).toEqual([
      { key: "test.note", kind: "action", contributions: ["t.one", "t.two"] },
    ]);
  });

  it("a company workflow's action takes the place of the built-in one on its key; two of them are ambiguous", async () => {
    const builtin = { ...action("t.note", "test.note"), code: noteAction(() => db) };
    const mine = { ...action("co.note", "test.note", "acme"), code: noteAction(() => db) };
    const a = appOf([builtin, mine]);
    const ran = await a.run("test.note", "organization", { text: "company" });
    expect(ran.body.run).toMatchObject({ contribution: "co.note", outcome: "succeeded" });
    // The built-in one is still there to be run by its id, and listed as replaced.
    const listed = (await a.get("/contributions")).body.contributions as Array<{
      id: string;
      workflow: string | null;
      replaced: boolean;
    }>;
    expect(listed.find((c) => c.id === "t.note")).toMatchObject({ workflow: null, replaced: true });
    expect(listed.find((c) => c.id === "co.note")).toMatchObject({
      workflow: "acme",
      replaced: false,
    });
    expect(
      ((await a.get("/")).body.actions as Array<{ contribution: string }>).map(
        (x) => x.contribution,
      ),
    ).toEqual(["co.note"]);
    const two = appOf([
      builtin,
      mine,
      { ...action("co.other", "test.note", "zeta"), code: noteAction(() => db) },
    ]);
    const amb = await two.run("test.note", "organization", { text: "x" });
    expect(amb.status).toBe(409);
    expect(amb.body.error).toMatchObject({ code: "action_ambiguous" });
    expect((await two.get("/check")).body.conflicts).toEqual([
      { key: "test.note", kind: "action", contributions: ["co.note", "co.other"] },
    ]);
  });

  it("answers two company guards on a key as two actions are answered, unrecorded; exec by a guard's id lets it judge alone", async () => {
    const guard = (id: string, workflow: string, verdict: "yes" | "no"): Contributed => ({
      id,
      from: "Workflow",
      data: { kind: "guard", key: "test.note" },
      code: (() => () => {
        if (verdict === "no") throw new ActionRefusal(403, `${workflow}_says_no`, "No.");
      }) as GuardCode,
      workflow,
    });
    const a = appOf([
      { ...action("t.note", "test.note"), code: noteAction(() => db) },
      guard("co.no", "acme", "no"),
      guard("co.yes", "beta", "yes"),
      {
        id: "h.seen",
        from: "CompanyProposalsPlugin",
        data: { kind: "hook", key: "test.note", when: "before" },
        code: (() => undefined) as HookCode,
      },
    ]);
    const amb = await a.run("test.note", "organization", { text: "x" });
    expect([amb.status, amb.body.error]).toMatchObject([
      409,
      {
        code: "action_ambiguous",
        contributions: [
          {
            contribution: "co.no",
            route: "POST …/actions/by-id/co.no/runs",
            cli: "penguin org action exec co.no",
          },
          {
            contribution: "co.yes",
            route: "POST …/actions/by-id/co.yes/runs",
            cli: "penguin org action exec co.yes",
          },
        ],
      },
    ]);
    // The action's own id resolves its guard by key as usual: ambiguous the same way.
    const byAction = await exec(a, "t.note", { text: "x" });
    expect([byAction.status, byAction.body.error]).toMatchObject([
      409,
      { code: "action_ambiguous", contributions: [{ contribution: "co.no" }, {}] },
    ]);
    expect((await a.get("/runs")).body.runs).toEqual([]);
    // A guard's id runs the key's Action, judged by that guard alone.
    const yes = await exec(a, "co.yes", { text: "allowed" });
    expect(yes.status).toBe(200);
    expect(yes.body.run).toMatchObject({ key: "test.note", contribution: "t.note" });
    const no = await exec(a, "co.no", { text: "refused" });
    expect([no.status, no.body.error]).toMatchObject([403, { code: "acme_says_no" }]);
    expect(notes()).toEqual(["allowed"]);
    const runs = (await a.get("/runs")).body.runs as Array<{ outcome: string; code: string }>;
    expect(runs.map((r) => [r.outcome, r.code])).toEqual([
      ["refused", "acme_says_no"],
      ["succeeded", null],
    ]);
    // Neither a hook's id nor an unknown one names something to run.
    expect((await exec(a, "h.seen")).body.error).toMatchObject({ code: "action_not_found" });
    expect((await exec(a, "nope")).status).toBe(404);
  });

  it("leaves out a company workflow's contribution that would replace or hook the workflow.* Actions", async () => {
    const a = appOf([
      { ...action("t.note", "test.note"), code: noteAction(() => db) },
      {
        id: "co.lock",
        from: "Workflow",
        data: { kind: "guard", key: "workflow.write" },
        code: (() => () => undefined) as GuardCode,
        workflow: "acme",
      },
      {
        id: "co.watch",
        from: "Workflow",
        data: { kind: "hook", key: "workflow.*", when: "before" },
        code: (() => undefined) as HookCode,
        workflow: "acme",
      },
    ]);
    const skipped = (await a.get("/contributions")).body.skipped as Array<{ id: string }>;
    expect(skipped.map((x) => x.id).sort()).toEqual(["co.lock", "co.watch"]);
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
    const note = {
      ...action("t.note", "test.note"),
      code: noteAction(() => db, { guard: strict }),
    };
    expect((await appOf([note]).run("test.note", "organization", {}, DEV)).body).toMatchObject({
      error: { code: "people_only" },
    });
    const a = appOf([
      note,
      {
        id: "co.loose",
        from: "Workflow",
        data: { kind: "guard", key: "test.note" },
        code: replace,
        workflow: "acme",
      },
    ]);
    expect((await a.run("test.note", "organization", { text: "loose" }, DEV)).status).toBe(200);
    expect(handed).toBe(strict);
  });

  it("runs the built-in hooks first, by id, then the company workflows', by workflow and id", async () => {
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
    const company = (id: string, workflow: string, name: string): Contributed => ({
      id,
      from: "Workflow",
      data: { kind: "hook", key: "test.note", when: "before" },
      code: hook(name),
      workflow,
    });
    const b = appOf([
      { ...action("t.note", "test.note"), code: noteAction(() => db) },
      company("w2.a", "w2", "w2a"),
      company("w1.b", "w1", "w1b"),
      company("w1.a", "w1", "w1a"),
      {
        id: "h.z",
        from: "CompanyProposalsPlugin",
        data: { kind: "hook", key: "test.note", when: "before" },
        code: hook("builtin"),
      },
    ]);
    await b.run("test.note", "organization", { text: "2" });
    expect(order).toEqual(["builtin:before", "w1a:before", "w1b:before", "w2a:before"]);
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
      {
        ...action("t.domain", "test.domain"),
        code: {
          run: async () => {
            throw Object.assign(new Error("Register the impl PR first."), {
              status: 409,
              code: "impl_pr_missing",
            });
          },
        } satisfies ActionCode,
      },
      {
        ...action("t.forge", "test.forge"),
        code: {
          run: async () => {
            throw Object.assign(new Error("acme/site:feat/x could not be read from GitHub."), {
              status: 502,
              code: "branch_unreadable",
            });
          },
        } satisfies ActionCode,
      },
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
    // A domain error with a 4xx status the run throws is a refusal, with its status and code.
    const domain = await a.run("test.domain", "organization", { text: "d" });
    expect([domain.status, domain.body.error]).toMatchObject([409, { code: "impl_pr_missing" }]);
    // One with a 5xx status is a failure, still answered with its own status and code.
    const forge = await a.run("test.forge", "organization", { text: "f" });
    expect([forge.status, forge.body.error]).toMatchObject([502, { code: "branch_unreadable" }]);
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
    expect(byKey["test.domain"]).toMatchObject({
      outcome: "refused",
      status: 409,
      code: "impl_pr_missing",
    });
    expect(byKey["test.forge"]).toMatchObject({
      outcome: "failed",
      status: 502,
      code: "branch_unreadable",
    });
    expect(byKey["test.broken"]).toMatchObject({ status: 500 });
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

  it("a write's notice is a notify Action run by key, under the same rules: a company's replaces the built-in, two are ambiguous, and neither runs on its own", async () => {
    const told: Array<{ by: string; params: Record<string, unknown> }> = [];
    const notice = (id: string, workflow?: string): Contributed => ({
      id,
      from: workflow === undefined ? "CompanyProposalsPlugin" : "Workflow",
      data: {
        kind: "action",
        key: "notify.test.noted",
        subjects: ["organization"],
        params: { to: "string[]", text: "string", runId: "string" },
      },
      ...(workflow !== undefined ? { workflow } : {}),
      code: {
        run: async (ctx) => {
          told.push({ by: id, params: ctx.params });
          return { delivered: ctx.params.to, failed: [] };
        },
      } satisfies ActionCode,
    });
    // A write that sends one notice once it wrote, and answers how it went.
    const noting: Contributed = {
      ...action("t.note", "test.note"),
      code: {
        run: async (ctx) => {
          await noteAction(() => db).run(ctx);
          return ctx.act.notify!({
            key: "notify.test.noted",
            subject: "organization",
            params: { to: ["acme_dev"], text: "noted" },
          });
        },
      } satisfies ActionCode,
    };
    const builtin = appOf([noting, notice("t.noted")]);
    const ran = await builtin.run("test.note", "organization", { text: "one" }, DEV);
    expect(ran.status).toBe(200);
    const runId = (ran.body.run as { id: string }).id;
    expect(told).toEqual([{ by: "t.noted", params: { to: ["acme_dev"], text: "noted", runId } }]);
    const [sent] = (await builtin.get("/runs?key=notify.test.noted")).body.runs as Array<
      Record<string, unknown>
    >;
    expect(sent).toMatchObject({
      contribution: "t.noted",
      by: "agent:acme_dev",
      via: "notify",
      outcome: "succeeded",
    });

    told.length = 0;
    const replaced = appOf([noting, notice("t.noted"), notice("co.noted", "acme")]);
    expect((await replaced.run("test.note", "organization", { text: "two" })).status).toBe(200);
    expect(told.map((t) => t.by)).toEqual(["co.noted"]);

    told.length = 0;
    const ambiguous = appOf([
      noting,
      notice("t.noted"),
      notice("co.noted", "acme"),
      notice("co.other", "zeta"),
    ]);
    const amb = await ambiguous.run("test.note", "organization", { text: "three" });
    // The write stands; the notice that could not resolve is listed with the run.
    expect(amb.status).toBe(200);
    expect(amb.body.result).toMatchObject({ ok: false });
    expect((amb.body.run as { hookErrors: string[] }).hookErrors).toEqual([
      expect.stringMatching(/^notify\.test\.noted: /),
    ]);
    expect(told).toEqual([]);
    expect(notes()).toEqual(["one", "two", "three"]);

    const direct = await builtin.run("notify.test.noted", "organization", {
      to: ["acme_dev"],
      text: "spoofed",
      runId: "x",
    });
    expect([direct.status, direct.body.error]).toMatchObject([403, { code: "notify_direct" }]);
    expect(told).toEqual([]);
  });
});
