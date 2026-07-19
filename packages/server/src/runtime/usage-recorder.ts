/**
 * Usage persistence.
 *
 * Consumes the Session output stream:
 *   - A subagent's `session_meta` (carrying origin) → registers the mapping "origin's
 *     last session_id → (provider, model_id)" (a subagent may use a different Model, so
 *     cost is priced against the actual Model used);
 *   - `token_usage` → inserts one usage_records row: the four token fields come from
 *     `payload.request` (per-Request increment; subagents are recorded one row at a
 *     time, with `session_id` attributed to their owning main Session). Only tokens are
 *     persisted, not cost — pricing may be added later, and cost is computed on the fly
 *     against current pricing when usage-service queries.
 * The attribution key is always the paired reference `(provider, model_id)` (the same
 * model_id name across different vendors is attributed separately).
 */
import { isEventMessage, isSessionMeta } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { formatLocalDate } from "../internal/dates.js";
import type { UsageRepo } from "../db/repos/usage.js";

/** Attribution context for one record (top-level Session scope). */
export interface UsageContext {
  projectId: string;
  agentId: string;
  /** Top-level Session id (the current actual id after self-heal). */
  sessionId: string;
  /** Vendor grouping for the top-level Session's model (paired with modelId; the fallback attribution when the origin mapping has no hit). */
  provider: string;
  /** Upstream model_id of the top-level Session (paired with provider). */
  modelId: string;
}

/** Cap on the subagent attribution mapping: over the limit, evicts the oldest by insertion order (an evicted entry falls back to the main Session's Model attribution). */
export const ORIGIN_MODELS_MAX = 1000;

export class UsageRecorder {
  /** Subagent model attribution mapping: origin's last session_id → paired reference (session_id is globally unique). */
  private readonly originModels = new Map<string, { provider: string; modelId: string }>();

  constructor(
    private readonly usage: UsageRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Consume one outgoing message; messages other than session_meta / token_usage are a no-op. */
  async record(ctx: UsageContext, msg: OmniMessage): Promise<void> {
    if (isSessionMeta(msg) && msg.origin && msg.origin.length > 0) {
      const originSessionId = msg.origin[msg.origin.length - 1]!;
      // Bounded mapping (avoids unbounded growth over a long-running process): re-inserting refreshes insertion order, over the limit evicts the oldest.
      this.originModels.delete(originSessionId);
      this.originModels.set(originSessionId, {
        provider: msg.payload.provider,
        modelId: msg.payload.model_id,
      });
      if (this.originModels.size > ORIGIN_MODELS_MAX) {
        const oldest = this.originModels.keys().next().value;
        if (oldest !== undefined) this.originModels.delete(oldest);
      }
      return;
    }
    if (!isEventMessage(msg)) return;
    const payload = msg.payload as {
      type?: string;
      request?: { cache_read: number; cache_write: number; output: number; total: number };
      status?: string;
    };

    const originSessionId =
      msg.origin && msg.origin.length > 0 ? msg.origin[msg.origin.length - 1]! : null;
    // Empty origin → main session's Model; otherwise look up the mapping, falling back to the main Session's Model (paired) on a miss.
    const ref =
      originSessionId === null
        ? { provider: ctx.provider, modelId: ctx.modelId }
        : (this.originModels.get(originSessionId) ?? {
            provider: ctx.provider,
            modelId: ctx.modelId,
          });
    const now = this.now();
    const base = {
      ts: now.toISOString(),
      date: formatLocalDate(now),
      projectId: ctx.projectId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      originSessionId,
      provider: ref.provider,
      modelId: ref.modelId,
    };

    if (payload.type === "token_usage" && payload.request) {
      // A successful request: persist along with tokens (status defaults to completed).
      const r = payload.request;
      this.usage.insert({
        ...base,
        cacheRead: r.cache_read,
        cacheWrite: r.cache_write,
        output: r.output,
        total: r.total,
      });
      return;
    }
    // A failed request (request_end and not completed, usually with no token_usage):
    // persist 0 tokens + status, feeding the "model success rate" stat; a successful
    // request is already counted once via the token_usage branch above, not repeated here.
    if (payload.type === "request_end" && payload.status && payload.status !== "completed") {
      this.usage.insert({
        ...base,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 0,
        status: payload.status,
      });
    }
  }
}
