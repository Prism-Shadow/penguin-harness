/**
 * The **policy layer** for automatic Session title generation (conversation-page
 * extension).
 *
 * "How to generate" lives in the core SDK (`session.generateTitle`: an out-of-band
 * one-shot request on the session's own Model, no tools, thinking disabled, writes no
 * history/Trace); this module is only responsible for host-side policy:
 *   - When: at Task start, from the **user input alone** — the moment a run begins with
 *     user text, the first words of that text are persisted as an immediate fallback
 *     title, and the LLM request fires in the background to replace it. Neither step
 *     waits for any model output.
 *   - Persistence and notification: writes sessions.title and pushes a `session_title`
 *     server event to the Session channel (once for the fallback, once more if the LLM
 *     result replaces it).
 *   - Manual renames win: the LLM result only ever replaces the fallback this generator
 *     wrote itself (tracked in memory per session); any other value is left alone.
 *   - Bookkeeping: the one-shot request's token consumption is converted to token_usage
 *     and handed to usage-recorder for persistence;
 *   - Silent failure (logged): the fallback stays in place, and while the stored title
 *     still equals it the next Task start retries the LLM request.
 */
import {
  emptyTokenCounts,
  matchAttachedFileLine,
  matchAttachedImageLine,
  sanitizeTitle,
  stripConversationMarkers,
  tokenUsage,
} from "@prismshadow/penguin-core";
import type { ServerEvent } from "../api/types.js";
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
  /**
   * Publishes the `session_title` event on the user-level channel of everyone who can see
   * the Project (same contract as SessionManager's dep of the same name). This is what
   * reaches the session list: titles land at Task start, typically before any tab has
   * subscribed to the brand-new Session's own channel — the per-Session publish alone
   * would be dropped unheard. Optional: without it only the per-Session channel is served.
   */
  notifyProjectUsers?: (projectId: string, event: ServerEvent) => void;
}

/** Host-side parameters for one title-generation request. */
export interface TitleRequest {
  /** The user input this run started from: its first words become the immediate fallback title. */
  fallbackText: string;
  /** Material override (the main session passes its input text, a subagent the prompt that spawned it — assistant material stays empty either way, so the request never waits on model output); defaults to the material self-collected by the core Session. */
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
  /**
   * sessionId → the fallback title this generator wrote and the LLM may still replace.
   * An entry is dropped once the LLM result lands or a differing stored title (a manual
   * rename, or a title from before a restart) is observed — from then on the title is
   * treated as final. In-memory on purpose: the sessions table stores no auto/manual
   * marker, and after a restart an existing title is simply left alone.
   */
  private readonly pendingFallbacks = new Map<string, string>();
  private readonly log: (line: string) => void;

  constructor(private readonly deps: TitleGeneratorDeps) {
    this.log = deps.log ?? ((line) => console.error(line));
  }

