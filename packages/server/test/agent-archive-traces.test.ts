/**
 * Traces in the Agent archive: which Sessions an export carries, and what an import of them
 * leaves on the receiving install. Two installs, so the Sessions an export carries are new where
 * they land.
 *
 * - Given four Sessions and a subagent child, `traces=last:2` carries the two most recently
 *   active top-level Sessions with every `_NNN` file and their titles, and the child of one of
 *   them, recorded with its parent.
 * - Given `traces=<from>..<to>`, the Sessions whose date directory lies in the range travel,
 *   each with all its files.
 * - Given a selection, the preview reports the Sessions, files and bytes the zip then holds, the
 *   oldest and newest of them, and a Session one of whose files is past the entry cap as skipped
 *   and absent from the zip.
 * - Given that zip imported on another install, the Sessions land under the new Agent with their
 *   titles, dates, archived mark and approval mode, in their date directories, and list.
 * - Given a Session id the receiving install already has, that Session is skipped as `exists`,
 *   one whose files are missing as `invalid`, and the rest land.
 * - Given a subagent child that ran under another Agent, the export does not carry it.
 * - Given a pinned thinking level and a kept mark, the imported Session has both.
 * - Given the Agent's vault values printed in a Trace, the export carries them replaced and counts
 *   them in the manifest; a value too short to replace safely stays.
 * - Given a `sessions.json` row with an unknown thinking level, a time that is no time, or an
 *   unknown client, that Session is skipped as `invalid` with the reason; given a first file whose
 *   first line runs past the head window, the Session is `invalid` too.
 * - Given a manifest whose parts select no Traces, Trace entries the zip holds are not imported.
 * - Given two Sessions whose ids differ only in letter case, the import is refused; on a disk that
 *   folds letter case, one whose case variant already lies there is skipped as `exists` and the
 *   file there is left as it was; on any disk, whatever already lies at a Session's place is
 *   left as it is and the Session is skipped as `exists`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentDir } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type {
  AgentArchiveImportResponse,
  AgentArchivePreview,
  ArchivedSessionFacts,
  ProjectCreateResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { MAX_ENTRY_BYTES } from "../src/agent-archive/limits.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const NOW = new Date(2026, 10, 4, 12, 0, 0);
const AGENT = "chatter";
const S1 = "session-2026-10-01-09-00-00-0000aaa1";
const S2 = "session-2026-10-05-09-00-00-0000aaa2";
const S3 = "session-2026-10-10-09-00-00-0000aaa3";
const CHILD = "session-2026-10-10-09-05-00-0000ccc1";
const BIG = "session-2026-10-12-09-00-00-0000bbb1";
const ELSEWHERE = "session-2026-10-10-09-06-00-0000ccc2";
const VAULT_VALUE = "vault-value-0123456789";
const QUOTED_SECRET = 'pa"ss\\word-123';
const BUILD_TOKEN = "aB3dE5fG7hJ9kL1mN3pQ";
const LONG_TITLED = "session-2026-09-20-09-00-00-0000aaa9";
const LONG_TITLE = `${"T".repeat(196)} #12`;

const rec = (type: AmspRecord["type"], payload: unknown): AmspRecord =>
  ({ timestamp: "2026-10-01T09:00:00.000Z", type, payload }) as AmspRecord;

function trace(sessionId: string, source: string, prompt: string, extra: AmspRecord[] = []) {
  return [
    rec("session_meta", {
      session_id: sessionId,
      model_id: "m",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      agent_state: "/tmp/a",
      workspace: "/tmp/w",
      source,
    }),
    rec("model_msg", { type: "text", role: "user", text: prompt }),
    ...extra,
  ];
}

/** The zip's entries by their path below its one top-level directory. */
function entriesOf(bytes: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    out[name.slice(name.indexOf("/") + 1)] = data;
  }
  return out;
}

const factsIn = (entries: Record<string, Uint8Array>): ArchivedSessionFacts[] =>
  JSON.parse(strFromU8(entries["traces/sessions.json"]!)) as ArchivedSessionFacts[];

interface Install {
  t: TestApp;
  owner: ReturnType<typeof apiClient>;
  projectId: string;
}

