/**
 * Session search, end to end: real Trace files on disk, the real indexer, the real FTS5
 * table, the real route.
 *
 * The bug this whole surface exists for is a *recall* bug, and every case below is a person
 * remembering a conversation by something they said in it: "软著" said in a message body
 * rather than in a title, "ERP" in Latin letters, both words in one message, a machine prompt
 * that must not be searchable, and a session that must not leak across Projects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestBegin, requestEnd, sessionMeta, userText } from "@prismshadow/penguin-core";
import type { ProjectCreateResponse, SearchResults, SessionTurns } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

// These drive a real Trace tree through the indexer and wait for its pass to settle, which on
// a loaded machine takes tens of seconds per case — far past vitest's 5s default.
vi.setConfig({ testTimeout: 120_000 });

const ERP_SESSION = "session-2026-09-28-01-00-00-erp00001";
const OTHER_SESSION = "session-2026-09-28-02-00-00-doc00002";

/** A conversation whose title says nothing useful and whose body says exactly what was asked. */
const erpRecords = [
  sessionMeta({
    source: "user",
    session_id: ERP_SESSION,
    model_id: "m",
    provider: "p",
    model_context_window: 1000,
    system_prompt: "系统提示词里提到软著，但那不是任何人说的话",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
  }),
  userText("早上那个 ERP 软著提交到版权中心了吗"),
  requestBegin(),
  requestEnd("completed"),
];

const otherRecords = [
  sessionMeta({
    source: "user",
    session_id: OTHER_SESSION,
    model_id: "m",
    provider: "p",
    model_context_window: 1000,
    system_prompt: "",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
  }),
  userText("招标响应文件的报价上限是多少"),
  requestBegin(),
  requestEnd("completed"),
];

