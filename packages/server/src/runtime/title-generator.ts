/**
 * The **policy layer** for automatic Session title generation (conversation-page
 * extension).
 *
 * "How to generate" lives in the core SDK (`session.generateTitle`: an out-of-band
 * one-shot request on the session's own Model, no tools, thinking disabled, writes no
 * history/Trace); this module is only responsible for host-side policy:
 *   - When to generate: after a Task completes and the DB row's title is still NULL
 *     (i.e. after the first successful conversation);
 *   - Persistence and notification: writes sessions.title and pushes a `session_title`
 *     server event to the Session channel;
 *   - Bookkeeping: the one-shot request's token consumption is converted to token_usage
 *     and handed to usage-recorder for persistence;
 *   - Silent failure (logged): the title stays NULL and naturally retries after the next
 *     Task completes.
 */
import { emptyTokenCounts, sanitizeTitle, tokenUsage } from "@prismshadow/penguin-core";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { ChannelHub } from "./channel.js";
import type { ErrorSink } from "./error-recorder.js";
import type { RuntimeSession } from "./session-manager.js";
import type { UsageContext, UsageRecorder } from "./usage-recorder.js";

export interface TitleGeneratorDeps {
  sessions: SessionsRepo;
  channels: ChannelHub;
  recorder: Pick<UsageRecorder, "record">;
  /** Error persistence (optional: without it, only logs — same as before this was wired up). */
  errors?: ErrorSink;
  log?: (line: string) => void;
}

/** Host-side parameters for one title-generation request. */
export interface TitleRequest {
  /** Fallback material for when the LLM fails or returns an empty result (cleaned and truncated from the first non-empty line). */
  fallbackText: string;
  /** Material override (for subagents — the material is the subagent's own conversation); defaults to the first Task's material self-collected by the core Session. */
  material?: { userText: string; assistantText: string };
  /** The channel to push the `session_title` event to; defaults to `ctx.sessionId`. A
   *  subagent has no SSE channel of its own, so its title must reach the frontend via
   *  the **parent Session's** channel (the list updates in place by sessionId). */
  notifyOn?: string;
}

/** session-manager's minimal dependency on the title generator (tests inject a fake implementation). */
export interface TitleNotifier {
  maybeGenerate(
    ctx: UsageContext,
    session: Pick<RuntimeSession, "generateTitle">,
    req: TitleRequest,
  ): void;
}

export class TitleGenerator implements TitleNotifier {
  private readonly inflight = new Set<string>();
  private readonly log: (line: string) => void;

  constructor(private readonly deps: TitleGeneratorDeps) {
    this.log = deps.log ?? ((line) => console.error(line));
  }

  /** Generate a title in the background (fire-and-forget) when conditions are met: the row exists, title is still NULL, and no generation is already in flight. */
  maybeGenerate(
    ctx: UsageContext,
    session: Pick<RuntimeSession, "generateTitle">,
    req: TitleRequest,
  ): void {
    const row = this.deps.sessions.findById(ctx.sessionId);
    if (!row || row.title !== null) return;
    if (this.inflight.has(ctx.sessionId)) return;
    this.inflight.add(ctx.sessionId);
    void this.generate(ctx, session, req)
      .catch((err: unknown) => {
        this.log(`[title] Generation failed: ${err instanceof Error ? err.message : String(err)}`);
        this.deps.errors?.record({ source: "title", err, ctx, code: "title_failed" });
      })
      .finally(() => {
        this.inflight.delete(ctx.sessionId);
      });
  }

  private async generate(
    ctx: UsageContext,
    session: Pick<RuntimeSession, "generateTitle">,
    req: TitleRequest,
  ): Promise<void> {
    let title: string | null = null;
    try {
      // Material defaults to what the core Session self-collects during run; it's only
      // overridden in scenarios like subagents where the material isn't on that Session.
      const res = await session.generateTitle(
        req.material ? { material: req.material } : undefined,
      );
      title = res.title;
      // The one-shot request's real consumption is metered as usual (converted to token_usage and handed to recorder, attributed to this Session).
      if (res.usage) {
        try {
          await this.deps.recorder.record(ctx, tokenUsage(emptyTokenCounts(), res.usage));
        } catch (err) {
          this.log(
            `[title] Usage insert failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.deps.errors?.record({
            source: "title",
            err,
            ctx,
            code: "title_usage_insert_failed",
          });
        }
      }
    } catch (err) {
      // A model request error (rate limit / timeout / network, etc.) shouldn't leave the
      // title permanently missing: log it and fall through to the fallback.
      this.log(`[title] Model request failed: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.errors?.record({ source: "title", err, ctx, code: "title_llm_failed" });
    }
    // When the LLM produces no usable title (failure / empty result), truncate the fallback material's first line — this guarantees a title is always generated.
    const finalTitle = title ?? fallbackTitle(req.fallbackText);
    if (finalTitle === null) return;
    // There may already be a concurrent write during generation (e.g. a future manual rename): only persist if still NULL.
    const latest = this.deps.sessions.findById(ctx.sessionId);
    if (!latest || latest.title !== null) return;
    this.deps.sessions.updateTitle(ctx.sessionId, finalTitle);
    this.deps.channels
      .get(req.notifyOn ?? ctx.sessionId)
      .publish(
        { type: "session_title", sessionId: ctx.sessionId, title: finalTitle },
        "server_event",
      );
  }
}

/** Fallback title: take the material's first non-empty line, sanitize and truncate; if sanitizing empties it out (pure punctuation, etc.) fall back to the truncated original text; returns null if all-whitespace. */
function fallbackTitle(text: string): string | null {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  if (!firstLine) return null;
  // sanitizeTitle strips a pure-punctuation line down to empty — in that case keep the truncated original text, guaranteeing "a title is always obtained".
  return sanitizeTitle(firstLine) ?? firstLine.trim().slice(0, 30);
}
