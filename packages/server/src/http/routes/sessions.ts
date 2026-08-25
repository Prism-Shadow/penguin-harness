/**
 * Session routes.
 *
 * Two entry groups:
 *   - Agent-level: GET|POST /api/projects/:p/agents/:a/sessions (list including run state / create);
 *   - Session-level: /api/sessions/:sessionId/* (no projectId; looks up project_id via the
 *     sessions index, then goes through requireProjectAccess; 404 if the index has no such Session).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { imageUrlMessage, scratchpadDir, userText } from "@prismshadow/penguin-core";
import type { OmniMessage, ThinkingLevelName } from "@prismshadow/penguin-core";
import type {
  ApprovalMode,
  FilesStatResponse,
  GoalResponse,
  MessagesLiveTail,
  MessagesPageInfo,
  MessagesResponse,
  RecalledMessageResponse,
  ServerEvent,
  SessionCategory,
  SessionContextResponse,
  SessionCreateResponse,
  SessionForkResponse,
  SessionProcessesResponse,
  SessionResponse,
  SessionsResponse,
  SubagentMessageResponse,
  RetryNowResponse,
  TaskCreateResponse,
} from "../../api/types.js";
import { compactionThresholdFor } from "../../services/context-breakdown.js";
import { decodeCursor } from "../../services/message-window.js";
import type { MessagesPageRequest } from "../../services/trace-service.js";
import { PREVIEW_TOKEN_TTL_MS, resolvePreviewTarget } from "../../services/preview-token.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { SessionRow } from "../../db/repos/sessions.js";
import { assertWorkspaceAllowed } from "../../services/workspace-guard.js";
import { HttpError } from "../errors.js";
import { sseEndpoint } from "../sse.js";
import {
  badRequest,
  optionalEnum,
  optionalPagingQuery,
  optionalString,
  paginationQuery,
  pathParam,
  positiveIntParam,
  readJson,
  requireEnum,
  requireValidId,
} from "../validate.js";
import type { AppDeps } from "../../app.js";
import { MAX_UPLOAD_BYTES } from "../../services/workspace-files-service.js";
import {
  assertAttachmentBudget,
  attachFilesToInput,
  parseAttachmentPart,
  readRecalledFiles,
  removeAttachments,
} from "../../services/task-attachments.js";
import type { TaskAttachment } from "../../services/task-attachments.js";
import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_MAX_MB,
  toAttachmentLimits,
} from "../../services/attachment-limits.js";
import type { AttachmentLimits } from "../../services/attachment-limits.js";
import type { RecallStore } from "../../runtime/session-manager.js";

/** Max title length for manual renames: looser than the auto-generated 30-char limit, to accommodate users' own organizing conventions. */
const SESSION_TITLE_MAX = 120;

/** Max path count and per-path length for a single files/stat check (message file-card candidates never exceed this scale). */
const STAT_MAX_PATHS = 100;
const STAT_MAX_PATH_LEN = 512;

/** The four approval modes (shared with the chat-defaults route's validation). */
export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "deny-all",
  "read-only",
  "always-ask",
];

/** The valid per-turn thinking level names (TaskCreateRequest.thinkingLevel). */
const THINKING_LEVELS: readonly ThinkingLevelName[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Unit-count bounds for windowed history reads (`tailLimit` / `limit`), and the `before` page's default. */
const MESSAGES_PAGE_LIMIT_MAX = 1000;
const MESSAGES_PAGE_LIMIT_DEFAULT = 200;

/** Parse one windowed-read unit-count param (positive integer, capped). */
function pageLimit(raw: string, name: string): number {
  if (!/^\d{1,4}$/.test(raw)) throw badRequest(`${name} must be a positive integer.`);
  const v = Number.parseInt(raw, 10);
  if (v < 1 || v > MESSAGES_PAGE_LIMIT_MAX) {
    throw badRequest(`${name} must be an integer between 1 and ${MESSAGES_PAGE_LIMIT_MAX}.`);
  }
  return v;
}

/**
 * Parse GET /messages windowed-read params. No params → null: the legacy full-transcript
 * read, byte-identical to the pre-pagination response (other consumers depend on it).
 * `tailLimit=<n>` → the newest n units; `before=<cursor>[&limit=<n>]` → the n units
 * preceding the cursor. The two forms are mutually exclusive, and `limit` belongs to
 * `before` alone — mixing them is a caller bug worth a loud 400 rather than a guess.
 */
/**
 * Appends the running Task's already-published input messages that the Trace read has not
 * caught up to yet. Duplication is decided by exact envelope-JSON identity — the engine
 * writes the very same envelopes, and the client's overlap dedup uses the same rule — and
 * only the history tail can contain them (inputs are the newest records when this races).
 */
function appendPendingInputs(messages: OmniMessage[], pending: OmniMessage[]): OmniMessage[] {
  if (pending.length === 0) return messages;
  const envelopeKey = (message: OmniMessage): string => {
    const { tracePosition: _tracePosition, ...envelope } = message as OmniMessage & {
      tracePosition?: unknown;
    };
    return JSON.stringify(envelope);
  };
  const tail = new Set(messages.slice(-50).map(envelopeKey));
  const missing = pending.filter((message) => !tail.has(envelopeKey(message)));
  return missing.length > 0 ? [...messages, ...missing] : messages;
}

function messagesPageQuery(c: Context): MessagesPageRequest | null {
  const rawTail = c.req.query("tailLimit");
  const rawBefore = c.req.query("before");
  const rawLimit = c.req.query("limit");
  if (rawTail === undefined && rawBefore === undefined) {
    if (rawLimit !== undefined) throw badRequest("limit requires before.");
    return null;
  }
  if (rawTail !== undefined) {
    if (rawBefore !== undefined) throw badRequest("tailLimit and before are mutually exclusive.");
    if (rawLimit !== undefined) throw badRequest("limit only applies to before requests.");
    return { kind: "tail", limit: pageLimit(rawTail, "tailLimit") };
  }
  const cursor = decodeCursor(rawBefore!);
  if (cursor === null) {
    throw badRequest("before must be a cursor of the form <shardIndex>:<ordinal>.");
  }
  return {
    kind: "before",
    cursor,
    limit: rawLimit !== undefined ? pageLimit(rawLimit, "limit") : MESSAGES_PAGE_LIMIT_DEFAULT,
  };
}

/**
 * Where compaction will fire for one Session, in tokens of occupancy: the Agent's configured
 * threshold capped by what its model's context window leaves room for. Both halves are read from
 * config rather than from a running engine, so an idle Session answers as well as a busy one.
 *
 * Fail-soft: this is one mark on a gauge, and an Agent deleted out from under a still-indexed
 * Session (or a config that will not parse) must not take the whole composition down with it.
 */
async function sessionCompactionThreshold(deps: AppDeps, row: SessionRow): Promise<number | null> {
  try {
    const [agent, project] = await Promise.all([
      deps.agentConfigService.getConfig(row.projectId, row.agentId),
      deps.projectConfigService.loadConfig(row.projectId),
    ]);
    const entry = (project.models ?? []).find(
      (m) => m.provider === row.provider && m.model_id === row.modelId,
    );
    return compactionThresholdFor(agent.config.compaction?.maxContextLength, entry?.context_window);
  } catch {
    return null;
  }
}

/** Accepted `category` query values of the list endpoint (SessionCategory, spelled out for validation). */
const SESSION_CATEGORIES: readonly SessionCategory[] = [
  "active",
  "subagent",
  "schedule",
  "archived",
];

/**
 * A base64 `data:` URL of an image, in the exact shape core parses it back out of
 * (`imagesToScratchpadPaths`): one mime type, the `;base64,` marker, a non-empty base64 body.
 * The mime is deliberately unconstrained — core maps the ones it knows to a file extension and
 * falls back to `.bin`, and the image tools sniff the magic bytes rather than trusting either.
 *
 * Checking the body, not just the `data:` prefix, is what keeps the failure here instead of
 * three layers down: core turns a data URL it cannot parse into an "[an attached image could
 * not be saved and was dropped]" line, which for an HTTP caller means a 202 followed by a
 * message quietly missing its picture. The file-attachment field has always validated its own
 * payload this way (parseAttachmentPart); this is the same rule for images.
 */
const IMAGE_DATA_URL = /^data:[^;,]+;base64,[A-Za-z0-9+/=\s]+$/;

/**
 * The image-URL rule every image-carrying request field obeys: a `data:` URL the session
 * keeps (inline, or written to the scratchpad without vision) or an http(s) URL it references.
 * `field` names the offending value in the error, so each caller reads as if it validated
 * inline.
 */
function requireImageUrl(url: unknown, field: string): string {
  if (typeof url === "string") {
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (IMAGE_DATA_URL.test(url)) {
      // An inline image is not an attachment: it enters the conversation and is written verbatim
      // into the Trace, which is read back whole — into one JS string — on every history page and
      // every resume. So it gets its own fixed ceiling instead of following the (much larger,
      // admin-settable) attachment cap up. Measured on the decoded length rather than the data
      // URL's, so the number in the error is the number a person sees in a file manager.
      const bytes = dataUrlByteLength(url);
      if (bytes > INLINE_IMAGE_MAX_BYTES) {
        throw new HttpError(
          413,
          "image_too_large",
          `${field} exceeds the ${INLINE_IMAGE_MAX_MB}MB inline image limit.`,
        );
      }
      return url;
    }
  }
  throw badRequest(
    `${field} must be an http(s) URL or a base64 data: URL (data:<mime>;base64,<bytes>).`,
  );
}

/**
 * Decoded byte length of a base64 data URL, computed from the payload's length rather than by
 * decoding it: the point is to reject an oversize image *before* materializing it as a Buffer.
 * Whitespace and padding are discounted, so the result is the file's real size.
 */
function dataUrlByteLength(dataUrl: string): number {
  // Padding and whitespace carry no bytes; every 4 remaining characters carry 3. Same arithmetic
  // the composer uses to size a recalled attachment's chip (chat-input.tsx dataUrlBytes).
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1).replace(/[=\s]+/g, "");
  return Math.floor((payload.length * 3) / 4);
}

