/**
 * Requests to a Project model outside a chat turn — the one way a plugin's tool calls a model.
 *
 * A request goes out the way a Session's does: core's client factory (streamProjectModel) builds
 * the client from the Project's own connection for the model, with PenguinHarness's User-Agent,
 * the endpoint's attribution and chat's idle timeout, and the host's managed credential (the
 * resolver the Sessions use) when the model takes one. Its usage lands in the same ledger as a
 * chat turn's: one `usage_records` row per request, through the standalone path title
 * generation uses, marked with what the request was for (`purpose`), so its cost is priced by the
 * existing price path and counted in the Session's, the Agent's and the Project's totals. A
 * request that reported usage is billed by it; one that did not is a 0-token row with its status
 * (`failed`, `aborted`), as a chat request is.
 */
import type { UniConfig, UniEvent, UniMessage } from "@prismshadow/mmsp";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import {
  emptyTokenCounts,
  requestEnd,
  streamProjectModel,
  tokenUsage,
  usageToTokenCounts,
} from "@prismshadow/penguin-core";
import type { ProjectModelRequestEnd, StopReason } from "@prismshadow/penguin-core";
import type { ModelRefDto } from "@prismshadow/penguin-library-agent-api";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { UsageContext, UsageRecording } from "@prismshadow/penguin-library-observability";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import { HttpError } from "../http/errors.js";

/** Whom a request is for, and what it is for. */
export interface ProjectModelScope {
  projectId: string;
  /**
   * The Session it is made for: its usage counts toward that Session and its Agent, and gateways
   * that key a conversation see the Session's id. Absent: a Project-level request.
   */
  sessionId?: string;
  /** What it is for, as `<package>:<operation>` (`@acme/tools:t2i`); stored on its usage row. */
  purpose: string;
}

/** One request: the MMSP messages and config, and how long it may run. */
export interface ProjectModelRequest {
  messages: UniMessage[];
  /** MMSP's request config (modalities, voice, thinking …). */
  config?: UniConfig;
  /** Stops the request; its usage row says `aborted` unless the provider had reported usage. */
  signal?: AbortSignal;
  /** Longest wait between two events from the model (default: chat's, 600 s; 0 disables). */
  idleTimeoutMs?: number;
}

@Interface()
export abstract class ProjectModelRequests {
  /**
   * Streams one request to a configured model of the Project, MMSP's events as they arrive.
   * Throws (from the first read) a 404 for a Session that is not the Project's and a 400 for a
   * model the Project does not configure; anything the provider or MMSP throws reaches the
   * reader after the usage row is written.
   */
  abstract stream(
    scope: ProjectModelScope,
    model: ModelRefDto,
    request: Opaque<"ProjectModelRequest", ProjectModelRequest>,
  ): AsyncIterable<Opaque<"UniEvent", UniEvent>>;
}

/** The ledger row's status for a request that ended early: a failure is final, nothing retries it. */
function stopReasonOf(end: ProjectModelRequestEnd): StopReason {
  return end.status === "aborted" ? "aborted" : "fatal";
}

@Component()
export class ProjectModelRequestsService implements ProjectModelRequests {
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly usage!: UsageRecording;
  @Use() private readonly sessions!: SessionIndex;

  async *stream(
    scope: ProjectModelScope,
    model: ModelRefDto,
    request: Opaque<"ProjectModelRequest", ProjectModelRequest>,
  ): AsyncIterable<Opaque<"UniEvent", UniEvent>> {
    let agentId = "";
    if (scope.sessionId !== undefined) {
      const row = this.sessions.findById(scope.sessionId);
      if (row === null || row.projectId !== scope.projectId) {
        throw new HttpError(404, "session_not_found", "Session does not exist in this Project.");
      }
      agentId = row.agentId;
    }
    const config = await this.projectConfig.loadConfig(scope.projectId);
    const ref = { provider: model.provider, model_id: model.modelId };
    if (!config.models.some((m) => m.provider === ref.provider && m.model_id === ref.model_id)) {
      throw new HttpError(
        400,
        "model_not_configured",
        `The model is not in the Project config: (provider=${model.provider}, model_id=${model.modelId}).`,
      );
    }
    const apiKey = await this.projectConfig.modelRequestApiKey(scope.projectId, model);
    const ctx: UsageContext = {
      projectId: scope.projectId,
      agentId,
      sessionId: scope.sessionId ?? "",
      provider: model.provider,
      modelId: model.modelId,
      purpose: scope.purpose,
    };
    yield* streamProjectModel(
      {
        config,
        model: ref,
        messages: request.messages,
        ...(request.config !== undefined ? { uniConfig: request.config } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(scope.sessionId !== undefined ? { sessionId: scope.sessionId } : {}),
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
        ...(request.idleTimeoutMs !== undefined ? { idleTimeoutMs: request.idleTimeoutMs } : {}),
      },
      (end) => this.record(ctx, end),
    );
  }

  /**
   * One row for the request: its buckets when it reported usage (a failed request it was paid for
   * included, as chat counts one), 0 tokens for a completed one that reported none, else 0 tokens
   * and how it ended.
   */
  private async record(ctx: UsageContext, end: ProjectModelRequestEnd): Promise<void> {
    try {
      if (end.usage !== null || end.status === "completed") {
        const request = end.usage !== null ? usageToTokenCounts(end.usage) : emptyTokenCounts();
        await this.usage.record(ctx, tokenUsage(emptyTokenCounts(), request), "standalone");
      } else {
        await this.usage.record(ctx, requestEnd(stopReasonOf(end)), "standalone");
      }
    } catch (err) {
      // Bookkeeping never fails the request it describes.
      console.error(
        `[model-requests] usage insert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
