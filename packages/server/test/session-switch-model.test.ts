/**
 * POST /api/sessions/:id/switch-model — the server half of an in-session model switch (core does
 * the compaction and the rotation; a fake Session stands in for it here, shaped like the real
 * one: an ordinary manual compaction pair, the getters moving once the new context is open, then
 * that context's main-session `session_meta` as the stream's last record).
 *
 * What this file pins is the HTTP contract on `SessionSwitchModelRequest` — the 400 for half a
 * pair, each 409 code, 202 for a streamed switch and 200 for a Session that never ran — and the
 * bookkeeping the contract implies: the index row and the runtime entry move to the new model
 * (so `GET /` and the compaction threshold follow it, and a client refetching on the new
 * context's `session_meta` already reads it), stay put when the compaction fails or is aborted,
 * and usage is attributed to the model that served each request — the switch's own compaction
 * request to the previous model, the next Task to the new one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  ModelSwitchRefusedError,
  requestBegin,
  requestEnd,
  sessionMeta,
  tokenUsage,
} from "@prismshadow/penguin-core";
import type {
  ModelRef,
  ModelSwitchResult,
  OmniMessage,
  StopReason,
  TokenCounts,
} from "@prismshadow/penguin-core";
import type {
  ModelRefDto,
  ServerEvent,
  SessionContextResponse,
  SessionResponse,
  TaskCreateResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { compactionThresholdFor } from "../src/services/context-breakdown.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-09-16-10-00-00-aabb0007";
const PROJECT = "switcher-default_project";
const A: ModelRefDto = { provider: "custom", modelId: "m-alpha" };
const B: ModelRefDto = { provider: "custom", modelId: "m-beta" };
/** Configured with B on purpose left out: the manager must refuse it before core is asked. */
const UNKNOWN: ModelRefDto = { provider: "custom", modelId: "m-nowhere" };
const WINDOW_A = 1_000_000;
const WINDOW_B = 200_000;

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** How the fake's `switchModel` behaves once core would have validated the target. */
type SwitchBehaviour =
  /** Core threw before its first event: a typed refusal, or — a failure — anything else. */
  | { kind: "throw"; error: Error }
  /** A Session that never ran: re-assembled on the target, nothing streamed. */
  | { kind: "inline" }
  /** The compaction pair streams; `status` is how it ends. `gate` parks the compaction until it settles (or the signal fires). */
  | { kind: "stream"; status: StopReason; gate?: Promise<void> };

interface SwitchFake extends RuntimeSession {
  provider: string;
  modelId: string;
  /** The signals `switchModel` was handed, so a test can see the abort reach it. */
  signals: AbortSignal[];
}

/**
 * A fake Session shaped like core's for a switch: the compaction request's token_usage rides
 * between a plain manual pair, and the getters move only once the new context is open — after
 * the completed `compaction_end` and before the new context's `session_meta` is yielded, exactly
 * as core adopts the opened context before `openContextFile` yields its meta — so the manager's
 * two update sites are exercised in the real order.
 */