async function install(projectId: string): Promise<Install> {
  const t = await createTestApp({ now: () => NOW });
  const owner = apiClient(t.app, (await provisionUser(t.app, "owner_a")).cookie);
  const created = (await (
    await owner.post("/api/projects", { projectId, name: "Traces" })
  ).json()) as ProjectCreateResponse;
  expect(created.project.projectId).toBe(projectId);
  return { t, owner, projectId };
}

describe("Agent archive Traces", () => {
  let a: Install;
  let b: Install;
  const archiveUrl = (query: string) =>
    `/api/projects/${a.projectId}/agents/${AGENT}/archive${query}`;

  beforeAll(async () => {
    [a, b] = await Promise.all([install("owner_a-from"), install("owner_a-to")]);
    expect(
      (await a.owner.post(`/api/projects/${a.projectId}/agents`, { agentId: AGENT })).status,
    ).toBe(201);
    const write = (date: string, sid: string, index: number, records: AmspRecord[]) =>
      writeTraceFile(a.t.root, a.projectId, AGENT, date, sid, index, records);
    await write("2026-10-01", S1, 1, trace(S1, "user", "first"));
    await write("2026-10-01", S1, 2, trace(S1, "user", "first, continued"));
    await write("2026-10-05", S2, 1, trace(S2, "user", "second"));
    await write(
      "2026-10-10",
      S3,
      1,
      trace(S3, "user", "third", [
        rec("event_msg", { type: "subagent", session_id: CHILD }),
        rec("event_msg", { type: "subagent", session_id: ELSEWHERE }),
        rec("model_msg", {
          type: "text",
          role: "assistant",
          text: `printed ${VAULT_VALUE} and short`,
        }),
        rec("model_msg", { type: "text", role: "assistant", text: `again ${VAULT_VALUE}` }),
        rec("model_msg", {
          type: "text",
          role: "assistant",
          text: `on localhost.example, build ${BUILD_TOKEN}, code 31415926`,
        }),
        // Alone on its line: the line holds the value only in its JSON-escaped form.
        rec("model_msg", { type: "text", role: "assistant", text: `pass ${QUOTED_SECRET}` }),
        rec("event_msg", { type: "usage_note", total: 9123456789012 }),
      ]),
    );
    await write("2026-10-10", CHILD, 1, trace(CHILD, "subagent", "child work"));
    // A child the parent spawned under another Agent of the Project.
    expect(
      (await a.owner.post(`/api/projects/${a.projectId}/agents`, { agentId: "helper" })).status,
    ).toBe(201);
    await writeTraceFile(
      a.t.root,
      a.projectId,
      "helper",
      "2026-10-10",
      ELSEWHERE,
      1,
      trace(ELSEWHERE, "subagent", "helper work"),
    );
    expect(
      (
        await a.owner.put(`/api/projects/${a.projectId}/agents/${AGENT}/vault`, {
          entries: [
            { key: "API_TOKEN", value: VAULT_VALUE },
            { key: "PIN", value: "short" },
            { key: "SECRET_QUOTE", value: QUOTED_SECRET },
            { key: "BUILD_REF", value: BUILD_TOKEN },
            { key: "ACCOUNT_ID", value: "123456789012" },
            { key: "PIN_KEY", value: "31415926" },
            { key: "DB_HOST", value: "localhost.example" },
          ],
        })
      ).status,
    ).toBe(200);
    const big = await write("2026-10-12", BIG, 1, trace(BIG, "user", "big"));
    // Past the entry cap without writing it: a sparse file only declares its size.
    await fs.truncate(big, MAX_ENTRY_BYTES + 1);
    const row = (sessionId: string, title: string, createdAt: string, lastActiveAt: string) =>
      a.t.deps.sessionsRepo.insert({
        sessionId,
        projectId: a.projectId,
        agentId: AGENT,
        provider: "custom",
        modelId: "m",
        workspace: "/tmp/w",
        approvalMode: "read-only",
        title,
        client: "web",
        hasTrace: true,
        createdAt,
        lastActiveAt,
      });
    row(S1, "Oldest", "2026-10-01T09:00:00.000Z", "2026-10-01T10:00:00.000Z");
    row(S2, "Second", "2026-10-05T09:00:00.000Z", "2026-10-20T10:00:00.000Z");
    row(S3, "Third", "2026-10-10T09:00:00.000Z", "2026-10-15T10:00:00.000Z");
    row(CHILD, "Child", "2026-10-10T09:05:00.000Z", "2026-10-10T09:05:00.000Z");
    row(BIG, "Big", "2026-10-12T09:00:00.000Z", "2026-10-12T10:00:00.000Z");
    await write("2026-09-20", LONG_TITLED, 1, trace(LONG_TITLED, "user", "ticket work"));
    row(LONG_TITLED, LONG_TITLE, "2026-09-20T09:00:00.000Z", "2026-09-20T10:00:00.000Z");
    a.t.deps.sessionsRepo.setListing([S2], "archived", "2026-10-21T00:00:00.000Z");
    a.t.deps.sessionsRepo.setListing([S3], "kept", "2026-10-16T00:00:00.000Z");
    a.t.deps.sessionsRepo.updateThinkingLevel(S3, "high");
  });
  afterAll(async () => {
    await Promise.all([a.t.cleanup(), b.t.cleanup()]);
  });

  async function exported(query: string): Promise<Uint8Array> {
    const res = await a.owner.get(archiveUrl(query));
    expect(res.status, await res.clone().text()).toBe(200);
    return new Uint8Array(await res.arrayBuffer());
  }

  it("last:2 carries the two most recently active Sessions whole, with their titles and a subagent child", async () => {
    const entries = entriesOf(await exported("?traces=last:2"));

    expect(
      Object.keys(entries)
        .filter((n) => n.endsWith(".jsonl"))
        .sort(),
    ).toEqual(
      [
        `traces/2026-10-05/${S2}_001.jsonl`,
        `traces/2026-10-10/${S3}_001.jsonl`,
        `traces/2026-10-10/${CHILD}_001.jsonl`,
      ].sort(),
    );
    const facts = factsIn(entries);
    expect(facts.map((f) => [f.sessionId, f.title, f.files, f.parentSessionId])).toEqual([
      [S2, "Second", 1, undefined],
      [S3, "Third", 1, undefined],
      [CHILD, "Child", 1, S3],
    ]);
    expect(facts[0]).toMatchObject({
      archivedAt: "2026-10-21T00:00:00.000Z",
      approvalMode: "read-only",
      lastActiveAt: "2026-10-20T10:00:00.000Z",
    });
  });

  it("a date range carries the Sessions of its date directories, each with all its files", async () => {
    const entries = entriesOf(await exported("?traces=2026-10-01..2026-10-04"));

    expect(
      Object.keys(entries)
        .filter((n) => n.startsWith("traces/"))
        .sort(),
    ).toEqual([
      `traces/2026-10-01/${S1}_001.jsonl`,
      `traces/2026-10-01/${S1}_002.jsonl`,
      "traces/sessions.json",
    ]);
    expect(factsIn(entries).map((f) => [f.sessionId, f.files])).toEqual([[S1, 2]]);
  });

  it("the preview reports what the zip holds, its oldest and newest, and skips a Session past the entry cap", async () => {
    const query = "?traces=2026-10-05..2026-10-12";

    const res = await a.owner.get(
      `/api/projects/${a.projectId}/agents/${AGENT}/archive/preview${query}`,
    );
    const entries = entriesOf(await exported(query));

    expect(res.status).toBe(200);
    const { traces } = (await res.json()) as AgentArchivePreview;
    const files = Object.entries(entries).filter(([n]) => n.endsWith(".jsonl"));
    // The bytes on disk: what a Trace carries is its file, before the vault's values are replaced.
    const agentRoot = agentDir(a.t.root, a.projectId, AGENT);
    const onDisk = await Promise.all(
      files.map(async ([n]) => (await fs.stat(path.join(agentRoot, n))).size),
    );
    expect(traces).toEqual({
      sessions: 3,
      files: files.length,
      bytes: onDisk.reduce((sum, size) => sum + size, 0),
      skipped: [{ sessionId: BIG, reason: "too_large" }],
      oldest: { sessionId: S2, title: "Second", createdAt: "2026-10-05T09:00:00.000Z" },
      newest: { sessionId: S3, title: "Third", createdAt: "2026-10-10T09:00:00.000Z" },
    });
    expect(files.map(([n]) => n)).not.toContain(`traces/2026-10-12/${BIG}_001.jsonl`);
  });

  it("imported on another install, the Sessions land under the new Agent with their facts, and list", async () => {
    const zip = await exported("?traces=last:2");

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=landed`,
      zip,
    );

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.imported.traces).toEqual({ sessions: 3, files: 3 });
    expect(body.skippedTraces).toEqual([]);
    const row = b.t.deps.sessionsRepo.findById(S2);
    expect(row).toMatchObject({
      agentId: "landed",
      title: "Second",
      approvalMode: "read-only",
      createdAt: "2026-10-05T09:00:00.000Z",
      lastActiveAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "2026-10-21T00:00:00.000Z",
    });
    expect(b.t.deps.sessionsRepo.findById(CHILD)?.agentId).toBe("landed");
    expect(b.t.deps.sessionsRepo.findById(S3)).toMatchObject({
      thinkingLevel: "high",
      keptAt: "2026-10-16T00:00:00.000Z",
    });
    await expect(
      fs.access(
        path.join(
          agentDir(b.t.root, b.projectId, "landed"),
          "traces",
          "2026-10-10",
          `${S3}_001.jsonl`,
        ),
      ),
    ).resolves.toBeUndefined();
    const listed = (await (
      await b.owner.get(`/api/projects/${b.projectId}/agents/landed/sessions`)
    ).json()) as SessionsResponse;
    expect(listed.sessions.find((s) => s.sessionId === S3)).toMatchObject({
      title: "Third",
      createdAt: "2026-10-10T09:00:00.000Z",
    });
  });

  it("a Session the install already has is skipped as exists, one without its files as invalid, and the rest land", async () => {
    const entries = unzipSync(await exported("?traces=2026-10-01..2026-10-04"));
    const top = Object.keys(entries)[0]!.split("/")[0]!;
    const facts = JSON.parse(
      strFromU8(entries[`${top}/traces/sessions.json`]!),
    ) as ArchivedSessionFacts[];
    const ghost = "session-2026-10-02-09-00-00-0000dead";
    const fresh = "session-2026-10-03-09-00-00-0000fee1";
    entries[`${top}/traces/2026-10-03/${fresh}_001.jsonl`] = strToU8(
      trace(fresh, "user", "fresh")
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    entries[`${top}/traces/sessions.json`] = strToU8(
      JSON.stringify([
        ...facts,
        { ...facts[0]!, sessionId: ghost, files: 1 },
        { ...facts[0]!, sessionId: fresh, files: 1, title: "Fresh" },
      ]),
    );
    // The receiving install already holds S1, imported on its own.
    const single = trace(S1, "user", "first")
      .map((r) => JSON.stringify(r))
      .join("\n");
    expect(
      (
        await b.owner.post(`/api/projects/${b.projectId}/agents/default_agent/traces/import`, {
          dataBase64: Buffer.from(single).toString("base64"),
        })
      ).status,
    ).toBe(200);

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=partial`,
      zipSync(entries),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.skippedTraces).toEqual([
      { sessionId: S1, reason: "exists" },
      { sessionId: ghost, reason: "invalid", detail: expect.any(String) },
    ]);
    expect(body.imported.traces).toEqual({ sessions: 1, files: 1 });
    expect(b.t.deps.sessionsRepo.findById(S1)?.agentId).toBe("default_agent");
    expect(b.t.deps.sessionsRepo.findById(fresh)).toMatchObject({
      agentId: "partial",
      title: "Fresh",
    });
  });

  it("a subagent child that ran under another Agent is not carried", async () => {
    const names = Object.keys(entriesOf(await exported("?traces=last:2")));

    expect(names.some((n) => n.includes(CHILD))).toBe(true);
    expect(names.some((n) => n.includes(ELSEWHERE))).toBe(false);
  });

  it("the Agent's secret vault values in a Trace travel replaced and counted, inside strings only, and ordinary values stay", async () => {
    const entries = entriesOf(await exported("?traces=last:2"));

    const lines = strFromU8(entries[`traces/2026-10-10/${S3}_001.jsonl`]!).trimEnd().split("\n");
    // Every line is still the record it was.
    const records = lines.map((line) => JSON.parse(line) as { payload: Record<string, unknown> });
    const texts = records.map((r) => r.payload.text).filter((t) => typeof t === "string");
    const all = texts.join("\n");
    expect(all).not.toContain(VAULT_VALUE);
    expect(all.match(/\[vault:API_TOKEN\]/g)).toHaveLength(2);
    // A credential-named value with a quote and a backslash, and a token-shaped one, go too.
    expect(all).not.toContain(QUOTED_SECRET);
    expect(all).toContain("[vault:SECRET_QUOTE]");
    expect(all).toContain("[vault:BUILD_REF]");
    // A short value, an ordinary setting and digits stay as they were.
    expect(all).toContain("and short");
    expect(all).toContain("localhost.example");
    expect(all).toContain("code 31415926");
    expect(records.find((r) => r.payload.type === "usage_note")?.payload.total).toBe(9123456789012);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as { redacted: string[] };
    expect(manifest.redacted).toContain("traces:vault-values:4");
  });

  it("a Session whose title is as long as a ticket's makes the round trip", async () => {
    const zip = await exported("?traces=2026-09-20..2026-09-20");

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=long_titles`,
      zip,
    );

    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await res.json()) as AgentArchiveImportResponse).skippedTraces).toEqual([]);
    expect(b.t.deps.sessionsRepo.findById(LONG_TITLED)?.title).toBe(LONG_TITLE);
  });

  /** A zip of one Agent carrying only these Sessions, each `[facts, first file text]`. */
  function sessionsZip(
    sessions: Array<[Record<string, unknown>, string]>,
    parts: object = { traces: { kind: "last", count: 10 } },
  ): Uint8Array {
    const files: Record<string, Uint8Array> = {
      "s/manifest.json": strToU8(
        JSON.stringify({
          format: "penguin-agent-zip/1",
          agentId: "s",
          parts,
          vaultKeys: [],
          redacted: [],
        }),
      ),
      "s/agent_state/system_config.yaml": strToU8('system_prompt: "s"\nversion: 1\n'),
      "s/traces/sessions.json": strToU8(JSON.stringify(sessions.map(([facts]) => facts))),
    };
    for (const [facts, text] of sessions) {
      files[`s/traces/2026-10-20/${String(facts.sessionId)}_001.jsonl`] = strToU8(text);
    }
    return zipSync(files);
  }
  const lines = (records: AmspRecord[]) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const facts = (sessionId: string, over: Record<string, unknown> = {}) => ({
    sessionId,
    files: 1,
    createdAt: "2026-10-20T09:00:00.000Z",
    lastActiveAt: "2026-10-20T09:00:00.000Z",
    title: "t",
    archivedAt: null,
    keptAt: null,
    approvalMode: "allow-all",
    thinkingLevel: null,
    client: "web",
    workspace: "/tmp/w",
    provider: "custom",
    modelId: "m",
    ...over,
  });

  it("a row with an unknown thinking level, a time that is no time or an unknown client, or a first line past the head window, is skipped as invalid with the reason", async () => {
    const ids = [
      "session-2026-10-20-09-00-00-0000f001",
      "session-2026-10-20-09-00-00-0000f002",
      "session-2026-10-20-09-00-00-0000f003",
      "session-2026-10-20-09-00-00-0000f004",
      "session-2026-10-20-09-00-00-0000f005",
      "session-2026-10-20-09-00-00-0000f006",
    ];
    const zip = sessionsZip([
      [facts(ids[0]!, { thinkingLevel: "ultra-mega" }), lines(trace(ids[0]!, "user", "a"))],
      [facts(ids[1]!, { createdAt: "not a date" }), lines(trace(ids[1]!, "user", "b"))],
      [facts(ids[2]!, { client: "somewhere" }), lines(trace(ids[2]!, "user", "c"))],
      // A session_meta whose one line is longer than the head window: never read whole.
      [
        facts(ids[3]!),
        lines([
          rec("session_meta", {
            session_id: ids[3],
            model_id: "m",
            provider: "custom",
            model_context_window: 1000,
            system_prompt: "x".repeat(300 * 1024),
            agent_state: "/tmp/a",
            workspace: "/tmp/w",
            source: "user",
          }),
        ]),
      ],
      [facts(ids[4]!), lines(trace(ids[4]!, "user", "e"))],
      [facts(ids[5]!, { title: "t".repeat(1001) }), lines(trace(ids[5]!, "user", "f"))],
    ]);

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=checked`,
      zip,
    );

    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as AgentArchiveImportResponse;
    expect(body.skippedTraces).toEqual([
      { sessionId: ids[0], reason: "invalid", detail: expect.stringContaining("thinkingLevel") },
      { sessionId: ids[1], reason: "invalid", detail: expect.stringContaining("createdAt") },
      { sessionId: ids[2], reason: "invalid", detail: expect.stringContaining("client") },
      { sessionId: ids[3], reason: "invalid", detail: expect.stringContaining("session_meta") },
      { sessionId: ids[5], reason: "invalid", detail: expect.stringContaining("title") },
    ]);
    expect(body.imported.traces).toEqual({ sessions: 1, files: 1 });
    expect(b.t.deps.sessionsRepo.findById(ids[0]!)).toBeNull();
  });

  it("a manifest whose parts select no Traces imports none of the Trace entries the zip holds", async () => {
    const sid = "session-2026-10-20-09-00-00-0000f101";
    const zip = sessionsZip([[facts(sid), lines(trace(sid, "user", "a"))]], {
      skills: true,
      hooks: true,
      memory: true,
      workbenches: true,
      workbenchData: true,
      schedules: false,
      traces: { kind: "none" },
    });

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=no_traces`,
      zip,
    );

    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await res.json()) as AgentArchiveImportResponse).imported.traces).toEqual({
      sessions: 0,
      files: 0,
    });
    expect(b.t.deps.sessionsRepo.findById(sid)).toBeNull();
  });

  it("two Sessions whose ids differ only in letter case are refused", async () => {
    const lower = "session-2026-10-20-09-00-00-0000abcd";
    const upper = "session-2026-10-20-09-00-00-0000ABCD";
    const zip = sessionsZip([
      [facts(lower), lines(trace(lower, "user", "a"))],
      [facts(upper), lines(trace(upper, "user", "b"))],
    ]);

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=cased`,
      zip,
    );

    expect(res.status).toBe(400);
    expect(b.t.deps.sessionsRepo.findById(lower)).toBeNull();
  });

  it("something already at a Session's place in the Trace directory is left as it is, and the Session is skipped as exists", async () => {
    const sid = "session-2026-10-20-09-00-00-0000f201";
    expect(
      (await b.owner.post(`/api/projects/${b.projectId}/agents`, { agentId: "occupied" })).status,
    ).toBe(201);
    // Not a Trace file the index takes up: a directory under the Session's file name.
    const place = path.join(
      agentDir(b.t.root, b.projectId, "occupied"),
      "traces",
      "2026-10-20",
      `${sid}_001.jsonl`,
    );
    await fs.mkdir(path.join(place, "inside"), { recursive: true });

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=occupied&overwrite=1`,
      sessionsZip([[facts(sid), lines(trace(sid, "user", "imported"))]]),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await res.json()) as AgentArchiveImportResponse).skippedTraces).toEqual([
      { sessionId: sid, reason: "exists" },
    ]);
    await expect(fs.readdir(place)).resolves.toEqual(["inside"]);
    expect(b.t.deps.sessionsRepo.findById(sid)).toBeNull();
  });

  /** Whether the disk under `dir` takes two names that differ in letter case for one. */
  async function foldsCase(dir: string): Promise<boolean> {
    const probe = path.join(dir, "Case-Probe");
    await fs.writeFile(probe, "");
    const folds = await fs.access(path.join(dir, "case-probe")).then(
      () => true,
      () => false,
    );
    await fs.rm(probe);
    return folds;
  }

  it("on a disk that folds letter case, a Session whose case variant lies there already is skipped as exists, and that file is left as it was", async (ctx) => {
    if (!(await foldsCase(b.t.root))) ctx.skip();
    const existing = "session-2026-10-20-09-00-00-0000cafe";
    const variant = "session-2026-10-20-09-00-00-0000CAFE";
    expect(
      (await b.owner.post(`/api/projects/${b.projectId}/agents`, { agentId: "folded" })).status,
    ).toBe(201);
    const file = await writeTraceFile(
      b.t.root,
      b.projectId,
      "folded",
      "2026-10-20",
      existing,
      1,
      trace(existing, "user", "the one already here"),
    );
    const before = await fs.readFile(file, "utf8");

    const res = await b.owner.upload(
      `/api/projects/${b.projectId}/agents/import?agentId=folded&overwrite=1`,
      sessionsZip([[facts(variant), lines(trace(variant, "user", "imported"))]]),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    expect(((await res.json()) as AgentArchiveImportResponse).skippedTraces).toEqual([
      { sessionId: variant, reason: "exists" },
    ]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
});
