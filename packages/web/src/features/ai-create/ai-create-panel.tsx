/**
 * The body of every "Create with AI" surface: who does the work, the prompt box, clickable
 * examples that fill it, and — when the surface appends a fixed instruction tail — a folded
 * preview of the full prompt with a copy button, so a novice sees exactly what is sent and an
 * expert can take it elsewhere. Controlled and embeddable: AiCreateModal wraps it in a dialog, a
 * page may inline it. It sends nothing itself.
 */
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { agentDisplayName } from "../../state/project";
import { CopyButton } from "../../components/ui/copy-button";
import { HelpFold } from "../../components/ui/help-fold";
import { Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { composeAiPrompt } from "./ai-create-prompt";

export interface AiExample {
  key: string;
  label: string;
  /** One muted line under the label. */
  description?: string;
  /** Replaces the draft when the example is clicked. */
  prompt: string;
}

export interface AiCreatePanelProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rendered above everything else — a HelpFold or a short lead. */
  intro?: ReactNode;
  examples: AiExample[];
  /** The surface's fixed instruction tail, joined after the draft (composeAiPrompt) and previewed in the fold. */
  tail?: string;
  agents: readonly AgentSummary[];
  agentId: string | null;
  onAgentChange?: (agentId: string) => void;
  /** Offer a picker beside the "done by" line instead of a fixed agent; needs onAgentChange. */
  allowAgentChoice?: boolean;
  disabled?: boolean;
}

/** Minimum height of the prompt box, in rows; it grows with its content beyond that. */
const MIN_ROWS = 6;

const exampleClass =
  "min-w-0 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-60";
const exampleIdleClass =
  "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/70";
const exampleSelectedClass = "border-gray-900 bg-gray-50 dark:border-gray-200 dark:bg-gray-800";

export function AiCreatePanel({
  value,
  onChange,
  placeholder,
  intro,
  examples,
  tail,
  agents,
  agentId,
  onAgentChange,
  allowAgentChoice,
  disabled,
}: AiCreatePanelProps) {
  const agent = agents.find((a) => a.agentId === agentId) ?? null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The height follows the rendered value — a seeded draft on mount, typing, an example click —
  // measured after the commit, as the composer sizes its own box. The border is added back
  // because scrollHeight measures the content box while the box is sized border-box.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value]);
  const fullPrompt = tail !== undefined && tail.trim() !== "" ? composeAiPrompt(value, tail) : null;
  const picker = allowAgentChoice && onAgentChange !== undefined && agents.length > 0;

  return (
    <div className="space-y-3">
      {intro !== undefined && (
        <div className="text-xs text-gray-500 dark:text-gray-400">{intro}</div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        {agent !== null ? (
          <span>{S.aiCreate.byAgent(agentDisplayName(agent))}</span>
        ) : agents.length === 0 ? (
          <span className={toneInk.attention}>{S.aiCreate.noAgent}</span>
        ) : null}
        {picker && (
          <div className="ml-auto w-44">
            <Select
              size="sm"
              aria-label={S.aiCreate.chooseAgent}
              value={agentId ?? ""}
              disabled={disabled}
              onChange={(e) => onAgentChange(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {agentDisplayName(a)}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <Textarea
        ref={textareaRef}
        rows={MIN_ROWS}
        value={value}
        placeholder={placeholder ?? S.aiCreate.placeholder}
        aria-label={S.aiCreate.promptLabel}
        disabled={disabled}
        className="max-h-[40vh] resize-none"
        onChange={(e) => onChange(e.target.value)}
      />

      {examples.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
            {S.aiCreate.examplesTitle}
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {examples.map((ex) => {
              // Selected while the draft still IS the example; the first edit unselects it.
              const selected = value === ex.prompt;
              return (
                <button
                  key={ex.key}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onChange(ex.prompt)}
                  className={`${exampleClass} ${selected ? exampleSelectedClass : exampleIdleClass}`}
                >
                  <div className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
                    {ex.label}
                  </div>
                  {ex.description !== undefined && (
                    <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {ex.description}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {fullPrompt !== null && (
        <HelpFold title={S.aiCreate.fullPrompt}>
          <div className="relative">
            <pre className="max-h-48 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 pr-8 font-sans text-xs leading-relaxed whitespace-pre-wrap text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              {fullPrompt}
            </pre>
            <div className="absolute top-1.5 right-1.5">
              <CopyButton text={fullPrompt} label={S.aiCreate.copyPrompt} />
            </div>
          </div>
        </HelpFold>
      )}
    </div>
  );
}