describe("session search", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;

  const search = async (q: string, extra = ""): Promise<SearchResults> => {
    const res = await owner.get(
      `/api/projects/${projectId}/sessions/search?q=${encodeURIComponent(q)}${extra}`,
    );
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-search", name: "Project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    await writeTraceFile(
      t.root,
      projectId,
      "default_agent",
      "2026-09-28",
      ERP_SESSION,
      0,
      erpRecords,
    );
    await writeTraceFile(
      t.root,
      projectId,
      "default_agent",
      "2026-09-28",
      OTHER_SESSION,
      0,
      otherRecords,
    );
  }, 60_000);

  afterEach(async () => {
    await t.cleanup();
  }, 60_000);

  it("finds a conversation by a two-character Chinese word that is only in its body", async () => {
    const r = await search("软著");
    expect(r.results.map((x) => x.sessionId)).toEqual([ERP_SESSION]);
    expect(r.results[0]!.matchedTitle).toBe(false);
    expect(r.results[0]!.matchCount).toBe(1);
    expect(r.results[0]!.hits[0]!.role).toBe("user");
    expect(r.results[0]!.hits[0]!.snippet).toContain("软著");
  });

  it("marks the matched span inside the snippet", async () => {
    const r = await search("软著");
    const hit = r.results[0]!.hits[0]!;
    expect(hit.marks.length).toBe(1);
    expect(hit.snippet.slice(hit.marks[0]![0], hit.marks[0]![1])).toBe("软著");
  });

  it("finds a conversation by a Latin word, case-insensitively", async () => {
    for (const q of ["ERP", "erp", "Erp"]) {
      const r = await search(q);
      expect(
        r.results.map((x) => x.sessionId),
        q,
      ).toEqual([ERP_SESSION]);
    }
  });

  it("ANDs the words of one query, so a session must contain all of them", async () => {
    expect((await search("软著 ERP")).results.map((x) => x.sessionId)).toEqual([ERP_SESSION]);
    expect((await search("软著 报价上限")).results).toEqual([]);
  });

  it("does not match the assembled system prompt, which is not anybody's words", async () => {
    // The system prompt of THIS project mentions 软著, and no message in the other session
    // does — a hit there would mean the meta record was indexed.
    expect((await search("系统提示词")).results).toEqual([]);
  });

  it("keeps one Project's conversations out of another's answers", async () => {
    const other = (await (
      await owner.post("/api/projects", { projectId: "owner-other", name: "Other" })
    ).json()) as ProjectCreateResponse;
    await writeTraceFile(
      t.root,
      other.project.projectId,
      "default_agent",
      "2026-09-28",
      "session-2026-09-28-03-00-00-secret0003",
      0,
      [userText("另一套系统里也提到了软著")],
    );
    const mine = await search("软著");
    expect(mine.results.map((x) => x.sessionId)).toEqual([ERP_SESSION]);
  });

  it("refuses an empty query rather than answering with the whole index", async () => {
    const res = await owner.get(`/api/projects/${projectId}/sessions/search?q=`);
    expect(res.status).toBe(400);
  });

  it("refuses a query with nothing a token could match", async () => {
    const r = await search("···");
    expect(r.total).toBe(0);
    expect(r.results).toEqual([]);
  });

  it("refuses a malformed date filter instead of ignoring it", async () => {
    const res = await owner.get(`/api/projects/${projectId}/sessions/search?q=a&from=2026-13-99`);
    expect(res.status).toBe(400);
  });

  it("refuses a Project the caller has no access to, as a 404 rather than a 403", async () => {
    // The same shape every other Project-scoped route uses: a non-member is told the
    // resource does not exist, never that it does.
    const res = await outsider.get(
      `/api/projects/${projectId}/sessions/search?q=%E8%BD%AF%E8%91%97`,
    );
    expect(res.status).toBe(404);
  });

  it("reports how far the index has got", async () => {
    const r = await search("软著");
    expect(r.index.state).toBe("ready");
    expect(r.index.total).toBeGreaterThan(0);
    expect(r.index.indexed).toBe(r.index.total);
  });

  it("picks up a shard appended to after the first pass, without a restart", async () => {
    const fresh = "session-2026-09-28-04-00-00-later0004";
    await writeTraceFile(t.root, projectId, "default_agent", "2026-09-28", fresh, 0, [
      userText("第一句话"),
    ]);
    expect((await search("对称性破缺")).results).toEqual([]);
    await writeTraceFile(t.root, projectId, "default_agent", "2026-09-28", fresh, 0, [
      userText("第一句话"),
      userText("第二句才提到对称性破缺这个词"),
    ]);
    expect((await search("对称性破缺")).results.map((x) => x.sessionId)).toEqual([fresh]);
  });

  it("finds a session whose only match ranks below a chatty session's best messages", async () => {
    // The regression this guards: deciding the result set from a window of the best N
    // MESSAGES lets one chatty Session fill the window, and the other conversation that
    // said the same word disappears from the results.
    const chatty = "session-2026-09-28-06-00-00-chatty0006";
    const quiet = "session-2026-09-28-06-00-00-quiet0007";
    await writeTraceFile(t.root, projectId, "default_agent", "2026-09-28", chatty, 0, [
      userText("对称性破缺"),
      ...Array.from({ length: 200 }, (_, i) => userText(`对称性破缺第 ${i} 次讨论`)),
    ]);
    await writeTraceFile(t.root, projectId, "default_agent", "2026-09-28", quiet, 0, [
      userText("顺带一提，之前那个对称性破缺的问题后来怎么收尾的"),
    ]);
    const r = await search("对称性破缺");
    expect(r.results.map((x) => x.sessionId)).toContain(quiet);
    const quietResult = r.results.find((x) => x.sessionId === quiet)!;
    expect(quietResult.matchCount).toBe(1);
    // A match count with no excerpt beside it is the same failure one level down: the
    // chatty Session must not be able to spend the whole excerpt budget on itself.
    expect(quietResult.hits.length).toBe(1);
    expect(quietResult.hits[0]!.snippet).toContain("对称性破缺");
  }, 60_000);

  it("stops finding a conversation whose trace files were deleted", async () => {
    // Deleting a Session removes its trace FILES. A cache that only ever follows files
    // would keep serving it, and a search that still offers a deleted conversation is worse
    // than one that has not indexed it yet.
    const doomed = "session-2026-09-28-07-00-00-doomed0008";
    await writeTraceFile(t.root, projectId, "default_agent", "2026-09-28", doomed, 0, [
      userText("这段话里提到了独占鳌头"),
    ]);
    expect((await search("独占鳌头")).results.map((x) => x.sessionId)).toEqual([doomed]);
    const { rm } = await import("node:fs/promises");
    const path = await import("node:path");
    await rm(
      path.join(
        t.root,
        projectId,
        "agents",
        "default_agent",
        "traces",
        "2026-09-28",
        `${doomed}_000.jsonl`,
      ),
    );
    // The next pass reconciles (the date dir's mtime moved), sees the shard gone, and prunes.
    expect((await search("独占鳌头")).results).toEqual([]);
  }, 60_000);

  it("matches a session by its title even when no message says the word", async () => {
    // The title is the model's own words and never appears in a message body, so the
    // message index alone would lose it.
    const named = "session-2026-09-28-05-00-00-named0005";
    await writeTraceFile(t.root, projectId, "default_agent", "2026-09-28", named, 0, [
      userText("随便说点什么"),
    ]);
    t.deps.db
      .prepare(
        `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace,
                               approval_mode, title, has_trace, created_at, last_active_at)
         VALUES (?, ?, 'default_agent', 'p', 'm', '/tmp/w', 'allow-all', ?, 1, ?, ?)`,
      )
      .run(
        named,
        projectId,
        "软著登记进度跟踪",
        "2026-09-28T05:00:00.000Z",
        "2026-09-28T05:00:00.000Z",
      );
    const r = await search("软著");
    expect(r.results.map((x) => x.sessionId).sort()).toEqual([ERP_SESSION, named].sort());
    const byTitle = r.results.find((x) => x.sessionId === named)!;
    expect(byTitle.matchedTitle).toBe(true);
    expect(byTitle.hits).toEqual([]);
  });
});

describe("session turns", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-turns", name: "Project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  }, 60_000);
  afterEach(async () => {
    await t.cleanup();
  }, 60_000);

  it("refuses a Session that does not exist, without leaking that it does not", async () => {
    const res = await owner.get("/api/sessions/session-does-not-exist/turns");
    expect(res.status).toBe(404);
  });
});
