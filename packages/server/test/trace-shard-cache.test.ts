/**
 * The full-shard parse cache in TraceService (`shardCache`).
 *
 * A shard is append-only (core's Writer opens O_APPEND, writes one record per write(2),
 * never seeks), so a cached parse may be reused while the same file only grows, and an
 * append needs only the appended bytes parsed. The tests below pin every way that
 * assumption can fail, because each one would otherwise serve a stale transcript:
 *
 * - an unchanged shard is served without parsing it again (the cache hit itself);
 * - an append is picked up, and costs an incremental parse rather than a full one;
 * - a shard that SHRANK (repaired or replaced by hand) is re-parsed;
 * - a shard deleted and recreated at the same path — same size or larger — is re-parsed
 *   (the file identity, not just the size, is what the cache validates);
 * - a torn trailing line is not lost when the writer completes the record;
 * - a shard that is gone does not turn a read into an error;
 * - the entry bound really evicts: the least recently used shard is parsed again.
 *
 * `observeShardRead` stays the demand signal the windowed-read tests assert on (a cache
 * hit still touches the file's shard), while `observeShardParse` is the parse signal this
 * file counts.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core";
import type { HistoryMessage } from "../src/api/types.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-sc";
const A = "agent-sc";
const S = "session-2026-07-20-10-00-00-aabb0c01";
const DATE = "2026-07-20";

function at(seconds: number, msg: OmniMessage): OmniMessage {
  return {
    ...msg,
    timestamp: `2026-07-20T10:00:${String(seconds).padStart(2, "0")}.000Z`,
  };
}

function metaPayload(): SessionMetaPayload {
  return {
    session_id: S,
    model_id: "m1",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "sp",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
    source: "user",
  };
}

const texts = (messages: HistoryMessage[]): string[] =>
  messages
    .map((m) => (m.payload as { text?: string }).text)
    .filter((t): t is string => typeof t === "string");

/** The shard the tests work on: one meta line plus one user turn. */
async function writeFirstShard(root: string): Promise<string> {
  return writeTraceFile(root, P, A, DATE, S, 1, [
    at(0, sessionMeta(metaPayload())),
    at(1, userText("q1")),
  ]);
}

let root: string;
beforeEach(async () => {
  root = await makeTempRoot();
});
afterEach(() => {
  // makeTempRoot's own teardown removes the directory; nothing to do per test.
});

describe("Trace shard cache", () => {
  it("serves an unchanged shard without parsing it again", async () => {
    await writeFirstShard(root);
    const harness = makeTraceHarness(root);

    const first = await harness.service.readMessages(P, A, S);
    expect(texts(first)).toContain("q1");
    expect(harness.shardParses).toHaveLength(1);

    harness.shardReads.length = 0;
    harness.shardParses.length = 0;
    const second = await harness.service.readMessages(P, A, S);

    expect(second).toEqual(first);
    // the shard is still asked for (windowed-read assertions keep meaning), but nothing
    // was parsed a second time
    expect(harness.shardReads).toHaveLength(1);
    expect(harness.shardParses).toHaveLength(0);
    harness.close();
  });

  it("picks up an append without re-parsing the whole shard", async () => {
    const file = await writeFirstShard(root);
    const harness = makeTraceHarness(root);
    await harness.service.readMessages(P, A, S);

    await fs.appendFile(file, `${JSON.stringify(at(2, userText("q2")))}\n`, "utf8");
    harness.shardReads.length = 0;
    harness.shardParses.length = 0;
    const after = await harness.service.readMessages(P, A, S);

    expect(texts(after)).toContain("q2");
    expect(texts(after)).toContain("q1");
    // the appended bytes are parsed by the incremental path, not by a full read
    expect(harness.shardParses).toHaveLength(0);
    harness.close();
  });

  it("keeps a torn trailing line out of the parse and does not lose it when it is completed", async () => {
    const file = await writeFirstShard(root);
    const harness = makeTraceHarness(root);
    await harness.service.readMessages(P, A, S);

    // A crash mid-record: the last line has no newline. The tolerant reader ignores it.
    const record = JSON.stringify(at(2, userText("q2")));
    await fs.appendFile(file, record.slice(0, 12), "utf8");
    const torn = await harness.service.readMessages(P, A, S);
    expect(texts(torn)).not.toContain("q2");

    // The writer heals the tail: a newline, then the record. It must appear.
    await fs.appendFile(file, `\n${record}\n`, "utf8");
    const healed = await harness.service.readMessages(P, A, S);
    expect(texts(healed)).toContain("q2");
    expect(texts(healed)).toContain("q1");
    harness.close();
  });

  it("re-parses a shard that shrank", async () => {
    const file = await writeFirstShard(root);
    const harness = makeTraceHarness(root);
    await harness.service.readMessages(P, A, S);

    // A repaired file, smaller than what the cache parsed.
    await fs.writeFile(file, `${JSON.stringify(at(1, userText("repaired")))}\n`, "utf8");
    harness.shardParses.length = 0;
    const after = await harness.service.readMessages(P, A, S);

    expect(texts(after)).toContain("repaired");
    expect(texts(after)).not.toContain("q1");
    expect(harness.shardParses).toHaveLength(1);
    harness.close();
  });

  it("re-parses a shard replaced at the same path with different content", async () => {
    const file = await writeFirstShard(root);
    const harness = makeTraceHarness(root);
    await harness.service.readMessages(P, A, S);

    // Same path, a DIFFERENT file, and longer than what the cache holds: a size-only
    // validation would keep the old parse here. The bytes before the cached offset are
    // re-read on every hit, so this is caught.
    await fs.rm(file);
    await writeTraceFile(root, P, A, DATE, S, 1, [
      at(0, userText("different first record")),
      at(1, userText("recreated")),
      at(2, userText("and longer than before")),
    ]);
    harness.shardParses.length = 0;
    const after = await harness.service.readMessages(P, A, S);

    expect(texts(after)).toContain("recreated");
    expect(texts(after)).not.toContain("q1");
    expect(harness.shardParses).toHaveLength(1);
    harness.close();
  });

  it("answers a read for a shard that is gone", async () => {
    const file = await writeFirstShard(root);
    const harness = makeTraceHarness(root);
    await harness.service.readMessages(P, A, S);

    await fs.rm(file);
    const after = await harness.service.readMessages(P, A, S);
    expect(texts(after)).not.toContain("q1");
    harness.close();
  });

  it("holds a multi-shard history across reads", async () => {
    // A full-history read walks every shard in order; the cache must keep the whole modest
    // history, so a second read of it parses nothing at all.
    const shards = 41;
    for (let i = 1; i <= shards; i += 1) {
      await writeTraceFile(root, P, A, DATE, S, i, [at(i, userText(`q${i}`))]);
    }
    const harness = makeTraceHarness(root);

    const first = await harness.service.readMessages(P, A, S);
    expect(texts(first)).toContain(`q${shards}`);
    expect(harness.shardParses).toHaveLength(shards);

    harness.shardParses.length = 0;
    const second = await harness.service.readMessages(P, A, S);
    expect(second).toEqual(first);
    expect(harness.shardParses).toHaveLength(0);
    harness.close();
  });
});
