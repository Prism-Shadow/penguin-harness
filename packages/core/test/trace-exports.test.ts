/**
 * The trace module's export surface, pinned where it was thin: the damaged-input side.
 *
 * `Writer.aggregateAndWrite` is the module's only entry point no test reached — `write`,
 * `writeAll`, `rotate`, `currentPath`, `readTrace`, `parseTraceLines`, `resumeTrace` and the
 * locators are measured by `trace.test.ts`, `replay.test.ts` and `resume.test.ts`, but a caller
 * reconstructing a complete context from raw streaming fragments had nothing pinning it. The
 * rest pins what `writer.ts`/`resume.ts` promise for a trace the process died on: a file whose
 * last line was cut mid-write still yields every complete record, the session still resumes from
 * them, and the file/session locators still pick it with a torn sibling beside it.
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assistantText,
  partialText,
  partialThinking,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  userText,
} from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import {
  Writer,
  findLatestTraceFile,
  latestSessionId,
  readTrace,
  readTraceTolerant,
  resumeTrace,
} from "../src/trace/index.js";

const SESSION_ID = "session-2026-01-09-10-00-00-abcdef01";
const DATE_DIR = "2026-01-09";

function metaFor(sessionId: string = SESSION_ID): OmniMessage {
  return sessionMeta({
    session_id: sessionId,
    provider: "custom",
    model_id: "test-model",
    model_context_window: 200000,
    system_prompt: "test system prompt",
    agent_state: "/tmp/agent_state",
    workspace: "/tmp/workspace",
  });
}

/** Envelope timestamp aside (the aggregator stamps its own), the shape a record must have. */
const shape = (msg: OmniMessage) => ({ type: msg.type, payload: msg.payload });
const shapes = (msgs: OmniMessage[]) => msgs.map(shape);

/** JSONL content for a list of messages (exactly what `Writer` appends). */
const toLines = (msgs: OmniMessage[]): string => msgs.map((m) => `${JSON.stringify(m)}\n`).join("");

/** Writes a shard file directly, as a previous process would have left it. */
async function seedShard(dir: string, sessionId: string, index: string, content: string) {
  const dateDir = join(dir, DATE_DIR);
  await mkdir(dateDir, { recursive: true });
  const file = join(dateDir, `${sessionId}_${index}.jsonl`);
  await writeFile(file, content, "utf8");
  return file;
}