/**
 * Resolve a scratchpad file name to an absolute path inside `dir`, or null when it could point
 * anywhere else (the caller turns that into the same 404 a missing file gets, so a probe learns
 * nothing either way).
 *
 * A character whitelist is deliberately NOT the guard: an attachment keeps the name the user
 * gave it, `报告.pdf` included, so the check is structural instead — no separators, no control
 * characters, not a relative marker — and then *confirmed* by resolving the path and requiring
 * its parent to be this session's directory exactly. That last step is what actually contains
 * the read: it also rejects the shapes a character class misses, such as a Windows
 * drive-relative `C:evil.png`.
 */
function resolveScratchpadFile(dir: string, fileName: string): string | null {
  if (!fileName || fileName === "." || fileName === "..") return null;
  for (const ch of fileName) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f || ch === "/" || ch === "\\") return null;
  }
  const resolved = path.resolve(dir, fileName);
  return path.dirname(resolved) === path.resolve(dir) ? resolved : null;
}

/**
 * A validated Prompt: the message parts that go straight into the run, plus the file
 * attachments, which still have to be written to disk (see attachFilesToInput). Kept apart
 * because validation stays synchronous and side-effect free — nothing touches the filesystem
 * until the request is known to be good, and goal mode can reject files before any bytes land.
 */
interface ParsedTaskInput {
  messages: OmniMessage[];
  attachments: TaskAttachment[];
  /** The `text` parts in order, as submitted — the recall store's text (pre-attachment-lines). */
  texts: string[];
  /** The `image_url` parts in order, as submitted — the recall store's images. */
  images: string[];
}

/** Validate Prompt input parts: text, image (data: / http(s) URL), or an uploaded file. */
function parseTaskInput(body: Record<string, unknown>, limits: AttachmentLimits): ParsedTaskInput {
  const input = body.input;
  if (!Array.isArray(input) || input.length === 0) {
    throw badRequest("input must be an array with at least one item.");
  }
  const messages: OmniMessage[] = [];
  const attachments: TaskAttachment[] = [];
  const texts: string[] = [];
  const images: string[] = [];
  input.forEach((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`input[${i}] must be an object.`);
    }
    const part = item as Record<string, unknown>;
    if (part.type === "text") {
      if (typeof part.text !== "string" || part.text.length === 0) {
        throw badRequest(`input[${i}].text must be a non-empty string.`);
      }
      messages.push(userText(part.text));
      texts.push(part.text);
      return;
    }
    if (part.type === "image_url") {
      const url = requireImageUrl(part.imageUrl, `input[${i}].imageUrl`);
      messages.push(imageUrlMessage(url));
      images.push(url);
      return;
    }
    if (part.type === "file") {
      // Not an OmniMessage of its own: the file becomes an `[attached file: …]` line on the
      // text message once written to the scratchpad, so it carries no payload into the run.
      attachments.push(parseAttachmentPart(part, i, limits));
      // Per-request count / total-bytes caps, re-checked on every part so a hostile `input`
      // is cut off at the item that crosses the line (see assertAttachmentBudget).
      assertAttachmentBudget(attachments, limits);
      return;
    }
    throw badRequest(`input[${i}].type must be one of text / image_url / file.`);
  });
  return { messages, attachments, texts, images };
}

/**
 * The recall store of a queued message (see session-manager RecallStore): the submitted
 * content plus where each attachment landed on disk, zipped from the validated parts and
 * `attachFilesToInput`'s written paths (same order — the writes are sequential).
 */
function recallStore(
  text: string,
  images: string[],
  attachments: TaskAttachment[],
  written: string[],
): RecallStore {
  return {
    text,
    images,
    files: written.map((p, i) => ({
      fileName: attachments[i]!.fileName,
      path: p,
      mime: attachments[i]!.mime,
    })),
  };
}