function switchFake(model: ModelRefDto, behaviour: SwitchBehaviour): SwitchFake {
  const fake: SwitchFake = {
    sessionId: SID,
    provider: model.provider,
    modelId: model.modelId,
    signals: [],
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(): AsyncGenerator<OmniMessage> {
      yield requestBegin();
      yield assistantText("answered");
      yield requestEnd("completed");
      yield tokenUsage(counts(50), counts(50));
    },
    async *compact(): AsyncGenerator<OmniMessage> {},
    async *switchModel(opts): AsyncGenerator<OmniMessage, ModelSwitchResult> {
      fake.signals.push(opts.signal);
      const previous: ModelRef = { provider: fake.provider, model_id: fake.modelId };
      const next: ModelRef = { provider: opts.provider, model_id: opts.modelId };
      if (behaviour.kind === "throw") throw behaviour.error;
      if (behaviour.kind === "inline") {
        fake.provider = opts.provider;
        fake.modelId = opts.modelId;
        return { status: "completed", previous, next };
      }
      yield compactionBegin({ reason: "manual", mode: "summarize", context: 4000, turns: 3 });
      // The compaction request itself, on the model being left.
      yield tokenUsage(counts(4000), counts(4000));
      if (behaviour.gate) {
        await Promise.race([
          behaviour.gate,
          new Promise<void>((resolve) => {
            if (opts.signal.aborted) resolve();
            else opts.signal.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
      }
      const status: StopReason = opts.signal.aborted ? "aborted" : behaviour.status;
      yield compactionEnd({ reason: "manual", mode: "summarize", status });
      if (status === "completed") {
        // The new context opens on the target: the getters follow it from here, and its
        // session_meta — main-session, no origin — is the last record on the stream.
        fake.provider = opts.provider;
        fake.modelId = opts.modelId;
        yield sessionMeta({
          session_id: SID,
          provider: opts.provider,
          model_id: opts.modelId,
          model_context_window: WINDOW_B,
          system_prompt: "sp",
          agent_state: "/tmp/agents/default_agent/agent_state",
          workspace: "/tmp/w",
        });
      }
      return { status, previous, next };
    },
  };
  return fake;
}

describe("POST /switch-model", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  const row = (): SessionRow => t.deps.sessionsRepo.findById(SID)!;
  const url = `/api/sessions/${SID}/switch-model`;

  /** Inserts the Session's row on model A and adopts `fake` as its runtime. */
  const adopt = (fake: RuntimeSession): void => {
    const inserted: SessionRow = {
      sessionId: SID,
      projectId: PROJECT,
      agentId: "default_agent",
      provider: A.provider,
      modelId: A.modelId,
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: "2026-09-16T10:00:00.000Z",
      lastActiveAt: "2026-09-16T10:00:00.000Z",
    };
    t.deps.sessionsRepo.insert(inserted);
    t.deps.manager.adopt(inserted, fake);
  };

  /** The Session channel's traffic, split into messages and server events, as an SSE client sees it. */
  const listen = () => {
    const messages: OmniMessage[] = [];
    const events: ServerEvent[] = [];
    /** The row's model as it stood when each compaction_end was published. */
    const rowAtEnd: ModelRefDto[] = [];
    /** The row's model as it stood when each session_meta was published. */
    const rowAtMeta: ModelRefDto[] = [];
    t.deps.channels.get(SID).subscribe((evt) => {
      if (evt.event === "server_event") {
        events.push(JSON.parse(evt.data) as ServerEvent);
        return;
      }
      const msg = JSON.parse(evt.data) as OmniMessage;
      messages.push(msg);
      const r = row();
      if (msg.type === "session_meta") rowAtMeta.push({ provider: r.provider, modelId: r.modelId });
      if ((msg.payload as { type?: string }).type === "compaction_end") {
        rowAtEnd.push({ provider: r.provider, modelId: r.modelId });
      }
    });
    return {
      messages,
      events,
      rowAtEnd,
      rowAtMeta,
      /** Each message's kind: its payload type, or `session_meta`. */
      kinds: () =>
        messages.map((m) =>
          m.type === "session_meta" ? "session_meta" : (m.payload as { type?: string }).type,
        ),
      states: () => events.flatMap((e) => (e.type === "task_state" ? [e.state] : [])),
    };
  };

  const usageModels = (): string[] =>
    (
      t.deps.db.prepare("SELECT model_id FROM usage_records ORDER BY id").all() as {
        model_id: string;
      }[]
    ).map((r) => r.model_id);

  const errorCode = async (res: Response): Promise<string> =>
    ((await res.json()) as { error: { code: string } }).error.code;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "switcher");
    api = apiClient(t.app, cookie);
    // Two configured models with different windows (the compaction threshold must follow the
    // switch); the third one a test names is deliberately absent.
    const put = await api.put(`/api/projects/${PROJECT}/models`, {
      defaultModel: A,
      models: [
        {
          ...A,
          apiKey: "sk-alpha",
          baseUrl: "https://alpha.example/v1",
          clientType: "openai",
          contextWindow: WINDOW_A,
        },
        {
          ...B,
          apiKey: "sk-beta",
          baseUrl: "https://beta.example/v1",
          clientType: "openai",
          contextWindow: WINDOW_B,
        },
      ],
    });
    expect(put.status).toBe(200);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("400 for half a pair or a non-string half — nothing is inferred", async () => {
    adopt(switchFake(A, { kind: "inline" }));
    for (const body of [
      { provider: "custom" },
      { modelId: "m-beta" },
      { provider: 1, modelId: "m-beta" },
      { provider: "", modelId: "m-beta" },
    ]) {
      const res = await api.post(url, body);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("bad_request");
    }
    expect(row().modelId).toBe(A.modelId);
  });

  it("409 same_model: the target is the model the Session already runs on", async () => {
    const fake = switchFake(A, { kind: "inline" });
    adopt(fake);
    const res = await api.post(url, A);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("same_model");
    expect(fake.signals).toHaveLength(0); // core was never asked
  });

  it("409 model_not_configured: the target is not in the Project config — refused before core is asked", async () => {
    const fake = switchFake(A, { kind: "inline" });
    adopt(fake);
    const res = await api.post(url, UNKNOWN);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("model_not_configured");
    expect(fake.signals).toHaveLength(0);
    expect(row().modelId).toBe(A.modelId);
  });

  it("409 model_unavailable: core cannot construct the target (no credential), or the runtime has no switch at all", async () => {
    adopt(
      switchFake(A, {
        kind: "throw",
        error: new ModelSwitchRefusedError(
          "model_unavailable",
          "Missing credentials for provider custom (api_key).",
        ),
      }),
    );
    const res = await api.post(url, B);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("model_unavailable");
    // The loader's wording is replaced by the remedy the Web App can act on.
    expect(body.error.message).toContain("no API key");
    expect(t.deps.manager.statusOf(SID)).toBe("idle");
    expect(row().modelId).toBe(A.modelId);

    // A runtime with no `switchModel` at all (core's "not available for this Session") reads
    // the same way: the target exists, it just cannot be switched to here.
    const noSwitch = switchFake(A, { kind: "inline" });
    delete (noSwitch as Partial<SwitchFake>).switchModel;
    t.deps.manager.adopt(row(), noSwitch);
    const bare = await api.post(url, B);
    expect(bare.status).toBe(409);
    expect(await errorCode(bare)).toBe("model_unavailable");
    expect(row().modelId).toBe(A.modelId);
  });

  it("409 summary_too_large with core's own numbers: a summary already held does not fit the target's window", async () => {
    // A Session just compacted has a summary in hand; core refuses before any event when the
    // target cannot take it (there is no pair to end `fatal`). The message names both sizes.
    const message =
      "The summary held for the next context (about 15000 tokens) does not fit the context window of the model switched to (8000 tokens, about 5000 left after its prompt and tools); the Session stays on its current model.";
    adopt(
      switchFake(A, {
        kind: "throw",
        error: new ModelSwitchRefusedError("summary_too_large", message),
      }),
    );
    const res = await api.post(url, B);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("summary_too_large");
    expect(body.error.message).toBe(message);
    expect(t.deps.manager.statusOf(SID)).toBe("idle");
    expect(row().modelId).toBe(A.modelId);
  });

  it("409 compaction_not_configured: the Session has a context to close but no compaction to close it with", async () => {
    adopt(
      switchFake(A, {
        kind: "throw",
        error: new ModelSwitchRefusedError("compaction_not_configured", "no compaction here"),
      }),
    );
    const res = await api.post(url, B);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("compaction_not_configured");
    expect(row().modelId).toBe(A.modelId);
  });

  it("anything else core throws before its first event is a failure, not a refusal: 500, and the row stays", async () => {
    // An Agent State that no longer parses, a bootstrap that broke — mapped to a 409 they would
    // tell the user to configure the model, which is not what happened.
    const errors: string[] = [];
    const original = console.error;
    console.error = (line: string) => void errors.push(String(line));
    try {
      adopt(
        switchFake(A, {
          kind: "throw",
          error: new Error("system_config.yaml: unexpected token at line 3"),
        }),
      );
      const res = await api.post(url, B);
      expect(res.status).toBe(500);
      expect(await errorCode(res)).toBe("internal");
    } finally {
      console.error = original;
    }
    expect(errors.some((l) => l.includes("system_config.yaml: unexpected token"))).toBe(true);
    expect(t.deps.manager.statusOf(SID)).toBe("idle");
    expect(row().modelId).toBe(A.modelId);
  });

  it("the idle gate: 409 task_in_progress while a Task runs, 409 compacting while a switch is in flight, and a Task is refused during the switch", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = switchFake(A, { kind: "stream", status: "completed", gate });
    // A run that parks too, on the same gate.
    fake.run = async function* (): AsyncGenerator<OmniMessage> {
      await gate;
      yield assistantText("done");
    };
    adopt(fake);

    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "busy" }] });
    await waitFor(() => t.deps.manager.statusOf(SID) === "running");
    const whileRunning = await api.post(url, B);
    expect(whileRunning.status).toBe(409);
    expect(await errorCode(whileRunning)).toBe("task_in_progress");
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    let releaseSwitch = () => {};
    const switchGate = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    const switching = switchFake(A, { kind: "stream", status: "completed", gate: switchGate });
    t.deps.manager.adopt(row(), switching);
    expect((await api.post(url, B)).status).toBe(202);
    await waitFor(() => t.deps.manager.statusOf(SID) === "compacting");
    const whileSwitching = await api.post(url, B);
    expect(whileSwitching.status).toBe(409);
    expect(await errorCode(whileSwitching)).toBe("compacting");
    const task = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "wait" }],
    });
    expect(task.status).toBe(409);
    expect(await errorCode(task)).toBe("compacting");
    releaseSwitch();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(row().modelId).toBe(B.modelId);
  });

  it("202: streams a plain manual compaction and then the new context's session_meta; the row and the entry move to the target as that meta is published, and GET / plus the compaction threshold follow", async () => {
    const fake = switchFake(A, { kind: "stream", status: "completed" });
    adopt(fake);
    const agentMax = (await t.deps.agentConfigService.getConfig(PROJECT, "default_agent")).config
      .compaction?.maxContextLength;
    const thresholdBefore = (
      (await (await api.get(`/api/sessions/${SID}/context`)).json()) as SessionContextResponse
    ).compactionThreshold;
    expect(thresholdBefore).toBe(compactionThresholdFor(agentMax, WINDOW_A));
    const feed = listen();

    const res = await api.post(url, B);
    expect(res.status).toBe(202);
    expect((await res.json()) as TaskCreateResponse).toEqual({ sessionId: SID });
    await waitFor(() => feed.states().includes("idle"));

    expect(feed.states()).toEqual(["compacting", "idle"]);
    expect(feed.kinds()).toEqual([
      "compaction_begin",
      "token_usage",
      "compaction_end",
      "session_meta",
    ]);
    // Nothing on the pair names a model.
    expect(feed.messages[2]!.payload).toEqual({
      type: "compaction_end",
      reason: "manual",
      mode: "summarize",
      status: "completed",
    });
    // The new model is on the new context's meta, a main-session record (no origin).
    const meta = feed.messages[3]!;
    expect(meta.origin).toBeUndefined();
    expect(meta.payload).toMatchObject({ provider: B.provider, model_id: B.modelId });
    // A client refetching the Session on that very record reads the new model: the row had
    // already moved when the meta was published (and not yet when the end was).
    expect(feed.rowAtEnd).toEqual([A]);
    expect(feed.rowAtMeta).toEqual([B]);
    expect(row()).toMatchObject(B);
    const info = ((await (await api.get(`/api/sessions/${SID}`)).json()) as SessionResponse)
      .session;
    expect(info).toMatchObject(B);
    const thresholdAfter = (
      (await (await api.get(`/api/sessions/${SID}/context`)).json()) as SessionContextResponse
    ).compactionThreshold;
    expect(thresholdAfter).toBe(compactionThresholdFor(agentMax, WINDOW_B));
    expect(thresholdAfter).not.toBe(thresholdBefore);
  });

  it("usage: the switch's compaction request bills to the previous model, the next Task to the new one", async () => {
    adopt(switchFake(A, { kind: "stream", status: "completed" }));
    expect((await api.post(url, B)).status).toBe(202);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(usageModels()).toEqual([A.modelId]);

    const task = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "on the new model" }],
    });
    expect(task.status).toBe(202);
    await waitFor(() => usageModels().length === 2);
    expect(usageModels()).toEqual([A.modelId, B.modelId]);
  });

  it("a failed compaction leaves the row, the entry and the attribution on the previous model", async () => {
    adopt(switchFake(A, { kind: "stream", status: "fatal" }));
    const feed = listen();
    expect((await api.post(url, B)).status).toBe(202);
    await waitFor(() => feed.states().includes("idle"));
    expect((feed.messages[2]!.payload as { status: string }).status).toBe("fatal");
    // No switch, so no new context and no session_meta.
    expect(feed.kinds()).toEqual(["compaction_begin", "token_usage", "compaction_end"]);
    expect(feed.rowAtEnd).toEqual([A]);
    expect(row()).toMatchObject(A);

    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "still A" }] });
    await waitFor(() => usageModels().length === 2);
    expect(usageModels()).toEqual([A.modelId, A.modelId]);
  });

  it("an aborted switch (POST /abort mid-compaction) ends `aborted` and leaves the row on the previous model", async () => {
    const fake = switchFake(A, {
      kind: "stream",
      status: "completed",
      gate: new Promise(() => {}),
    });
    adopt(fake);
    const feed = listen();
    expect((await api.post(url, B)).status).toBe(202);
    await waitFor(() => t.deps.manager.statusOf(SID) === "compacting" && fake.signals.length === 1);

    expect((await api.post(`/api/sessions/${SID}/abort`, {})).status).toBe(202);
    await waitFor(() => feed.states().includes("idle"));
    expect(fake.signals[0]!.aborted).toBe(true);
    const last = feed.messages[feed.messages.length - 1]!;
    expect((last.payload as { status: string }).status).toBe("aborted");
    expect(feed.rowAtMeta).toEqual([]);
    expect(row()).toMatchObject(A);
    expect(fake.modelId).toBe(A.modelId);
  });

  it("a main-session session_meta on the stream registers no child and records no error", async () => {
    adopt(switchFake(A, { kind: "stream", status: "completed" }));
    const feed = listen();
    expect((await api.post(url, B)).status).toBe(202);
    await waitFor(() => feed.states().includes("idle"));

    // The meta reached subscribers as the switch's last record, without an origin…
    const meta = feed.messages.at(-1)!;
    expect(meta.type).toBe("session_meta");
    expect(meta.origin).toBeUndefined();
    // …and the drive read it as the main session's own record: no child row, no
    // session_created event, no registration failure on record.
    expect(t.deps.sessionsRepo.listByProject(PROJECT).map((r) => r.sessionId)).toEqual([SID]);
    expect(feed.events.filter((e) => e.type === "session_created")).toEqual([]);
    expect(t.deps.errorsRepo.recent(PROJECT).map((r) => r.code)).toEqual([]);
  });

  it("200: a Session that never ran switches inside the request — no events, the fresh DTO carries the new model, the row too", async () => {
    adopt(switchFake(A, { kind: "inline" }));
    const feed = listen();
    const res = await api.post(url, B);
    expect(res.status).toBe(200);
    const { session } = (await res.json()) as SessionResponse;
    expect(session).toMatchObject({ sessionId: SID, ...B });
    expect(row()).toMatchObject(B);
    expect(t.deps.manager.statusOf(SID)).toBe("idle");
    // Nothing streamed: no compaction pair, no status flip.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(feed.messages).toEqual([]);
    expect(feed.events).toEqual([]);
    expect(usageModels()).toEqual([]);
  });
});