describe("trace exports", () => {
  let tracesDir: string;

  beforeEach(async () => {
    tracesDir = await mkdtemp(join(tmpdir(), "penguin-trace-exports-"));
  });

  afterEach(async () => {
    await rm(tracesDir, { recursive: true, force: true });
  });

  describe("Writer.aggregateAndWrite", () => {
    const newWriter = () =>
      new Writer({ tracesDir, sessionId: SESSION_ID, date: new Date(2026, 0, 9) });

    it("persists the aggregated message, not the fragments it came from", async () => {
      const writer = newWriter();
      await writer.aggregateAndWrite([
        metaFor(),
        partialText("start", "Hel"),
        partialText("delta", "lo, "),
        partialText("stop", "world"),
      ]);

      // One complete record carrying the joined text: aggregating is what makes a raw stream
      // recoverable, and a plain `write` of the same input persists only the meta.
      const rows = await readTrace(writer.currentPath());
      expect(shapes(rows)).toEqual(shapes([metaFor(), assistantText("Hello, world")]));
      expect(await readFile(writer.currentPath(), "utf8")).not.toContain("partial_");
    });

    it("flushes a fragment that never received stop", async () => {
      const writer = newWriter();
      await writer.aggregateAndWrite([
        metaFor(),
        partialThinking("start", "th"),
        partialThinking("delta", "ough"),
        partialText("start", "answer"),
        partialText("stop", "!"),
      ]);

      // No `stop` ever arrived for the thinking fragment (the process exited mid-stream): the
      // text fragment lands the moment it stops, and `flush` finalizes the unfinished one
      // instead of dropping it — which puts it at the end of the file.
      const rows = await readTrace(writer.currentPath());
      expect(shapes(rows)).toEqual(
        shapes([metaFor(), assistantText("answer!"), thinkingMessage("though")]),
      );
    });

    it("keeps non-partial messages in order around the fragments", async () => {
      const writer = newWriter();
      const meta = metaFor();
      const input = userText("raw input");
      const begin = requestBegin();
      const end = requestEnd("completed");
      await writer.aggregateAndWrite([
        meta,
        input,
        partialText("start", "the "),
        partialText("stop", "reply"),
        begin,
        end,
      ]);

      expect(await readTrace(writer.currentPath())).toEqual([
        meta,
        input,
        // The aggregated record is built by the aggregator, so compare its shape.
        expect.objectContaining(shape(assistantText("the reply"))),
        begin,
        end,
      ]);
    });
  });

  describe("a trace torn mid-write", () => {
    /** A shard written by a real Writer, then cut mid-append, as an OS-level short write leaves it. */
    async function writeThenTear(committed: OmniMessage[]): Promise<string> {
      const writer = new Writer({ tracesDir, sessionId: SESSION_ID, date: new Date(2026, 0, 9) });
      await writer.writeAll(committed);
      const path = writer.currentPath();
      const torn = JSON.stringify(assistantText("the record the crash cut in half"));
      await appendFile(path, torn.slice(0, Math.floor(torn.length / 2)), "utf8");
      return path;
    }

    it("reads every complete record past the torn line and resumes from them", async () => {
      const meta = metaFor();
      const question = userText("first question");
      const answer = assistantText("first answer");
      const unanswered = userText("second question, never answered");
      const committed = [
        meta,
        question,
        requestBegin(),
        answer,
        requestEnd("completed"),
        unanswered,
      ];
      const path = await writeThenTear(committed);

      const raw = await readFile(path, "utf8");
      expect(raw.endsWith("\n")).toBe(false);
      // The strict reader is exactly why the tolerant one exists.
      await expect(readTrace(path)).rejects.toThrow();

      const messages = await readTraceTolerant(path);
      expect(messages).toEqual(committed);

      // The resume that follows: the committed turn is history, the unanswered input is
      // carry-over, the context is open and its config came back from the surviving meta.
      const replay = resumeTrace(messages);
      expect(replay.meta).toEqual(meta);
      expect(replay.history).toEqual([question, answer]);
      expect(replay.carryOver).toEqual([unanswered]);
      expect(replay.contextClosed).toBe(false);
    });
  });

  describe("the locators beside a torn sibling", () => {
    const TARGET = "session-2026-01-09-10-00-00-bbbbbbbb";
    const OLDER = "session-2026-01-09-09-00-00-aaaaaaaa";
    const TORN_ONLY = "session-2026-01-09-11-00-00-cccccccc";

    it("findLatestTraceFile takes the highest index of its own session, torn or not", async () => {
      await seedShard(tracesDir, OLDER, "001", toLines([metaFor(OLDER), userText("old context")]));
      await seedShard(
        tracesDir,
        TARGET,
        "001",
        toLines([metaFor(TARGET), userText("first context")]),
      );
      // The session's newest shard is torn mid-write. The decoy below has a higher index and a
      // different session id, and must not be mistaken for this session's file.
      const meta = metaFor(TARGET);
      const question = userText("second question");
      const answer = assistantText("second answer");
      const tornPath = await seedShard(
        tracesDir,
        TARGET,
        "002",
        toLines([meta, question, requestBegin(), answer, requestEnd("completed")]) +
          JSON.stringify(userText("cut")).slice(0, 12),
      );
      await seedShard(tracesDir, TORN_ONLY, "003", toLines([metaFor(TORN_ONLY), userText("x")]));

      const located = await findLatestTraceFile(tracesDir, TARGET);
      expect(located).toMatchObject({ index: 2, dateDir: DATE_DIR });
      expect(located?.path).toBe(tornPath);

      // The chain the locator opens: tolerant read, then replay of the newest context only.
      const replay = resumeTrace(await readTraceTolerant(tornPath));
      expect(replay.meta).toEqual(meta);
      expect(replay.history).toEqual([question, answer]);
      expect(replay.carryOver).toEqual([]);

      // A session with no file at all has nothing to locate.
      expect(
        await findLatestTraceFile(tracesDir, "session-2026-01-09-12-00-00-dddddddd"),
      ).toBeNull();
    });

    it("latestSessionId answers with the session whose records survive, not the torn sibling", async () => {
      const resumable = "session-2026-01-09-10-00-00-bbbbbbbb";
      // The resumable session's own tail is torn — its complete records still count.
      await seedShard(
        tracesDir,
        resumable,
        "001",
        toLines([metaFor(resumable), userText("survives")]) +
          JSON.stringify(assistantText("cut")).slice(0, 12),
      );
      // Newer by name, but its whole content is one half-written record: no session here.
      await seedShard(
        tracesDir,
        TORN_ONLY,
        "001",
        JSON.stringify(userText("torn away")).slice(0, 20),
      );

      expect(await latestSessionId(tracesDir)).toBe(resumable);
    });

    it("both locators answer empty when there is no trace directory", async () => {
      const missing = join(tracesDir, "no-such-agent");
      expect(await findLatestTraceFile(missing, SESSION_ID)).toBeNull();
      expect(await latestSessionId(missing)).toBeNull();
    });
  });
});