/**
 * Serve one recall (#287): read the withdrawn message's file attachments back into data URLs,
 * delete their scratchpad copies (nothing references them anymore — leaving them would strand
 * a second copy when the user resends), and hand the composer-shaped content back.
 */
async function recalledResponse(
  recall: RecallStore,
  thinkingLevel?: ThinkingLevelName,
): Promise<RecalledMessageResponse> {
  const files = await readRecalledFiles(recall.files);
  await removeAttachments(recall.files.map((f) => f.path));
  return {
    text: recall.text,
    images: recall.images,
    files,
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
  };
}

/**
 * Validate the optional `images` field of a steer request: a list of `data:` / http(s) URLs
 * (same rule as a task input's `imageUrl`), absent or empty = a text-only steering message.
 */
function parseSteerImages(body: Record<string, unknown>): string[] {
  const images = body.images;
  if (images === undefined) return [];
  if (!Array.isArray(images)) throw badRequest("images must be an array.");
  return images.map((url, i) => requireImageUrl(url, `images[${i}]`));
}

/**
 * Validate the optional `files` field of a steer request: the same shape and caps as a task
 * input's `{type:"file"}` parts (parseAttachmentPart, budget re-checked per item), absent or
 * empty = no attachments.
 */
function parseSteerFiles(
  body: Record<string, unknown>,
  limits: AttachmentLimits,
): TaskAttachment[] {
  const files = body.files;
  if (files === undefined) return [];
  if (!Array.isArray(files)) throw badRequest("files must be an array.");
  const attachments: TaskAttachment[] = [];
  files.forEach((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`files[${i}] must be an object.`);
    }
    attachments.push(parseAttachmentPart(item as Record<string, unknown>, i, limits, "files"));
    assertAttachmentBudget(attachments, limits);
  });
  return attachments;
}

/**
 * Validate the optional `goal` field of a task request: absent = a regular task (null);
 * present = goal mode with a token budget (a positive integer, or -1/omitted = unlimited).
 * The input text is the objective — skills ride the text itself as a `[use_skills]` block,
 * exactly like a regular task's message.
 */
function parseGoalField(body: Record<string, unknown>): { budget: number } | null {
  const goal = body.goal;
  if (goal === undefined) return null;
  if (goal === null || typeof goal !== "object" || Array.isArray(goal)) {
    throw badRequest("goal must be an object.");
  }
  const budget = (goal as Record<string, unknown>).budget;
  if (
    budget !== undefined &&
    (typeof budget !== "number" || !Number.isInteger(budget) || (budget <= 0 && budget !== -1))
  ) {
    throw badRequest("goal.budget must be a positive integer, or -1 for unlimited.");
  }
  return { budget: (budget as number | undefined) ?? -1 };
}

/** Agent-level entry: /api/projects/:p/agents/:a/sessions. */
export function agentSessionsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // `cli=1` widens the list to CLI-created Sessions (Trace-directory discovery + adoption);
  // the default serves web rows straight from the DB (see SessionService.listSessions).
  app.get("/", async (c) => {
    // Id validity is checked before any path is constructed: guards against agentId path traversal across Projects.
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    // Optional paging (absent = full list, the pre-paging contract): the sidebar requests
    // limit+1 and shows limit, detecting "has more" without a response-envelope change.
    const paging = optionalPagingQuery(c);
    // Optional category filter (paging then applies within the category) and per-category
    // totals — the sidebar loads active rows only and labels the collapsed folders from counts.
    const rawCategory = c.req.query("category");
    if (rawCategory !== undefined && !SESSION_CATEGORIES.includes(rawCategory as SessionCategory)) {
      throw badRequest(`category must be one of ${SESSION_CATEGORIES.join(" / ")}.`);
    }
    // Optional Workspace-group filter (applied with the category, before paging): a
    // sidebar grouped by Workspace pages each group down its own stream, so one group's
    // "load more" cannot consume the page a sibling was about to read.
    const rawWorkspaceGroup = c.req.query("workspaceGroup");
    if (rawWorkspaceGroup !== undefined && rawWorkspaceGroup.trim() === "") {
      throw badRequest("workspaceGroup must not be empty.");
    }
    const rawCounts = c.req.query("counts");
    if (rawCounts !== undefined && rawCounts !== "1") throw badRequest("counts only accepts 1.");
    const rawCli = c.req.query("cli");
    if (rawCli !== undefined && rawCli !== "1") throw badRequest("cli only accepts 1.");
    const { sessions, counts, workspaceCounts } = await deps.sessionService.listSessions(
      projectId,
      agentId,
      {
        ...(paging ? { paging } : {}),
        ...(rawCategory !== undefined ? { category: rawCategory as SessionCategory } : {}),
        ...(rawWorkspaceGroup !== undefined ? { workspaceGroup: rawWorkspaceGroup } : {}),
        ...(rawCounts !== undefined ? { withCounts: true } : {}),
        ...(rawCli !== undefined ? { includeCli: true } : {}),
      },
    );
    return c.json({
      sessions,
      ...(counts ? { counts } : {}),
      ...(workspaceCounts ? { workspaceCounts } : {}),
    } satisfies SessionsResponse);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const modelId = optionalString(body, "modelId", { minLen: 1, label: "modelId" });
    const provider = optionalString(body, "provider", { minLen: 1, label: "provider" });
    // Model reference is submitted as a pair — both or neither. Neither half is ever
    // inferred from the other, so half a reference is rejected here instead of being
    // resolved (core does the same validation; this catches it early). Omitting both
    // falls back to the Project's default model.
    if ((modelId === undefined) !== (provider === undefined)) {
      throw badRequest(
        "modelId and provider must be given together as a model reference pair: specify both, or neither to use the Project's default model.",
      );
    }
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    let workspace = optionalString(body, "workspace", { minLen: 1, label: "workspace" });
    if (workspace !== undefined) {
      // An explicitly specified Workspace must be an existing directory (never auto-created); reachability is determined by file permissions.
      workspace = await assertWorkspaceAllowed({ workspace });
    }
    const session = await deps.sessionService.createSession({
      projectId,
      agentId,
      ...(modelId !== undefined ? { modelId } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(approvalMode !== undefined ? { approvalMode } : {}),
    });
    return c.json({ session } satisfies SessionCreateResponse, 201);
  });

  return app;
}

