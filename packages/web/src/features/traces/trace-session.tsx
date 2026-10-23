/**
 * The Session section at the top of a Trace file: every field of the file's head record
 * (`session_meta`), where the reader looks first rather than inside round 1's first row.
 *
 * - Model: `provider / model_id`, the context window on the same line.
 * - Source, the Session id (selectable, with the shared copy button), and the Workspace and Agent
 *   State paths, cut to one line each — a cut-off line shows whole on hover.
 * - The thinking level only where an old Trace's meta carries one (current ones record it on each
 *   `request_begin` instead).
 * - The system prompt behind a fold whose toggle names its length; it renders exactly as the
 *   `session_meta` row's body does (SystemPromptBody), so the two never differ.
 *
 * The record is read loosely: a Trace written before a field existed lacks it, and a missing
 * value shows as a dash. The legacy `tools` field of pre-split metas stays unrendered — the
 * toolset is the `tool_list_ready` record.
 */
import { useState } from "react";
import {
  Chevron,
  CopyButton,
  Fold,
  ICON_SIZE,
  KeyValue,
  KeyValueRow,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
  RuledSection,
  Skeleton,
} from "@prismshadow/penguin-ui";
import ReactMarkdown from "react-markdown";
import { S } from "../../lib/strings";
import { humanizeTokens } from "../../lib/format";

/** A recorded string field; anything else (absent, a number where a string belongs) reads as empty. */
function text(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  return typeof v === "string" ? v : "";
}

/** The system prompt rendered as Markdown in its box — the one look the Session section and the `session_meta` row share. */
export function SystemPromptBody({ prompt }: { prompt: string }) {
  return (
    <div className="md-body mt-1.5 max-h-96 overflow-auto rounded bg-gray-100 px-2.5 py-2 text-sm leading-relaxed text-gray-700 dark:bg-gray-800/70 dark:text-gray-300">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
        {prompt}
      </ReactMarkdown>
    </div>
  );
}

/** A path or an id on one line: cut off at the end, whole on hover. */
function OneLine({ children }: { children: string }) {
  return <span className="block truncate">{children || "—"}</span>;
}

export function SessionSection({
  meta,
}: {
  /** The file's `session_meta` payload; null while it is being read, `{}` for a file that opens without one. */
  meta: Record<string, unknown> | null;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  if (meta === null) {
    return (
      <RuledSection level={3} title={S.traces.session}>
        <div role="status" aria-busy="true">
          <span className="sr-only">{S.common.loading}</span>
          <Skeleton className="h-24" />
        </div>
      </RuledSection>
    );
  }
  const provider = text(meta, "provider");
  const modelId = text(meta, "model_id");
  const contextWindow = meta["model_context_window"];
  const legacyLevel = text(meta, "thinking_level");
  const sessionId = text(meta, "session_id");
  const prompt = text(meta, "system_prompt");
  return (
    <RuledSection level={3} title={S.traces.session}>
      <KeyValue size="xs">
        <KeyValueRow label={S.traces.model}>
          {modelId ? `${provider ? `${provider} / ` : ""}${modelId}` : "—"}
          {(typeof contextWindow === "number" ||
            (typeof contextWindow === "string" && contextWindow !== "")) && (
            <span className="text-fg-muted">
              {" · "}
              {S.traces.contextWindow}{" "}
              {typeof contextWindow === "number" ? humanizeTokens(contextWindow) : contextWindow}
            </span>
          )}
        </KeyValueRow>
        <KeyValueRow label={S.traces.source}>{text(meta, "source") || "—"}</KeyValueRow>
        {legacyLevel !== "" && (
          <KeyValueRow label={S.traces.thinkingLevelLabel}>
            {S.chat.thinkingLevelNames[legacyLevel] ?? legacyLevel}
          </KeyValueRow>
        )}
        <KeyValueRow label={S.chat.sessionIdLabel} mono>
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate">{sessionId || "—"}</span>
            {sessionId !== "" && (
              <CopyButton
                text={sessionId}
                label={S.chat.copySessionId}
                size="sm"
                className="shrink-0"
              />
            )}
          </span>
        </KeyValueRow>
        <KeyValueRow label={S.traces.workspace} mono>
          <OneLine>{text(meta, "workspace")}</OneLine>
        </KeyValueRow>
        <KeyValueRow label={S.traces.agentState} mono>
          <OneLine>{text(meta, "agent_state")}</OneLine>
        </KeyValueRow>
      </KeyValue>
      {prompt.trim() !== "" && (
        <div className="mt-2">
          <button
            type="button"
            data-slot="prompt-toggle"
            aria-expanded={promptOpen}
            onClick={() => setPromptOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-fg-muted transition-colors duration-150 hover:text-fg"
          >
            <Chevron open={promptOpen} size={ICON_SIZE.chevronDense} className="text-fg-subtle" />
            {S.traces.systemPrompt}
            <span className="font-normal text-fg-subtle">
              {S.traces.promptLength(prompt.length)}
            </span>
          </button>
          <Fold open={promptOpen}>{() => <SystemPromptBody prompt={prompt} />}</Fold>
        </div>
      )}
    </RuledSection>
  );
}
