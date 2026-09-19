/**
 * chat `/switch-model`: switches the Session's model in place over the server API. Drives
 * the real REPL over a fake stdin against the in-process fake server (same harness as
 * chat-clear.test.ts and chat-thinking.test.ts). The fake answers the contract's three
 * shapes — 202 streaming an ordinary manual compaction pair and then the new context's
 * `session_meta`, 200 carrying the Session back for one that never ran, and 409 with a code
 * per refusal. The REPL renders the compaction like any other and learns the new model from
 * the Session it re-reads.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { compactionBegin, compactionEnd, sessionMeta } from "@prismshadow/penguin-core";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";
import type { FakeSessionState } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Runs `penguin chat <argv>` end to end over a PassThrough stdin, feeding each line at the prompt (same driver as chat-clear.test.ts); returns stdout without colors. */
async function driveChat(lines: string[], argv: string[] = []): Promise<string> {
  const stdin = new PassThrough();
  const realStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  const chunks: string[] = [];
  let promptCount = 0;
  const waiters: Array<() => void> = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const text = String(chunk);
    chunks.push(text);
    if (text === "> ") promptCount++;
    for (const wake of waiters.splice(0)) wake();
    return true;
  });
  const waitForPrompt = (n: number): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (promptCount >= n) resolve();
        else waiters.push(check);
      };
      check();
    });
  try {
    const program = new Command();
    program.exitOverride();
    registerChatCommand(program, t);
    const done = program.parseAsync(["node", "penguin", "chat", ...argv]);
    for (let i = 0; i < lines.length; i++) {
      await Promise.race([waitForPrompt(i + 1), done]);
      stdin.write(`${lines[i]}\n`);
    }
    await done;
    return stripAnsi(chunks.join(""));
  } finally {
    outSpy.mockRestore();
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  }
}

const CURRENT = "model-default (prov-default)";
const TARGET = "anthropic/claude-opus-5 (openrouter)";
const SWITCH_LINE = "/switch-model openrouter anthropic/claude-opus-5";

/** The requests one session received, as `METHOD /path` strings, in order. */
function requestLog(sessionId: string): string[] {
  return server.requests
    .filter((r) => r.path.startsWith(`/api/sessions/${sessionId}`))
    .map((r) => `${r.method} ${r.path.slice(`/api/sessions/${sessionId}`.length) || "/"}`);
}

/**
 * A 202 switch whose compaction ends with `status`: a plain manual pair, then — on completed
 * only — the new context's main-session `session_meta` naming the target, as core streams it.
 * The fake moves the Session's model only on completed.
 */
function streamedSwitch(status: "completed" | "fatal" | "aborted", errorMessage?: string) {
  return (session: FakeSessionState, target: { provider: string; modelId: string }) => {
    const completed = status === "completed";
    return {
      completed,
      messages: [
        compactionBegin({ reason: "manual", mode: "summarize", context: 5000, turns: 2 }),
        compactionEnd({
          reason: "manual",
          mode: "summarize",
          status,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
        }),
        ...(completed
          ? [
              sessionMeta({
                session_id: session.sessionId,
                provider: target.provider,
                model_id: target.modelId,
                model_context_window: "unknown",
                system_prompt: "",
                agent_state: "/tmp/agents/default_agent/agent_state",
                workspace: session.workspace,
              }),
            ]
          : []),
      ],
    };
  };
}

describe("chat /switch-model: parsing and display (no request)", () => {
  it("bare /switch-model shows the current model and usage; bad arity prints the usage error", async () => {
    const out = await driveChat(["/switch-model", "/switch-model openrouter", "/exit"]);
    expect(out).toContain(t.switchModelCurrent(CURRENT));
    expect(out).toContain(t.error(t.switchModelUsage()));
    expect(server.requests.some((r) => r.path.endsWith("/switch-model"))).toBe(false);
  });

  it("the hints line teaches /switch-model", async () => {
    const out = await driveChat(["/exit"]);
    expect(out).toContain("/switch-model <provider> <model_id>");
  });
});