/** Session-level entry point: /api/sessions/:sessionId/*. */
export function sessionsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Look up ownership and check access (404 if the index has no such Session, or access is denied — never leaking existence). */
  const resolveSession = (c: Context<AppEnv>): SessionRow => {
    const sessionId = c.req.param("sessionId");
    const row = sessionId ? deps.sessionsRepo.findById(sessionId) : null;
    if (!row) {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    try {
      deps.projectService.requireProjectAccess(c.var.user.userId, row.projectId);
    } catch {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    return row;
  };

  app.get("/:sessionId", async (c) => {
    const row = resolveSession(c);
    const hasTrace = await deps.sessionService.hasTrace(row);
    const info = await deps.sessionService.toInfo(row, hasTrace);
    // Single-session GET only: the latest Trace file's absolute path (a directory walk per
    // call — too costly for list rows). The web's /model switch hands it to the new session's
    // [model_switch_from] block so the model can read the source history itself.
    const tracePath = hasTrace ? await deps.sessionService.latestTracePath(row) : undefined;
    return c.json({
      session: { ...info, ...(tracePath !== undefined ? { tracePath } : {}) },
    } satisfies SessionResponse);
  });

  app.patch("/:sessionId", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const approvalMode = optionalEnum(body, "approvalMode", APPROVAL_MODES);
    const thinkingLevel = optionalEnum(body, "thinkingLevel", THINKING_LEVELS);
    const archivedRaw = (body as Record<string, unknown>).archived;
    const archived = typeof archivedRaw === "boolean" ? archivedRaw : undefined;
    const titleRaw = (body as Record<string, unknown>).title;
    let title: string | undefined;
    if (titleRaw !== undefined) {
      if (typeof titleRaw !== "string") {
        throw new HttpError(400, "invalid_title", "title must be a string.");
      }
      title = titleRaw.trim();
      if (!title || title.length > SESSION_TITLE_MAX) {
        throw new HttpError(
          400,
          "invalid_title",
          `title must be 1–${SESSION_TITLE_MAX} characters.`,
        );
      }
    }
    if (
      approvalMode === undefined &&
      thinkingLevel === undefined &&
      archived === undefined &&
      title === undefined
    ) {
      throw new HttpError(
        400,
        "no_update",
        "No updatable field provided (approvalMode / thinkingLevel / archived / title).",
      );
    }
    let updated: SessionRow = { ...row };
    if (title !== undefined) {
      // Manual renaming takes priority over auto-generation: TitleGenerator only ever replaces the fallback title it wrote itself, never a manual rename.
      deps.sessionsRepo.updateTitle(row.sessionId, title);
      updated = { ...updated, title };
    }
    if (approvalMode !== undefined) {
      // Takes effect immediately: a running approve callback re-reads the DB on every decision.
      deps.sessionsRepo.updateApprovalMode(row.sessionId, approvalMode);
      updated = { ...updated, approvalMode };
    }
    if (thinkingLevel !== undefined) {
      // Takes effect from the next run on: launchTask/startGoal read the pinned level for
      // any run that carries none of its own (a run already in flight keeps its level).
      deps.sessionsRepo.updateThinkingLevel(row.sessionId, thinkingLevel);
      updated = { ...updated, thinkingLevel };
    }
    if (archived !== undefined) {
      const at = archived ? new Date().toISOString() : null;
      deps.sessionsRepo.setArchived(row.sessionId, at);
      updated = { ...updated, archivedAt: at };
    }
    const hasTrace = await deps.sessionService.hasTrace(updated);
    // Re-read after the writes (and after the awaits above): a run finishing anywhere in
    // this window advances last_active_at, and `updated` is a snapshot taken before the
    // PATCH even started. Returning it would hand back a REGRESSED value that the web
    // store swaps in wholesale, rolling the row backwards with no event to repair it.
    // Falls back to the snapshot if the Session was deleted meanwhile.
    const fresh = deps.sessionsRepo.findById(row.sessionId) ?? updated;
    return c.json({
      session: await deps.sessionService.toInfo(fresh, hasTrace),
    } satisfies SessionResponse);
  });

  app.post("/:sessionId/fork", async (c) => {
    const row = resolveSession(c);
    const body = (await readJson(c)) as Record<string, unknown>;
    const raw = body.position;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw badRequest("position must be a Trace position object.");
    }
    const { fileIndex, ordinal } = raw as Record<string, unknown>;
    if (
      !Number.isSafeInteger(fileIndex) ||
      (fileIndex as number) < 1 ||
      !Number.isSafeInteger(ordinal) ||
      (ordinal as number) < 0
    ) {
      throw badRequest("position.fileIndex must be positive and position.ordinal non-negative.");
    }

    const fork = await deps.manager.atIdleBoundary(row.sessionId, () =>
      deps.traceService.forkSessionTrace(row.projectId, row.agentId, row.sessionId, {
        fileIndex: fileIndex as number,
        ordinal: ordinal as number,
      }),
    );
    const forkRow: SessionRow = {
      sessionId: fork.sessionId,
      projectId: row.projectId,
      agentId: row.agentId,
      provider: row.provider,
      modelId: row.modelId,
      workspace: row.workspace,
      approvalMode: row.approvalMode,
      // insertFork replaces this with the source's current title plus its persistent number.
      title: null,
      client: "web",
      hasTrace: true,
      lastActiveAt: fork.createdAt,
      createdAt: fork.createdAt,
    };
    try {
      const insertedForkRow = deps.sessionsRepo.insertFork(row.sessionId, forkRow);
      deps.sessionSources.set(fork.sessionId, null);
      return c.json(
        {
          session: await deps.sessionService.toInfo(insertedForkRow, true),
        } satisfies SessionForkResponse,
        201,
      );
    } catch (err) {
      // insertFork commits before response shaping. If a later step fails (for example,
      // resolving SessionInfo), remove that committed row along with the cloned files so
      // the index cannot retain a Session whose Trace was rolled back.
      deps.sessionsRepo.deleteById(fork.sessionId);
      await deps.traceService.deleteSessionTraces(row.projectId, row.agentId, fork.sessionId);
      await fs.rm(
        path.join(scratchpadDir(deps.config.root, row.projectId, row.agentId), fork.sessionId),
        { recursive: true, force: true },
      );
      throw err;
    }
  });

  app.delete("/:sessionId", async (c) => {
    const row = resolveSession(c);
    // Mark as being deleted and converge active runs (beginSessionDeletion): new
    // Tasks/compactions are always rejected with 409 during this window
    // (assertSessionNotDeleting), preventing the race where a new task recreates the
    // entry and Trace after abort but before the files are deleted, reviving an
    // already-deleted Session. Interrupt cleanup writes the Trace asynchronously, so we
    // wait for it to finish (≤5s cap) before deleting the files and index row; the
    // being-deleted marker is cleared once deletion finishes (success or failure).
    const runnings = deps.manager.beginSessionDeletion(row.sessionId);
    try {
      if (runnings.length > 0) {
        await Promise.race([
          Promise.allSettled(runnings).then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 5000).unref?.()),
        ]);
      }
      await deps.traceService.deleteSessionTraces(row.projectId, row.agentId, row.sessionId);
      // The session-level scratchpad (model temp files + input images saved to disk for image-unsupported models) is deleted along with the session.
      await fs.rm(
        path.join(scratchpadDir(deps.config.root, row.projectId, row.agentId), row.sessionId),
        { recursive: true, force: true },
      );
      deps.sessionsRepo.deleteById(row.sessionId);
      deps.goalsRepo.deleteBySession(row.sessionId);
      // A bound Session takes its Feishu binding with it: close the long connection and
      // drop the row (no-op when unbound; bulk Agent/Project deletes are reconciled by
      // the bridge's next start()).
      deps.feishu.unbind(row.sessionId);
      // Drop the derived-origin entry along with the Session (bulk Agent/Project deletion
      // may leave stale entries; session ids are never reused, so they are never matched).
      deps.sessionSources.delete(row.sessionId);
    } finally {
      deps.manager.endSessionDeletion(row.sessionId);
    }
    return c.body(null, 204);
  });

  // Session scratchpad files (input images saved to disk for image-unsupported models, the
  // composer's file attachments, model-generated temp files): read by filename, so the
  // conversation UI can render a message's "[attached image: <path>]" attachment line back
  // into an image. Restricted to this session's own scratchpad directory (see
  // resolveScratchpadFile); a name is never reused for different bytes — uploads take a random
  // suffix on collision — so the response is marked immutable and long-cacheable.
  app.get("/:sessionId/scratchpad/:fileName", async (c) => {
    const row = resolveSession(c);
    const fileName = c.req.param("fileName") ?? "";
    const filePath = resolveScratchpadFile(
      path.join(scratchpadDir(deps.config.root, row.projectId, row.agentId), row.sessionId),
      fileName,
    );
    if (!filePath) throw new HttpError(404, "file_not_found", "File does not exist.");
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch {
      throw new HttpError(404, "file_not_found", "File does not exist.");
    }
    // SECURITY BOUNDARY — do not extend casually. This map is an allowlist of types that are
    // safe to hand a browser inline from the App's own origin, and it is the only reason the
    // bytes below (arbitrary user uploads and Agent-written temp files) cannot become stored
    // XSS. Every image type here is inert when rendered. Adding `.svg`, `.html`, `.pdf` or
    // anything else that a browser parses as a document would look like a one-line convenience
    // and would immediately be same-origin script execution — such a type needs the treatment
    // the Workspace read gives it (plain-text downgrade or a sandbox CSP), not a map entry.
    const MIME_BY_EXT: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    const mime = MIME_BY_EXT[path.extname(fileName).toLowerCase()];
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": mime ?? "application/octet-stream",
      // nosniff: the composer's file attachments land in this same directory, so the bytes
      // here are arbitrary user content served from the App's own origin — without it a
      // browser could sniff an `application/octet-stream` upload back into HTML and run it
      // same-origin (the same defense workspace file reads apply).
      "x-content-type-options": "nosniff",
      // Second, independent layer for everything that fell off the allowlist: the only reason
      // this endpoint is fetched inline is the conversation's <img> tags, so anything that is
      // not one of those images is served as a download and never renders as a document —
      // nosniff alone would be the whole defense otherwise.
      ...(mime === undefined
        ? {
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          }
        : {}),
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  app.get("/:sessionId/messages", async (c) => {
    const row = resolveSession(c);
    const page = messagesPageQuery(c);
    // Live tail (running/compacting sessions only): capture the channel cursor and the
    // open-fragment snapshot together, synchronously — no await between the two, and both
    // BEFORE the trace read starts. That ordering is what makes the client contract safe
    // (see MessagesLiveTail in api/types.ts): every published event with id <= cursor is
    // already reflected in `fragments`, and partial_* messages never reach the Trace, so
    // the client may drop its buffered partials at/or before the cursor and seed from
    // `fragments` without loss or duplication. Complete messages are never dropped by the
    // cursor — the client's overlap dedup against `messages` decides for them — so a
    // complete message whose trace append is still in flight when the read starts is not
    // lost either.
    //
    // Windowed reads keep the same contract on TAIL pages only: a tail page ends at the
    // transcript's live edge, so the attachment's semantics are identical. A `before`
    // page is immutable history — attaching in-flight fragments to it would seed them at
    // the wrong position — so it never carries `live`.
    let live: MessagesLiveTail | undefined;
    let pendingInputs: OmniMessage[] = [];
    if (page?.kind !== "before") {
      if (deps.manager.statusOf(row.sessionId) !== "idle") {
        live = {
          cursor: deps.channels.get(row.sessionId).lastEventId,
          fragments: deps.manager.liveFragments(row.sessionId),
        };
      }
      // The Task's inputs (published at launch) and its streamed bootstrap records
      // (mcp_connect pair / tool_list_ready): the engine's Trace writes for both land
      // only after the first run's connect, so a client rebuilding during that window
      // would otherwise see neither its own message nor the connecting status — a
      // silent blank while a slow MCP server times out. Appended below when the trace
      // read hasn't caught up; `before` pages are immutable history and never carry
      // them (same rule as `live`). NOT gated on running: a run aborted mid-bootstrap
      // wrote nothing to the Trace, and its held input is the only copy a reload can
      // show until the next run persists it (the holds survive idle for exactly that
      // case — see the manager's request_begin clear).
      pendingInputs = [
        ...deps.manager.pendingInputs(row.sessionId),
        ...deps.manager.pendingBootstrap(row.sessionId),
      ];
    }
    if (page !== null) {
      const result = await deps.traceService.readMessagesPage(
        row.projectId,
        row.agentId,
        row.sessionId,
        page,
      );
      const info: MessagesPageInfo = {
        ...(result.before !== undefined ? { before: result.before } : {}),
        earlierTurns: result.prior.turns,
        prior: {
          subagentTokens: result.prior.subagentTokens,
          elapsedMs: result.prior.elapsedMs,
          sessionTokens: result.prior.sessionTokens,
          contextTokens: result.prior.contextTokens,
        },
      };
      return c.json({
        messages: appendPendingInputs(result.messages, pendingInputs),
        ...(live !== undefined ? { live } : {}),
        page: info,
      } satisfies MessagesResponse);
    }
    const messages = await deps.traceService.readMessages(
      row.projectId,
      row.agentId,
      row.sessionId,
    );
    return c.json({
      messages: appendPendingInputs(messages, pendingInputs),
      ...(live !== undefined ? { live } : {}),
    } satisfies MessagesResponse);
  });

  app.get("/:sessionId/stream", (c) => {
    const row = resolveSession(c);
    const channel = deps.channels.get(row.sessionId);
    // The first event of every new subscription (including reconnects and resync
    // rebuilds) is always a snapshot of the current running state — the frontend treats
    // this as authoritative, eliminating input-area lockup or premature Task closure
    // caused by a stale running/idle in the list; followed by replaying all still-pending
    // approval requests.
    const pendingSteering = deps.manager.pendingSteeringOf(row.sessionId);
    const pendingFollowUps = deps.manager.pendingFollowUpsOf(row.sessionId);
    const subagents = deps.manager.subagentsOf(row.sessionId);
    const initialEvents: ServerEvent[] = [
      {
        type: "task_state",
        state: deps.manager.statusOf(row.sessionId),
        queued: deps.manager.pendingFollowUpCount(row.sessionId),
        // Undelivered steering, queued follow-ups and live subagent children ride the
        // snapshot too, so the composer's queued hints and the panel's running marks
        // survive a reload.
        ...(pendingSteering.length > 0 ? { pendingSteering } : {}),
        ...(pendingFollowUps.length > 0 ? { pendingFollowUps } : {}),
        ...(subagents.length > 0 ? { subagents } : {}),
      },
      ...deps.manager.pendingApprovals(row.sessionId).map((p) => ({
        type: "approval_request" as const,
        toolCall: p.toolCall,
        ...(p.origin !== undefined ? { origin: p.origin } : {}),
      })),
    ];
    return sseEndpoint(c, channel, { initialEvents });
  });

  app.post("/:sessionId/tasks", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const goal = parseGoalField(body);
    // Per-turn thinking level (optional): validated against the level names; omitted follows
    // the session's default. In goal mode it rides every round of the goal; a queued
    // follow-up keeps its level for its auto-start.
    const thinkingLevel = optionalEnum(body, "thinkingLevel", THINKING_LEVELS);
    // Resolved per request from the admin settings, so a limit change applies to the very next
    // upload rather than at the next restart.
    const limits = toAttachmentLimits(deps.serverSettingsRepo.getAttachmentLimitsMb());
    if (goal) {
      // Goal mode: the input needs non-empty text, since its marker-stripped text becomes the
      // objective that every round re-injects and an image on its own doesn't say what the
      // goal is. Images can come along — core folds them into `[attached image: <path>]` lines
      // inside the objective (whatever the model's vision) so they survive the rounds. File
      // attachments cannot: nothing folds them into the objective, so they are turned away
      // here, before any upload is written to disk.
      const { messages, attachments } = parseTaskInput(body, limits);
      const text = messages
        .filter((m) => (m.payload as { type?: string }).type === "text")
        .map((m) => (m.payload as { text: string }).text)
        .join("\n")
        .trim();
      if (!text) {
        throw badRequest("goal mode requires a non-empty text objective.");
      }
      if (attachments.length > 0) {
        throw badRequest("goal mode accepts text and images only (no file attachments).");
      }
      const { sessionId } = await deps.manager.startGoal(row.sessionId, {
        input: messages,
        budget: goal.budget,
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      });
      return c.json({ sessionId } satisfies TaskCreateResponse, 202);
    }
    const parsed = parseTaskInput(body, limits);
    // Follow-up queue: with queueIfBusy, a busy session enqueues the input instead of 409
    // (auto-starts as an ordinary next task once idle; the response says which happened).
    const queueIfBusy = body.queueIfBusy === true;
    // Advisory pre-check, so the overwhelmingly common rejection — sending while a Task is
    // running, without queueIfBusy — never writes bytes it would then have to take back. The
    // authoritative check still runs under the Session lock inside startTask; this one is
    // lock-free and may pass on a race, which the cleanup below covers.
    deps.manager.assertCanAcceptTask(row.sessionId, { queueIfBusy });
    // File attachments land in this Session's scratchpad (deleted along with the Session) and
    // are handed to the model as `[attached file: <path>]` lines on the message text. Written
    // even when the task ends up queued as a follow-up: the queued input must be complete, and
    // the queue is drained by this same Session. A Trace-less Session that self-heals into a
    // new id below keeps its files under the id they were written with — the paths in the
    // message stay valid; only the delete-with-the-Session cleanup misses them in that case.
    const { input, written } = await attachFilesToInput(
      parsed.messages,
      parsed.attachments,
      scratchpadDir(deps.config.root, row.projectId, row.agentId),
      row.sessionId,
    );
    try {
      // 202: the Task executes on the server, decoupled from the SSE connection; sessionId is the current actual id (the new id after self-heal).
      const { sessionId, queued } = await deps.manager.startTask(row.sessionId, input, {
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        queueIfBusy,
        // Original content, kept while the input waits in the follow-up queue so a recall
        // (DELETE /follow-ups/:id) can hand it back; unused when the task starts directly.
        recall: recallStore(parsed.texts.join("\n"), parsed.images, parsed.attachments, written),
      });
      return c.json({ sessionId, queued } satisfies TaskCreateResponse, 202);
    } catch (err) {
      // The Task never started, so nothing references these files and nothing will ever clean
      // them up — and the Web keeps the chips on failure, so the user's retry would otherwise
      // land a second copy of every one of them.
      await removeAttachments(written);
      throw err;
    }
  });

  // Mid-run steering: queue a user message for the running Task; core delivers it between
  // turns as a standalone `[user_steering]` user message, with any images following it as
  // user image messages (the model sees the whole thing without the loop being interrupted).
  // 409 not_running when no Task is in progress — the frontend then falls back to a normal
  // task POST.
  app.post("/:sessionId/steer", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const images = parseSteerImages(body);
    const files = parseSteerFiles(
      body,
      toAttachmentLimits(deps.serverSettingsRepo.getAttachmentLimitsMb()),
    );
    // Any part can carry the message on its own: an image or a file with no caption is a
    // complete steering message, and so is plain text.
    if (!text && images.length === 0 && files.length === 0) {
      throw badRequest("text, images or files must carry the steering message.");
    }
    // The wire shape becomes core's: a user text message (omitted when the images are the
    // whole message, so the fold's path lines aren't preceded by a blank one) plus one image
    // message each — the same input a normal task would carry. File attachments land in the
    // Session scratchpad exactly as a task's do and ride as `[attached file: <path>]` lines
    // on the steering text (a files-only input becomes a line-only text message).
    const { input, written } = await attachFilesToInput(
      [...(text ? [userText(text)] : []), ...images.map((url) => imageUrlMessage(url))],
      files,
      scratchpadDir(deps.config.root, row.projectId, row.agentId),
      row.sessionId,
    );
    try {
      deps.manager.steer(row.sessionId, input, recallStore(text, images, files, written));
    } catch (err) {
      // 409 (not running) or any other refusal: the files must not stay behind — the
      // frontend falls back to a normal task POST, which writes its own copies.
      await removeAttachments(written);
      throw err;
    }
    return c.body(null, 202);
  });

  // Recall an undelivered steering message back to the composer (#287): withdraws it from
  // the queue and returns its original content for editing and resending. 409 not_pending
  // once it was delivered to the model (or the id is unknown) — nothing left to take back.
  app.delete("/:sessionId/steer/:steerId", async (c) => {
    const row = resolveSession(c);
    const recall = deps.manager.recallSteering(row.sessionId, pathParam(c, "steerId"));
    return c.json((await recalledResponse(recall)) satisfies RecalledMessageResponse);
  });

  // Panel message to one subagent child of this session (#272): a user input on the child,
  // whatever its state — steering while it runs, a follow-up run while it is idle, a revival
  // (resume-session semantics) when it was released — the same core channel input_subagent
  // uses. The optional thinkingLevel pins only a round this message starts. The parent
  // runtime loads on demand (the same get-or-resume path a task uses). 404 subagent_gone
  // when the child's record does not exist or cannot be revived; 409 subagent_busy when the
  // child cannot take the message right now.
  app.post("/:sessionId/subagents/:childSessionId/message", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw badRequest("text must carry the message.");
    const thinkingLevel = optionalEnum(body, "thinkingLevel", THINKING_LEVELS);
    const outcome = await deps.manager.sendToSubagent(
      row.sessionId,
      pathParam(c, "childSessionId"),
      // The HTTP boundary is where a host's payload becomes OmniMessage — no sender, because
      // a human typed this (the model's own dispatch through input_subagent stamps
      // "parent_agent" on its side).
      [userText(text)],
      thinkingLevel,
    );
    if (outcome === "gone") {
      throw new HttpError(
        404,
        "subagent_gone",
        "This subagent session no longer exists and could not be revived.",
      );
    }
    if (outcome === "busy") {
      throw new HttpError(
        409,
        "subagent_busy",
        "This subagent cannot take a message right now; try again in a moment.",
      );
    }
    return c.json({ outcome } satisfies SubagentMessageResponse);
  });

  // Panel stop for one subagent child (#272): aborts the child's CURRENT run only — the
  // session survives for steering and follow-ups — a subagent session is never destroyed.
  // 202 aborted; 204 when the child is already idle or unknown (both
  // are "nothing left to stop", and the panel treats them alike).
  app.post("/:sessionId/subagents/:childSessionId/abort", (c) => {
    const row = resolveSession(c);
    const aborted = deps.manager.abortSubagentRun(row.sessionId, pathParam(c, "childSessionId"));
    return c.body(null, aborted ? 202 : 204);
  });

  // Recall a queued follow-up task back to the composer (#287): removes it from the queue
  // before it auto-starts and returns its original content (with the thinking level it was
  // queued with). 409 not_pending once it already started (or the id is unknown).
  app.delete("/:sessionId/follow-ups/:followUpId", async (c) => {
    const row = resolveSession(c);
    const { recall, thinkingLevel } = deps.manager.recallFollowUp(
      row.sessionId,
      pathParam(c, "followUpId"),
    );
    return c.json(
      (await recalledResponse(recall, thinkingLevel)) satisfies RecalledMessageResponse,
    );
  });

  // The Session's most recent goal run (for restoring the chat page's goal banner on load).
  app.get("/:sessionId/goal", (c) => {
    const row = resolveSession(c);
    const g = deps.goalsRepo.latestForSession(row.sessionId);
    return c.json({
      goal: g
        ? {
            objective: g.objective,
            status: g.status,
            budget: g.budget,
            used: g.used,
            rounds: g.rounds,
            updatedAt: g.updatedAt,
          }
        : null,
    } satisfies GoalResponse);
  });

  app.post("/:sessionId/approvals/:toolCallId", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const decision = requireEnum(body, "decision", ["allow", "deny"] as const);
    const ok = deps.manager.decideApproval(row.sessionId, pathParam(c, "toolCallId"), decision);
    if (!ok) {
      throw new HttpError(
        404,
        "approval_not_found",
        "Approval does not exist or has already been decided.",
      );
    }
    return c.body(null, 204);
  });

  app.post("/:sessionId/abort", (c) => {
    const row = resolveSession(c);
    const aborted = deps.manager.abortTask(row.sessionId);
    // No Task in progress → 204 no-op; interrupt was triggered → 202 (wrap-up is completed by the SDK's "interrupt cleanup").
    return c.body(null, aborted ? 202 : 204);
  });

  // —— Background processes (the details popover's interactive list) ——

  // Processes the conversation started (exec_commands promoted to background). Served
  // from the ACTIVE runtime only: an evicted or never-loaded session truthfully reports
  // none — the environment that owned them is gone, and resurrecting an entry could only
  // ever produce an empty list anyway.
  app.get("/:sessionId/processes", async (c) => {
    const row = resolveSession(c);
    // Refresh the listen-port probes first, so the first fetch already carries a probed
    // serviceUrl (core bounds each probe with its own timeout and TTL cache).
    await deps.manager.probeProcessServices(row.sessionId);
    const processes = deps.manager.listProcesses(row.sessionId).map((p) => ({
      processId: p.processId,
      pid: p.pid,
      cmd: p.cmd,
      cwd: p.cwd,
      startedAt: new Date(p.startedAt).toISOString(),
      running: p.running,
      ...(p.serviceUrl !== undefined ? { serviceUrl: p.serviceUrl } : {}),
    }));
    return c.json({ processes } satisfies SessionProcessesResponse);
  });

  // Stop one background process (SIGTERM to the whole group, SIGKILL after a grace
  // period). 404 when the id is gone — already exited and reaped, or the runtime was
  // evicted; the UI just refreshes its list either way.
  app.post("/:sessionId/processes/:processId/kill", (c) => {
    const row = resolveSession(c);
    const killed = deps.manager.killProcess(row.sessionId, pathParam(c, "processId"));
    if (!killed) {
      throw new HttpError(
        404,
        "process_not_found",
        "Process does not exist or has already exited.",
      );
    }
    return c.body(null, 204);
  });

  // Remove one EXITED process entry from the list (the per-row delete on "exited" rows).
  // A running process is 409 — stopping it is the kill route's job, so a removal never
  // surprise-signals a live process group; 404 when the id is unknown or the runtime is
  // gone (nothing left to remove either way — the UI just refreshes its list).
  app.delete("/:sessionId/processes/:processId", (c) => {
    const row = resolveSession(c);
    const result = deps.manager.removeProcess(row.sessionId, pathParam(c, "processId"));
    if (result === "running") {
      throw new HttpError(
        409,
        "process_running",
        "Process is still running; stop it instead of removing it.",
      );
    }
    if (result === "not_found") {
      throw new HttpError(
        404,
        "process_not_found",
        "Process does not exist or has already been removed.",
      );
    }
    return c.body(null, 204);
  });

  // "Retry now" on the reconnect countdown: skip the remaining backoff wait and fire the
  // next retry immediately (attempt counter unchanged). Benign either way — 200 with
  // skipped:false when no reconnect wait is in progress, so a timing race (the wait
  // elapsed just before the click) never surfaces as an error.
  app.post("/:sessionId/retry-now", (c) => {
    const row = resolveSession(c);
    const skipped = deps.manager.retryNow(row.sessionId);
    return c.json({ skipped } satisfies RetryNowResponse);
  });

  app.post("/:sessionId/compact", async (c) => {
    const row = resolveSession(c);
    const { sessionId } = await deps.manager.startCompact(row.sessionId);
    return c.json({ sessionId } satisfies TaskCreateResponse, 202);
  });

  // —— Workspace file browsing (Files tab) ——

  app.get("/:sessionId/files", async (c) => {
    const row = resolveSession(c);
    const rel = c.req.query("path") ?? "";
    return c.json(await deps.workspaceFiles.list(row.workspace, rel));
  });

  app.get("/:sessionId/files/content", async (c) => {
    const row = resolveSession(c);
    const rel = c.req.query("path") ?? "";
    const download = c.req.query("download") === "1";
    // Sandboxed top-level preview ("open in a new tab" for html): the document keeps its REAL
    // content type but carries a CSP sandbox WITHOUT allow-same-origin — it renders and runs
    // fully in an opaque origin, so agent-generated markup cannot reach this origin's cookies
    // or API. The request itself still authenticates (top-level GET sends the Lax cookie).
    const preview = !download && c.req.query("preview") === "1";
    const { data, fileName, contentType, scriptable } = await deps.workspaceFiles.read(
      row.workspace,
      rel,
    );
    const disposition = download ? "attachment" : "inline";
    // Same-origin XSS defense: an inline HTML preview is always returned as plain text
    // (Workspace files may be Agent-generated and untrusted); downloads (attachment) keep
    // the real content type, and sandboxed previews keep it under the CSP above. Paired
    // with nosniff to prevent MIME sniffing from undoing this.
    // An SVG is a document AND an image. Downgrading it to text/plain made every <img> in a
    // Markdown preview (and every .svg preview) a broken image, so it keeps its real type —
    // an image never runs the SVG's scripts. What the type does re-open is a DIRECT
    // navigation to this URL, where the browser would render it as a same-origin document:
    // the sandbox CSP closes that (no allow-scripts, no allow-same-origin — opaque origin,
    // no script execution), and CSP sandbox is ignored for a subresource, so the <img> path
    // is unaffected.
    const inertSvg = !download && !preview && scriptable === "svg";
    const effectiveType =
      !download && scriptable === "html" && !preview ? "text/plain; charset=utf-8" : contentType;
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": effectiveType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        // A Workspace file is whatever the Agent last wrote to that path. Letting a browser
        // cache it by URL is how a re-read after a settled turn paints the previous version.
        "Cache-Control": "no-store",
        ...(preview && scriptable
          ? {
              "Content-Security-Policy":
                "sandbox allow-scripts allow-popups allow-modals allow-forms",
            }
          : {}),
        ...(inertSvg ? { "Content-Security-Policy": "sandbox" } : {}),
      },
    });
  });

  // "Open in a new tab" for Workspace HTML: mints a token and redirects to the separate
  // preview origin.
  //
  // A redirect rather than a JSON endpoint the UI fetches, because the alternative is
  // worse on two counts: opening the tab after an await trips popup blockers, and a
  // window opened by script keeps an `opener` handle back to the App — exactly the
  // reference this design exists to deny. A plain link with rel="noopener noreferrer"
  // has neither problem.
  //
  // Minting on GET is safe: a cross-site request can make the browser follow the
  // redirect, but the response is opaque to the initiating page, so no token leaks — and
  // what it would grant is a preview of the victim's own file.
  //
  // With no usable preview origin (the App is reached on something other than a loopback
  // name and PENGUIN_PREVIEW_ORIGIN is unset), this falls back to the sandboxed
  // same-origin preview: the page still renders, but storage and third-party embeds do
  // not. The UI flags that ahead of time via `previewIsolated` on /api/me.
  app.get("/:sessionId/files/preview-redirect", async (c) => {
    const row = resolveSession(c);
    const rel = c.req.query("path") ?? "";
    // Validate existence + containment while the caller is still authenticated, so a bad
    // path fails here rather than as an opaque 404 from the unauthenticated preview origin.
    // A stat, not a read: the file itself is fetched later, on the preview origin — reading
    // it here (up to 50MB) only to discard the bytes would be wasted work on every click.
    const [exists] = await deps.workspaceFiles.statExisting(row.workspace, [rel]);
    if (!exists) throw new HttpError(404, "file_not_found", "File does not exist.");

    const target = resolvePreviewTarget(
      c.req.url,
      c.req.header("host"),
      deps.config.previewOrigin,
      deps.config,
    );
    if (!target) {
      return c.redirect(
        `/api/sessions/${row.sessionId}/files/content?path=${encodeURIComponent(rel)}&preview=1`,
        302,
      );
    }

    const token = deps.previewTokens.sign({
      sessionId: row.sessionId,
      host: target.host,
      expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
    });
    const encoded = rel.split("/").map(encodeURIComponent).join("/");
    return c.redirect(`${target.origin}/preview/${token}/${encoded}`, 302);
  });

  // Bulk existence check (message file cards list only files that actually exist):
  // path-confinement resolution shares the same logic as files/content
  // (WorkspaceFilesService.statExisting reuses resolveRead); out-of-bounds or
  // resolution failures count as not-existing, always 200 — existence itself is the
  // question being answered, and a 4xx would only leak confinement details.
  app.post("/:sessionId/files/stat", async (c) => {
    const row = resolveSession(c);
    const body = await readJson(c);
    const paths = body.paths;
    if (
      !Array.isArray(paths) ||
      paths.length > STAT_MAX_PATHS ||
      !paths.every((p) => typeof p === "string" && p.length <= STAT_MAX_PATH_LEN)
    ) {
      throw badRequest(
        `paths must be an array of strings (≤${STAT_MAX_PATHS} items, each ≤${STAT_MAX_PATH_LEN} characters).`,
      );
    }
    const existing = await deps.workspaceFiles.statExisting(row.workspace, paths as string[]);
    return c.json({ existing } satisfies FilesStatResponse);
  });

  app.put("/:sessionId/files/content", async (c) => {
    const row = resolveSession(c);
    const rel = c.req.query("path") ?? "";
    const body = await readJson(c);
    if (typeof body.dataBase64 !== "string") {
      throw badRequest("dataBase64 must be a base64 string.");
    }
    const data = Buffer.from(body.dataBase64, "base64");
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "file_too_large", "Uploaded file exceeds the 14MB limit.");
    }
    await deps.workspaceFiles.write(row.workspace, rel, data);
    return c.body(null, 204);
  });

  /**
   * What the Session's current model context is made of, and where compaction will fire. Read on
   * demand (the chat page's context ring opens its detail panel with it), not streamed: it
   * re-reads the newest Trace shard on every call, and the figures are a snapshot rather than a
   * live counter.
   */
  app.get("/:sessionId/context", async (c) => {
    const row = resolveSession(c);
    const parts = await deps.traceService.contextBreakdown(
      row.projectId,
      row.agentId,
      row.sessionId,
    );
    return c.json({
      ...parts,
      compactionThreshold: await sessionCompactionThreshold(deps, row),
    } satisfies SessionContextResponse);
  });

  app.get("/:sessionId/traces", async (c) => {
    const row = resolveSession(c);
    const files = await deps.traceService.listTraceFiles(row.projectId, row.agentId, row.sessionId);
    return c.json({ files });
  });

  app.get("/:sessionId/traces/:index", async (c) => {
    const row = resolveSession(c);
    const index = positiveIntParam(c, "index");
    const { offset, limit } = paginationQuery(c);
    return c.json(
      await deps.traceService.readEvents(
        row.projectId,
        row.agentId,
        row.sessionId,
        index,
        offset,
        limit,
      ),
    );
  });

  app.get("/:sessionId/traces/:index/analysis", async (c) => {
    const row = resolveSession(c);
    const index = positiveIntParam(c, "index");
    return c.json(
      await deps.traceService.analyze(row.projectId, row.agentId, row.sessionId, index),
    );
  });

  return app;
}