  /**
   * Runs the title policy for one run start (fire-and-forget): persists the user-input
   * fallback if the row has no title yet, then generates the LLM replacement in the
   * background. No-ops when the stored title is anything other than NULL or the fallback
   * this generator wrote (manual renames and pre-existing titles are final), or when a
   * generation is already in flight.
   */
  maybeGenerate(
    ctx: UsageContext,
    session: Pick<RuntimeSession, "generateTitle">,
    req: TitleRequest,
  ): void {
    // Bookkeeping must never take down a run: call sites sit on the run's drive path, so
    // a DB failure here is logged and swallowed like every other bookkeeping write.
    try {
      if (!this.prepare(ctx, req)) return;
    } catch (err) {
      this.log(`[title] Fallback failed: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.errors?.record({ source: "title", err, ctx, code: "title_fallback_failed" });
      return;
    }
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

  /** Synchronous half of the policy: decides whether the LLM should run, writing the immediate fallback title on the way. */
  private prepare(ctx: UsageContext, req: TitleRequest): boolean {
    const row = this.deps.sessions.findById(ctx.sessionId);
    if (!row) return false;
    if (row.title !== null) {
      // Only the fallback this generator wrote is still replaceable; anything else
      // (manual rename, pre-restart title) is final.
      if (row.title !== this.pendingFallbacks.get(ctx.sessionId)) {
        this.pendingFallbacks.delete(ctx.sessionId);
        return false;
      }
      return true;
    }
    // First words of the user input, persisted before the LLM request is even issued —
    // the UI shows a title the moment the task starts.
    const fallback = fallbackTitle(req.fallbackText);
    if (fallback !== null) {
      this.pendingFallbacks.set(ctx.sessionId, fallback);
      this.persist(ctx, fallback, req.notifyOn);
    }
    return true;
  }

  private async generate(
    ctx: UsageContext,
    session: Pick<RuntimeSession, "generateTitle">,
    req: TitleRequest,
  ): Promise<void> {
    let title: string | null = null;
    try {
      // The material is the run's own user input (assistant material empty); it's absent
      // only for callers that rely on the core Session's self-collected material.
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
      // A model request error (rate limit / timeout / network, etc.) leaves the fallback
      // title standing; while the stored title still equals it, the next Task start retries.
      this.log(`[title] Model request failed: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.errors?.record({ source: "title", err, ctx, code: "title_llm_failed" });
    }
    if (title === null) return;
    // The LLM result replaces only the fallback this generator wrote (or fills a still-NULL
    // title); a manual rename that landed during generation wins.
    const latest = this.deps.sessions.findById(ctx.sessionId);
    if (!latest) return;
    if (latest.title !== null && latest.title !== this.pendingFallbacks.get(ctx.sessionId)) {
      this.pendingFallbacks.delete(ctx.sessionId);
      return;
    }
    this.pendingFallbacks.delete(ctx.sessionId);
    this.persist(ctx, title, req.notifyOn);
  }

  /**
   * Writes sessions.title and pushes the `session_title` event — to the given Session
   * channel (the session's own unless overridden) for the tab watching the conversation,
   * and to the Project's user-level channels for every session list. The latter is the
   * delivery that survives the start-of-run timing: a first Task's title fires before the
   * new Session's own channel has any subscriber.
   */
  private persist(ctx: UsageContext, title: string, notifyOn: string | undefined): void {
    this.deps.sessions.updateTitle(ctx.sessionId, title);
    const event: ServerEvent = { type: "session_title", sessionId: ctx.sessionId, title };
    this.deps.channels.get(notifyOn ?? ctx.sessionId).publish(event, "server_event");
    this.deps.notifyProjectUsers?.(ctx.projectId, event);
  }
}

/** Cap on the fallback title's length (same bound the LLM path's sanitizeTitle enforces). */
const FALLBACK_MAX_CHARS = 30;

/**
 * Fallback title: take the material's first non-empty line, truncate it to the first few
 * words, and sanitize; if sanitizing empties it out (pure punctuation, etc.) fall back to
 * the truncated line itself; returns null if all-whitespace. Exported for the Trace
 * listing's title fallback (trace-service derives a title from the first user prompt of
 * Sessions the DB has no title for) so both fallbacks stay one algorithm.
 */
export function fallbackTitle(text: string): string | null {
  // Strip machine markers first: a skill invocation prepends a `[use_skills]` block, so the
  // raw first non-empty line would otherwise be that marker rather than the user's request.
  const firstLine = stripConversationMarkers(text)
    .split("\n")
    .find((l) => l.trim().length > 0 && !isAttachmentLine(l.trim()));
  if (!firstLine) return null;
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  // Drop leading punctuation/quotes before truncating, so a decorated line spends the
  // length budget on words (a line that is nothing but punctuation is kept as-is).
  const lead = collapsed.replace(
    /^["'“”‘’「」『』《》〈〉【】()（）。.．!！?？;；,，、:：\s]+/,
    "",
  );
  const cut = truncateAtWord(lead || collapsed);
  // sanitizeTitle strips a pure-punctuation line down to empty — in that case keep the truncated line, guaranteeing "a title is always obtained".
  return sanitizeTitle(cut) ?? cut;
}

/**
 * A line that is nothing but an `[attached image: …]` / `[attached file: …]` marker. A message
 * that carries attachments and no typed text is exactly this line, so a title taken from it
 * would be a truncated absolute path out of the sender's home directory. Such a message gets
 * no fallback at all — the LLM material still carries the path, so the model can name the
 * conversation after the file, and until it answers the UI shows its untitled placeholder.
 */
function isAttachmentLine(line: string): boolean {
  return matchAttachedImageLine(line) !== null || matchAttachedFileLine(line) !== null;
}

/**
 * Truncates to `FALLBACK_MAX_CHARS`, avoiding a mid-word cut: when the boundary splits an
 * ASCII word the cut backs up to the last space instead. CJK text has no spaces and every
 * character stands alone, so a plain character cut is already a word cut there.
 *
 * A character outside the BMP (an emoji, a rare CJK ideograph) is two UTF-16 units, and a cut
 * between them leaves a lone surrogate, which has no UTF-8 encoding: SQLite stores U+FFFD in
 * its place and the SSE frame carries the same replacement. The boundary therefore steps back
 * one unit rather than splitting the pair.
 */
function truncateAtWord(text: string): string {
  if (text.length <= FALLBACK_MAX_CHARS) return text;
  const end = splitsSurrogatePair(text, FALLBACK_MAX_CHARS)
    ? FALLBACK_MAX_CHARS - 1
    : FALLBACK_MAX_CHARS;
  const cut = text.slice(0, end);
  const wordChar = /[A-Za-z0-9'’_-]/;
  if (wordChar.test(text[end]!) && wordChar.test(cut[cut.length - 1]!)) {
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > 0) return cut.slice(0, lastSpace).trimEnd();
  }
  return cut.trimEnd();
}

/** True when index `i` falls between the high and low halves of one surrogate pair. */
function splitsSurrogatePair(text: string, i: number): boolean {
  const high = text.charCodeAt(i - 1);
  const low = text.charCodeAt(i);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}
