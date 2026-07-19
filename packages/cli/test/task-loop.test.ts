/**
 * runTask's result reporting: when a Task ends with a main-session abort event (LLM
 * failure / reconnect exhausted / user interrupt), it reports aborted=true, which
 * `penguin run` maps to a non-zero exit code; a sub-session abort does not count.
 */
import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { abortEvent, assistantText, withOrigin } from "@prismshadow/penguin-core";
import type { OmniMessage, Session } from "@prismshadow/penguin-core";
import { StreamRenderer } from "../src/render.js";
import { runTask } from "../src/task-loop.js";
import { getMessages } from "../src/i18n.js";

const t = getMessages("en");

function fakeSession(messages: OmniMessage[]): Session {
  return {
    async *run() {
      for (const m of messages) yield m;
    },
    toolPermission: () => "rw",
  } as unknown as Session;
}

function silentRenderer(): StreamRenderer {
  const stream = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  return new StreamRenderer(stream, t);
}

describe("runTask abort reporting", () => {
  it("reports aborted=true when the task ends with a main-session abort event", async () => {
    const result = await runTask(fakeSession([abortEvent("llm request error: 401")]), [], {
      renderer: silentRenderer(),
      t,
    });
    expect(result.aborted).toBe(true);
  });

  it("reports aborted=false on normal completion; child-session aborts do not count", async () => {
    const result = await runTask(
      fakeSession([withOrigin(abortEvent("child aborted"), "sess_child"), assistantText("done")]),
      [],
      { renderer: silentRenderer(), t },
    );
    expect(result.aborted).toBe(false);
  });
});
