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
      trace(S3, "user", "third", [rec("event_msg", { type: "subagent", session_id: CHILD })]),
    );
    await write("2026-10-10", CHILD, 1, trace(CHILD, "subagent", "child work"));
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
    a.t.deps.sessionsRepo.setListing([S2], "archived", "2026-10-21T00:00:00.000Z");
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
    expect(traces).toEqual({
      sessions: 3,
      files: files.length,
      bytes: files.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0),
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
      { sessionId: ghost, reason: "invalid" },
    ]);
    expect(body.imported.traces).toEqual({ sessions: 1, files: 1 });
    expect(b.t.deps.sessionsRepo.findById(S1)?.agentId).toBe("default_agent");
    expect(b.t.deps.sessionsRepo.findById(fresh)).toMatchObject({
      agentId: "partial",
      title: "Fresh",
    });
  });
});