describe("chat /switch-model: 202 streams the switch", () => {
  it("completed: renders the switch, refreshes the Session and runs later turns on the new model", async () => {
    server.switchModel = streamedSwitch("completed");
    const out = await driveChat(["hello", SWITCH_LINE, "/switch-model", "/clear", "/exit"]);

    const [first, replacement] = [...server.sessions.values()];
    // The POST carried the pair as the API spells it.
    const post = server.requests.find((r) => r.path.endsWith("/switch-model"));
    expect(post?.method).toBe("POST");
    expect(post?.body).toEqual({ provider: "openrouter", modelId: "anthropic/claude-opus-5" });
    // The compaction renders as any manual compaction does, then the model line — from the
    // Session re-read after the stream, not from anything the stream says.
    const start = out.indexOf(t.compactionStart("summarize", "manual"));
    const stop = out.indexOf(t.compactionStop("summarize", "completed"));
    const done = out.indexOf(t.switchModelDone(CURRENT, TARGET));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(start);
    expect(done).toBeGreaterThan(stop);
    // The Session was re-read after the switch, and the local copy follows it: bare
    // /switch-model shows the new model and /clear carries it to the replacement Session.
    const log = requestLog(first!.sessionId);
    expect(log.slice(log.indexOf("POST /switch-model"))).toContain("GET /");
    expect(out).toContain(t.switchModelCurrent(TARGET));
    expect(replacement!.provider).toBe("openrouter");
    expect(replacement!.modelId).toBe("anthropic/claude-opus-5");
  });

  it("a failed switch prints the plain failed compaction line and no model line; the Session stays on its model", async () => {
    server.switchModel = streamedSwitch("fatal", "the summary does not fit");
    const out = await driveChat(["hello", SWITCH_LINE, "/switch-model", "/exit"]);
    expect(out).toContain(
      t.compactionStop("summarize", "fatal", undefined, "the summary does not fit"),
    );
    expect(out).not.toContain(t.switchModelDone(CURRENT, TARGET));
    expect(out).toContain(t.switchModelCurrent(CURRENT));
  });
});

describe("chat /switch-model: 200 switches a Session that never ran inline", () => {
  it("prints the model line without watching a stream; the Session is refreshed", async () => {
    server.switchModel = "inline";
    const out = await driveChat([SWITCH_LINE, "/switch-model", "/exit"]);
    expect(out).toContain(t.switchModelDone(CURRENT, TARGET));
    expect(out).not.toContain("[compaction]");
    expect(out).toContain(t.switchModelCurrent(TARGET));
    const session = [...server.sessions.values()][0]!;
    const log = requestLog(session.sessionId);
    expect(log.slice(log.indexOf("POST /switch-model"))).toContain("GET /");
    // Nothing ran, so there is nothing to resume.
    expect(out).not.toContain("--resume");
  });
});

describe("chat /switch-model: 409 refusals print one localized line each", () => {
  const cases: Array<[string, string]> = [
    ["task_in_progress", t.switchModelBusy()],
    ["compacting", t.switchModelBusy()],
    ["same_model", t.switchModelSame(TARGET)],
    [
      "model_not_configured",
      t.switchModelNotConfigured(
        TARGET,
        "penguin config model list",
        "penguin config model add --provider openrouter --model-id anthropic/claude-opus-5",
      ),
    ],
    ["model_unavailable", t.switchModelUnavailable(TARGET, "Refused: model_unavailable.")],
    ["compaction_not_configured", t.switchModelNoCompaction()],
    ["summary_too_large", t.switchModelSummaryTooLarge(TARGET, "Refused: summary_too_large.")],
  ];
  for (const [code, line] of cases) {
    it(code, async () => {
      server.switchModel = { refuse: code };
      const out = await driveChat([SWITCH_LINE, "/switch-model", "/exit"]);
      expect(out).toContain(`${line}\n`);
      expect(out).not.toContain(t.switchModelDone(CURRENT, TARGET));
      // Still on the original model; no refresh was needed.
      expect(out).toContain(t.switchModelCurrent(CURRENT));
      const session = [...server.sessions.values()][0]!;
      expect(requestLog(session.sessionId)).not.toContain("GET /");
    });
  }

  it("an unknown 409 code prints the server's error", async () => {
    server.switchModel = { refuse: "something_new" };
    const out = await driveChat([SWITCH_LINE, "/exit"]);
    expect(out).toContain(
      t.error(t.client.httpError(409, "something_new", "Refused: something_new.")),
    );
  });
});

describe("chat --resume with model flags", () => {
  it("is still rejected, pointing at /switch-model inside the chat", async () => {
    const existing = server.addSession();
    const prevExitCode = process.exitCode;
    try {
      const out = await driveChat(
        [],
        ["--resume", existing.sessionId, "--provider", "openrouter", "--model-id", "x"],
      );
      expect(out).toContain(t.error(t.resumeNoOverride()));
      expect(t.resumeNoOverride()).toContain("/switch-model");
      expect(process.exitCode).toBe(1);
      expect(server.requests).toHaveLength(0);
    } finally {
      process.exitCode = prevExitCode;
    }
  });
});
