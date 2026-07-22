/**
 * Chat input area: a unified input card —
 * a multi-line textarea occupies the card's top area (auto-grows; Enter sends, Shift+Enter
 * inserts a newline, image paste supported), with all controls collected onto a **single bottom
 * row** that never shares a line with the text body: attachments + approval mode (saved
 * immediately on change) + help text (to the right of approval mode) | context usage (ring
 * indicator) + Model + send (up arrow);
 * In draft state (Session not yet created), when models/onChangeModel are supplied, the model
 * selector sits to the left of the send button (provider logo + name, popup opens **downward**,
 * with a top quick-search box, an internal scroll cap to avoid overflowing the screen, and a
 * configured-key-first list with a bottom "show all" row — see ModelSelect) — once
 * the Session is created the model is locked, and the same spot switches to a read-only
 * logo + name display;
 * `/` opens the slash command menu (`/compact` compresses context, replacing the button; each
 * installed skill gets its own entry; pressing Enter on `/<skill_name>` toggles that skill's
 * selection without sending). Matching is positional like `@`: a slash opens the menu from any
 * caret position, running a command removes just that token, and Escape only dismisses the menu —
 * the rest of the draft is never touched;
 * `@` opens the agent selection menu; once picked it becomes a fixed highlighted target chip
 * above the text body (only one allowed, picking again replaces it; removed via backspace or the
 * x button); only a leading `@` at the start of the text counts — typing or pasting text starting
 * with `@<agentId>` also works the same way, while an `@` in the middle of the text is just plain
 * text. Sending doesn't use the current Session: it opens a new chat for the target agent instead,
 * and the text body carries no `@` marker;
 * The bottom toolbar provides a searchable multi-select skills dropdown (styled like the model
 * selector: a top search box filtering by name and localized description, plus a checklist;
 * clicking a row toggles its selection without closing the menu; the button = book icon + label +
 * selected-count badge, disabled while running/compacting). With skills selected, sending with an
 * empty text body is allowed — the sent text automatically falls back to S.chat.skillsAutoMessage.
 * When sent, the text body wraps in a `<use_skills>` block (the handoff's rest-of-message body is
 * wrapped the same way); the selection clears once sending succeeds. Quick-invoke pre-selects via
 * initialSkills (read once on mount; once the installed list is ready, names not in that list are
 * pruned); the slash menu also lists installed skills, and pressing Enter on `/<skill_name>`
 * selects it.
 * Switches to a "Stop" button while a Task is running; disabled with a reason shown while
 * compacting.
 * Renders only the card body itself: outer positioning such as bottom-docking or vertical
 * centering is decided by the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";
import type {
  AgentSummary,
  ApprovalMode,
  ModelInfo,
  ModelRefDto,
  SessionStatus,
  SkillMetadataItem,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { humanizeTokens } from "../../lib/format";
import { resolveContextWindow } from "../../lib/context";
import { useLocale } from "../../state/locale";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { SkillIcon } from "../skills/skill-icon-view";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { hasConfiguredKey, sameModelRef, visibleChatModels } from "../models/model-grouping";
import { filterAgents, matchMention, splitLeadingMention } from "./agent-mentions";
import { matchSlash, removeSlashToken } from "./slash-token";
import {
  BOOK_ICON,
  buildSkillsMessage,
  filterSkills,
  localizedShortText,
  skillSlashItems,
} from "./skill-use";

const APPROVAL_MODES: ApprovalMode[] = ["always-ask", "read-only", "allow-all", "deny-all"];

/**
 * Illustrative icon for each approval mode (24x24 line art, grayscale via currentColor, no
 * color-coding): allow-all uses a warning triangle — it permits everything at the user's own
 * risk, the shape hints at it visually without rendering tension through color; deny-all is a
 * no-entry sign, read-only is an eye, always-ask is a question-mark circle.
 */
const APPROVAL_MODE_ICONS: Record<ApprovalMode, string> = {
  "allow-all":
    "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01",
  "deny-all": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.64 5.64l12.72 12.72",
  "read-only":
    "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  "always-ask":
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.07 4h.01",
};

/**
 * Approval mode selector (custom-drawn dropdown, not the browser's native select): small,
 * grayscale.
 * Popup direction depends on context: for the draft card, vertically centered with room below
 * -> opens downward; for the chat input area docked at the bottom of the screen, where opening
 * downward would overflow the viewport with nowhere to scroll -> opens upward.
 */
function ApprovalModeSelect({
  value,
  onChange,
  disabled,
  direction = "up",
}: {
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  disabled: boolean;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass={
        // w-max: width exactly wraps the longest line (no wrapping within a line), avoiding an overly wide panel.
        direction === "down"
          ? "left-0 top-full mt-1 w-max max-w-[calc(100vw-2rem)] origin-top-left"
          : "bottom-full left-0 mb-1 w-max max-w-[calc(100vw-2rem)] origin-bottom-left"
      }
      button={
        // Button styling matches the model selector (h-8 / rounded-md / solid hover background).
        <button
          type="button"
          aria-label={S.chat.approvalMode}
          title={`${S.chat.approvalMode}：${S.chat.approvalModeNames[value] ?? value}`}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          {/* Icon changes with the current mode (allow-all = warning triangle, grayscale, no color-coding) */}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="shrink-0"
          >
            <path d={APPROVAL_MODE_ICONS[value]} />
          </svg>
          {/* Button shows only the description (the mode id is spelled out in the menu); when the card is narrower than @md, only the icon remains (title shows the full name). */}
          <span className="hidden min-w-0 truncate @md:block">
            {S.chat.approvalModeNames[value] ?? value}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            className="shrink-0"
            aria-hidden
          >
            <path
              d="M3 4.5l3 3 3-3"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      }
    >
      {APPROVAL_MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => {
            onChange(m);
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
            m === value
              ? "font-medium text-gray-900 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400"
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="shrink-0 text-gray-400 dark:text-gray-500"
          >
            <path d={APPROVAL_MODE_ICONS[m]} />
          </svg>
          {/* Description first, mode id after (copy in strings); single line, no wrapping, selected checkmark at line end. */}
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
            {S.chat.approvalModes[m] ?? m}
          </span>
          <span className="w-3 shrink-0 text-center">{m === value ? "✓" : ""}</span>
        </button>
      ))}
    </Dropdown>
  );
}

/** Display label for a model: the display name, or falls back to the upstream id (model_id is the raw field, no prefix parsing). */
function modelLabel(m: ModelInfo): string {
  return m.displayName ?? m.modelId;
}

/**
 * "No key" marker for the model dropdown's key-less rows: a key struck through by a prohibition
 * slash (24x24 line art, grayscale via currentColor, matching the approval-mode icon style).
 */
const NO_KEY_ICON =
  "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4M2 2l20 20";

/**
 * Model selector (draft state only; docked to the left of the send button): both the button and
 * candidate items show the provider logo. The menu opens **downward** — the draft card is
 * vertically centered with room below; a top quick-search box (reusing the model page's rule:
 * filters by id / display name / provider name), with the candidate list capped by an internal
 * scroll (max-h-56) so it never overflows the browser's viewport height no matter how many models
 * there are. On narrow screens only the logo remains (name hidden); list items mark the project
 * default.
 * By default only models with a configured API key are listed (stored masked key — the same
 * standard as the model page's key status; `envKey` is merely the NAME of a fallback env var and
 * doesn't count), with the selected and the default model always visible even without a key; a
 * muted bottom row reveals the remaining key-less models (marked by a struck-through key icon,
 * with the "no key" text in its title) without closing the menu or changing the selection. When
 * no model has a key at all, everything is listed directly.
 */
function ModelSelect({
  models,
  value,
  defaultModel,
  onChange,
  disabled,
}: {
  models: ModelInfo[];
  /** Currently selected (provider, modelId) pair; null = not yet chosen. */
  value: ModelRefDto | null;
  defaultModel?: ModelRefDto;
  onChange: (ref: ModelRefDto) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Expanded "show all" state: collapses back to key-configured models on each open.
  const [showAll, setShowAll] = useState(false);
  const current = models.find((m) => sameModelRef(m, value));
  // Display rule matches the model page's card: display name, or falls back to the upstream id (grouping is already conveyed by the provider logo).
  const label = current ? modelLabel(current) : (value?.modelId ?? "…");
  // Dropdown order mirrors the model library page: provider groups in MODEL_PROVIDERS order
  // (user-defined groups after, custom last), in-group order preserved. By default the list
  // keeps only key-configured models (selected/default always included; lists everything when
  // no model has a key); the query filters what's visible.
  const visible = visibleChatModels(models, { showAll, query, selected: value, defaultModel });
  // How many models the key filter hides under the current query (0 when expanded): drives the bottom "show all" row.
  const hiddenCount = showAll
    ? 0
    : visibleChatModels(models, { showAll: true, query, selected: value, defaultModel }).length -
      visible.length;
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="right-0 top-full mt-1 w-max min-w-56 max-w-[calc(100vw-2rem)] origin-top-right"
      button={
        <button
          type="button"
          title={`${S.chat.chooseModel}：${label}`}
          aria-label={S.chat.chooseModel}
          disabled={disabled || models.length === 0}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) {
              // Each open starts from the unsearched, collapsed (configured-only) list.
              setQuery("");
              setShowAll(false);
            }
          }}
          className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <ProviderLogo
            provider={current?.provider ?? value?.provider ?? "custom"}
            className="h-4 w-4 shrink-0"
          />
          {/* When the card is narrower than @md, only the provider logo remains (title shows the full name). */}
          <span className="hidden min-w-0 truncate @md:block">{label}</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            className="shrink-0"
            aria-hidden
          >
            <path
              d="M3 4.5l3 3 3-3"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      }
    >
      {/* Quick search: supports model id / display name / provider name */}
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={S.models.searchPlaceholder}
          aria-label={S.models.searchPlaceholder}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-gray-200 dark:placeholder:text-gray-500"
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {visible.length === 0 && (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.models.noSearchResults}</p>
        )}
        {visible.map((m) => (
          <button
            key={`${m.provider}:${m.modelId}`}
            type="button"
            onClick={() => {
              onChange({ provider: m.provider, modelId: m.modelId });
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
              sameModelRef(m, value)
                ? "font-medium text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <ProviderLogo provider={m.provider} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{modelLabel(m)}</span>
            {/* Key-less rows (visible via show-all / selected / default / no-key-at-all) carry a
                struck-through key icon (the "no key" text lives in the title/aria-label). */}
            {!hasConfiguredKey(m) && (
              <span
                role="img"
                title={S.models.noKey}
                aria-label={S.models.noKey}
                className="shrink-0 text-gray-400 dark:text-gray-500"
              >
                <GlyphIcon d={NO_KEY_ICON} size={13} />
              </span>
            )}
            {sameModelRef(m, defaultModel) && (
              <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                {S.models.default}
              </span>
            )}
            <span className="w-3 shrink-0 text-center text-xs">
              {sameModelRef(m, value) ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>
      {/* Bottom expander row (pinned below the scroll area, mirroring the search box on top):
          reveals the models hidden by the configured-key filter in place — the menu stays open
          and the selection is untouched. */}
      {hiddenCount > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            {S.models.showModelsWithoutKey(hiddenCount)}
          </button>
        </div>
      )}
    </Dropdown>
  );
}

/**
 * Multi-select skills dropdown (bottom toolbar, after approval mode): styled like the model
 * selector — button = book icon + "Skills" label + selected-count badge (no badge at 0; when the
 * card is narrower than @md the label hides, leaving just icon + badge); menu = top search box
 * (filters by name and localized description) + option rows (name in monospace + truncated
 * description + selected checkmark). Multi-select semantics: clicking a row toggles its
 * selection and **the menu stays open**; closes on Escape / click outside (built into Dropdown).
 * Shows empty-state copy when no skills are installed (prompting to add some from the skill
 * library). Popup direction depends on context (same as the approval mode selector).
 */
function SkillSelect({
  skills,
  selected,
  onToggle,
  disabled,
  direction = "up",
}: {
  skills: SkillMetadataItem[];
  selected: string[];
  onToggle: (name: string) => void;
  disabled: boolean;
  direction?: "up" | "down";
}) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = filterSkills(skills, locale, query);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass={
        // As wide as reasonably possible so descriptions stay readable; the viewport clamp
        // keeps it inside phone screens.
        direction === "down"
          ? "left-0 top-full mt-1 w-[26rem] max-w-[calc(100vw-2rem)] origin-top-left"
          : "bottom-full left-0 mb-1 w-[26rem] max-w-[calc(100vw-2rem)] origin-bottom-left"
      }
      button={
        <button
          type="button"
          aria-label={S.chat.skillsSelect}
          title={S.chat.skillsSelect}
          disabled={disabled}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) setQuery(""); // Always start from the full list each time it opens
          }}
          className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d={BOOK_ICON} size={14} className="shrink-0" />
          {/* When the card is narrower than @md, only the icon + badge remain (title shows the full name). */}
          <span className="hidden min-w-0 truncate @md:block">{S.chat.skillsSelect}</span>
          {/* Selected-count badge (the chip row above the input mirrors the selection too). */}
          {selected.length > 0 && (
            <span className="shrink-0 rounded-full bg-gray-200/80 px-1.5 py-px font-mono text-[10px] font-semibold text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">
              {selected.length}
            </span>
          )}
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            className="shrink-0"
            aria-hidden
          >
            <path
              d="M3 4.5l3 3 3-3"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      }
    >
      {/* Quick search: filters by skill name and localized description */}
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={S.chat.skillsSearchPlaceholder}
          aria-label={S.chat.skillsSearchPlaceholder}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-gray-200 dark:placeholder:text-gray-500"
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {skills.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.chat.skillsEmptyHint}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.chat.skillsNoMatch}</p>
        ) : (
          filtered.map((s) => {
            const on = selected.includes(s.name);
            return (
              <button
                key={s.name}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(s.name)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  on
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-600 dark:text-gray-400"
                }`}
              >
                {/* Each skill's custom icon (icon.svg, sanitized and inlined; falls back to the book icon if missing). */}
                <SkillIcon
                  icon={s.icon}
                  size={14}
                  className="shrink-0 text-gray-400 dark:text-gray-500"
                />
                <span className="shrink-0 font-mono">{s.name}</span>
                {/* Prefers the short description (falls back to the full description if missing), per the UI language. */}
                <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-500">
                  {localizedShortText(locale, s)}
                </span>
                <span className="w-3 shrink-0 text-center">{on ? "✓" : ""}</span>
              </button>
            );
          })
        )}
      </div>
    </Dropdown>
  );
}

interface SlashCommand {
  cmd: string;
  desc: string;
  run: () => void;
}

/**
 * Context usage: a **single-color** ring indicator (only conveys total usage, no bucketing) +
 * `used/window` (amber above 80%, red above 95%). When the model has no `context_window`
 * configured, resolveContextWindow falls back to 128000 and the ring is drawn as usual — the
 * usage ratio always has a reference point, instead of degrading into a lone number when config
 * is missing.
 *
 * `unknown` (after a successful compaction, before the next regular Request reports usage): draws
 * an empty ring, value shown as `—`. **Must not be drawn as 0** — that would claim the context
 * has been cleared, while the summary itself still occupies tokens; at this point we simply
 * haven't measured yet, not measured to be zero.
 */
function ContextGauge({
  now,
  window: win,
  unknown = false,
}: {
  now: number;
  window?: number;
  unknown?: boolean;
}) {
  const max = resolveContextWindow(win);
  const pct = unknown ? 0 : Math.min(1, now / max);
  const color =
    unknown || pct <= 0.8
      ? "text-gray-400 dark:text-gray-500"
      : pct > 0.95
        ? "text-red-500"
        : "text-amber-500";
  const R = 5;
  const C = 2 * Math.PI * R;
  return (
    <span
      title={unknown ? S.chat.contextUnknown : `${S.chat.contextUsage} ${Math.round(pct * 100)}%`}
      className={`flex shrink-0 items-center gap-1 font-mono ${color}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="block shrink-0">
        <circle
          cx="7"
          cy="7"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <circle
          cx="7"
          cy="7"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`}
          transform="rotate(-90 7 7)"
        />
      </svg>
      {unknown ? "—" : humanizeTokens(now)}/{humanizeTokens(max)}
    </span>
  );
}

export function ChatInput({
  status,
  onSend,
  onStop,
  onCompact,
  modelRef,
  models,
  onChangeModel,
  defaultModel,
  contextWindow,
  contextNow,
  contextStale = false,
  vision,
  approvalMode,
  onChangeApprovalMode,
  modeSaving,
  autoFocus,
  agents,
  skills,
  initialSkills,
  onSkillsChange,
  onHandoff,
  initialText,
  onTextChange,
  initialHandoffTargetId,
  onHandoffTargetChange,
}: {
  status: SessionStatus;
  /** Returns whether it succeeded: on failure the input draft is kept (not cleared). */
  onSend: (input: TaskInputPart[]) => Promise<boolean>;
  /**
   * Used instead of onSend when an @ target is present (chip or a leading @ typed manually):
   * opens a new chat for the target agent (the text body carries no @ marker, and the current
   * Session receives no message). Returns whether it succeeded (draft kept on failure).
   */
  onHandoff: (target: AgentSummary, input: TaskInputPart[]) => Promise<boolean>;
  onStop: () => Promise<void>;
  onCompact: () => Promise<void>;
  /** Currently selected model reference ((provider, modelId) is the unique key); null = not yet chosen. */
  modelRef: ModelRefDto | null;
  /**
   * Candidate model list: when supplied together with onChangeModel, renders the model selector
   * to the left of the send button (draft state); when only models is supplied (session state),
   * it's used to look up the locked model's display name (read-only display).
   */
  models?: ModelInfo[];
  /** Changes the selected model in draft state; no longer passed once the Session is created and the model is locked. */
  onChangeModel?: (ref: ModelRefDto) => void;
  /** Project default model (marked "default" on the selector's candidate item). */
  defaultModel?: ModelRefDto;
  /** Model's context window (from models config; when not configured, the ring's cap falls back to 128000 via resolveContextWindow). */
  contextWindow?: number;
  /** Current context usage (total of the most recent main-session Request). */
  contextNow: number;
  /** After a successful compaction, before the next regular Request reports usage: usage is **unknown** (not 0); the ring is drawn empty and the value shown as `—`. */
  contextStale?: boolean;
  /** Whether the current model supports image input (models config's vision; assumed supported by default). */
  vision: boolean;
  approvalMode: ApprovalMode;
  onChangeApprovalMode: (mode: ApprovalMode) => void;
  modeSaving: boolean;
  autoFocus?: boolean;
  /** Agent list of the current Project: typing `@` opens the agent selection popup. */
  agents: AgentSummary[];
  /**
   * Skills installed on the current Agent (in session state, fetched by chat-page keyed on the
   * Session's Agent; in draft state, fetched by draft-view keyed on the selected Agent; a failed
   * fetch is treated as no skills): candidates for the bottom toolbar's skills dropdown, and the
   * same source feeds the slash menu's skill command entries. When the Agent changes, the parent
   * clears this first before refetching, and the selection clears along with it (doesn't linger
   * across Agents).
   */
  skills: SkillMetadataItem[];
  /**
   * Initially selected skill names (draft restore; the skill library page's quick-invoke writes
   * this into the draft cache): read once on mount; once the installed list is ready, names not
   * in that list are pruned.
   */
  initialSkills?: string[];
  /** Callback when selected skills change (check/prune; the clear after a successful send does not call back, same as onTextChange). */
  onSkillsChange?: (names: string[]) => void;
  /** Draft's initial text (restored on mount; paired with onTextChange for draft auto-caching). */
  initialText?: string;
  /**
   * Callback when the user edits the text body (including paths that rewrite the text such as @
   * selection / slash clearing); the clear after a successful send does **not** call back — at
   * that point the parent has already cleared the draft cache entirely, and calling back would
   * resurrect it.
   */
  onTextChange?: (text: string) => void;
  /** Draft restore: the agentId of the @ handoff target (resolved once agents are ready; discarded if stale). */
  initialHandoffTargetId?: string;
  /** Callback when the @ handoff target changes (selected/removed; the clear after a successful send does not call back, same as onTextChange). */
  onHandoffTargetChange?: (agentId: string | null) => void;
}) {
  const { locale } = useLocale();
  const [text, setText] = useState(initialText ?? "");
  /** Live text mirror for slash-command run() closures (the commands memo deliberately doesn't depend on text). */
  const textRef = useRef(text);
  textRef.current = text;
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // Slash token start where Escape closed the menu (mirrors mentionDismissed: the menu stays shut for that one token).
  const [slashDismissed, setSlashDismissed] = useState<number | null>(null);
  // Anchor for the popups that open upward, and the room actually available above them.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [upwardMaxH, setUpwardMaxH] = useState<number>();
  // @ handoff target (chip, fixed at the front of the input); only one allowed, picking again replaces it directly.
  const [target, setTarget] = useState<AgentSummary | null>(null);
  // Selected skills (dropdown checklist, multi-select): initial value comes from draft restore (quick-invoke pre-selection), cleared on successful send.
  const [selectedSkills, setSelectedSkills] = useState<string[]>(initialSkills ?? []);
  // @ mention: cursor position (tracked via onChange/onSelect), candidate highlight, and the mention start where Escape closes it.
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Short placeholder on narrow screens: a long hint would wrap and get clipped in a single-line textarea.
  const [narrow] = useState(() => window.matchMedia("(max-width: 767px)").matches);

  const running = status === "running";
  const compacting = status === "compacting";
  // Sending is also allowed with only an @ target (chip) or skills selected and no text: a handoff's
  // first message may be just a <handoff_from> source block; with skills and empty text, the sent
  // text automatically falls back to S.chat.skillsAutoMessage (see send).
  const canSend =
    !running &&
    !compacting &&
    !busy &&
    (text.trim().length > 0 || images.length > 0 || target !== null || selectedSkills.length > 0);

  /** Toggle a skill on/off (shared by dropdown option clicks and the slash skill command); the change callback lets the parent write it into the draft. */
  const toggleSkill = useCallback(
    (name: string) => {
      const next = selectedSkills.includes(name)
        ? selectedSkills.filter((n) => n !== name)
        : [...selectedSkills, name];
      setSelectedSkills(next);
      onSkillsChange?.(next);
    },
    [selectedSkills, onSkillsChange],
  );

  /** The slash token currently under the caret (kept in a ref so command run() closures always remove the live token). */
  const slashMatchRef = useRef<ReturnType<typeof matchSlash>>(null);
  const commands = useMemo<SlashCommand[]>(() => {
    /** Removes just the slash token after a command runs (the rest of the text stays; setText is async: wait for the DOM value to update before measuring height). */
    const clearInput = () => {
      const match = slashMatchRef.current;
      const next = match ? removeSlashToken(textRef.current, match) : "";
      setText(next);
      onTextChange?.(next);
      requestAnimationFrame(autoGrow);
    };
    return [
      {
        cmd: "/compact",
        desc: S.chat.compact,
        run: () => {
          clearInput();
          void onCompact();
        },
      },
      // Each installed skill gets its own entry: `/<skill_name>` toggles that skill's selection (without sending), description follows the UI language.
      ...skillSlashItems(skills, locale).map((s) => ({
        cmd: s.cmd,
        desc: s.desc,
        run: () => {
          clearInput();
          toggleSkill(s.name);
        },
      })),
    ];
  }, [onCompact, onTextChange, skills, locale, toggleSkill]);
  // Positional matching (like @ mentions): a slash opens the menu from any caret position;
  // running a command removes just the token, leaving the rest of the text intact. Doesn't
  // reopen after Escape until the caret sits on a different token.
  const slashTok = !running && !compacting ? matchSlash(text, caret) : null;
  slashMatchRef.current = slashTok;
  const slashMatches =
    slashTok && slashTok.start !== slashDismissed
      ? commands.filter((c) => c.cmd.startsWith(`/${slashTok.query}`))
      : [];
  const slashOpen = slashMatches.length > 0;
  const activeSlash = slashMatches[Math.min(slashIndex, slashMatches.length - 1)];

  // @ subagent menu: the `@prefix` currently being typed at the cursor drives candidate filtering (slash menu takes priority; doesn't reopen after Escape).
  const mention = !running && !compacting && !slashOpen ? matchMention(text, caret) : null;
  const mentionMatches =
    mention && mention.start !== mentionDismissed ? filterAgents(agents, mention.query) : [];
  const mentionOpen = mentionMatches.length > 0;
  const activeMention = mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)];

  // Both menus above are drawn upward (`bottom-full`) from the composer, so their ceiling is
  // whatever ancestor clips overflow — on the draft page that's the centered scroll area, whose
  // top edge sits well below the viewport's. A static `40vh` cap can't know that distance and
  // clipped the first rows on shorter windows, so measure the real gap when a menu opens.
  useEffect(() => {
    if (!slashOpen && !mentionOpen) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      let ceiling = 0;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflowY !== "visible") {
          ceiling = p.getBoundingClientRect().top;
          break;
        }
      }
      // Less the menu's own 6px offset from the composer, plus a little breathing room.
      const room = el.getBoundingClientRect().top - ceiling - 14;
      setUpwardMaxH(Math.max(96, Math.min(320, Math.round(room))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [slashOpen, mentionOpen]);

  /** Auto-grow the textarea (caps at roughly 6 lines, scrolls internally beyond that). */
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  };

  // Correct the height and cursor right on mount: a restored multi-line draft (initialText)
  // would otherwise not expand until the first edit; move the cursor to the end of the draft
  // (by default the browser places the cursor at the start when focusing a textarea that already
  // has content), so typing continues the text naturally, and sync the caret state to match (the
  // @ mention menu filters by cursor position).
  useEffect(() => {
    autoGrow();
    const el = textareaRef.current;
    if (el && el.value.length > 0) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
      el.scrollTop = el.scrollHeight;
      setCaret(end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Installed skills change (Agent switch triggers a refetch: parent clears first, then
  // updates): the selection keeps only skills that are still available — the tick where it's
  // cleared wipes the whole selection, so nothing lingers across Agents. The first tick on mount
  // is skipped: at that point the installed list hasn't been fetched yet (skills is empty), and
  // pruning would wrongly clear initialSkills (quick-invoke pre-selection); prune only once the
  // list is ready for the first time (the parent's clear uses functional setState to preserve
  // reference identity, so an empty-to-empty clear doesn't trigger this effect).
  const skillsPruneReady = useRef(false);
  useEffect(() => {
    if (!skillsPruneReady.current) {
      skillsPruneReady.current = true;
      if (skills.length === 0) return;
    }
    const next = selectedSkills.filter((n) => skills.some((s) => s.name === n));
    if (next.length === selectedSkills.length) return;
    setSelectedSkills(next);
    onSkillsChange?.(next);
  }, [skills, selectedSkills, onSkillsChange]);

  // Restore the cached @ handoff target: resolved once by id when agents becomes ready for
  // the first time (discarded if stale); a chip the user manually removes afterward is not restored again.
  const handoffRestored = useRef(false);
  useEffect(() => {
    if (handoffRestored.current || !initialHandoffTargetId || agents.length === 0) return;
    handoffRestored.current = true;
    const restored = agents.find((a) => a.agentId === initialHandoffTargetId);
    if (restored) setTarget(restored);
  }, [agents, initialHandoffTargetId]);

  /**
   * Select a candidate: set it as the @ target chip (fixed at the front of the input, picking
   * again replaces it), and remove the `@token` that triggered the menu (`mention.start..end`,
   * including any leftover token fragment to the right of the cursor) along with one adjacent
   * space from the text body.
   */
  const insertMention = (agent: AgentSummary) => {
    const el = textareaRef.current;
    if (!mention || !el) return;
    let { start, end } = mention;
    if (el.value[end] === " ") end++;
    else if (start > 0 && el.value[start - 1] === " ") start--;
    const value = el.value.slice(0, start) + el.value.slice(end);
    // Mutate the DOM synchronously before writing back to state (same value on re-render, cursor
    // preserved), avoiding a race between async cursor restoration and the next keystroke.
    el.value = value;
    el.setSelectionRange(start, start);
    el.focus();
    setTarget(agent);
    onHandoffTargetChange?.(agent.agentId);
    setText(value);
    onTextChange?.(value);
    setCaret(start);
    setMentionIndex(0);
    autoGrow();
  };

  const send = async () => {
    if (!canSend) return;
    const t = text.trim();
    // @ target = the chip (selected via menu), or a leading `@<agentId>` typed/pasted manually
    // (an @ in the middle of the text is plain text); with a target present, this becomes a
    // handoff to a new chat, the current Session isn't sent to, and the text carries no @ marker.
    const lead = target ? { agent: target, rest: t } : splitLeadingMention(t, agents);
    // With skills selected and an empty text body: the sent text automatically falls back to a
    // localized invocation sentence generated per the UI language.
    const rest = lead ? lead.rest : t;
    const bodyText =
      selectedSkills.length > 0 && rest === "" ? S.chat.skillsAutoMessage(selectedSkills) : rest;
    // With non-empty selected skills: the text body is replaced with a <use_skills> block + the text (the handoff branch wraps rest the same way).
    const body = buildSkillsMessage(selectedSkills, bodyText);
    const input: TaskInputPart[] = [];
    if (body) input.push({ type: "text", text: body });
    for (const url of images) input.push({ type: "image_url", imageUrl: url });
    setBusy(true);
    try {
      const ok = lead ? await onHandoff(lead.agent, input) : await onSend(input);
      // Only clear the draft after a successful send: on failure (network / conflict / server error) keep the user's input and images.
      if (ok) {
        setText("");
        setImages([]);
        setTarget(null);
        setSelectedSkills([]);
        requestAnimationFrame(autoGrow);
      }
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        activeSlash?.run();
        return;
      }
      if (e.key === "Escape") {
        // Only closes the popup, doesn't clear the input: with positional matching the `/token`
        // is part of the text body like any other word, and wiping a controlled textarea is not
        // undoable with Ctrl+Z. Reopens if the user keeps typing on another token.
        setSlashDismissed(slashTok?.start ?? null);
        return;
      }
    }
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (activeMention) insertMention(activeMention);
        return;
      }
      if (e.key === "Escape") {
        // Only closes the popup, doesn't clear the input (the `@token` is part of the text body), reopens if the user keeps typing.
        setMentionDismissed(mention?.start ?? null);
        return;
      }
    }
    // Backspace at the start of the text: removes the @ target chip (consistent with common chip-input interaction).
    if (
      e.key === "Backspace" &&
      target !== null &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      e.preventDefault();
      setTarget(null);
      onHandoffTargetChange?.(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const addFiles = (files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  return (
    <div className="relative" ref={anchorRef}>
      {/* Slash command menu (triggered by typing /; /compact plus one entry per installed skill).
          Height is capped to the room measured above the composer (see upwardMaxH) with internal
          scrolling, so a long skill list never pushes the menu's top edge out of view; the active
          row keeps itself scrolled into view. */}
      {slashOpen && (
        <div
          style={{ maxHeight: upwardMaxH }}
          className="anim-pop absolute bottom-full left-0 z-40 mb-1.5 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {slashMatches.map((c, i) => (
            <button
              key={c.cmd}
              type="button"
              ref={c === activeSlash ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => c.run()}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                c === activeSlash ? "bg-gray-100 dark:bg-gray-800" : ""
              }`}
            >
              <span className="shrink-0 font-mono text-gray-800 dark:text-gray-200">{c.cmd}</span>
              {/* Overly long descriptions (skill descriptions) are truncated: full text goes into the title. */}
              <span
                title={c.desc}
                className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400"
              >
                {c.desc}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* @ subagent menu (triggered by typing @; interaction matches the slash menu) */}
      {mentionOpen && (
        <div
          style={{ maxHeight: Math.min(256, upwardMaxH ?? 256) }}
          className="anim-pop absolute bottom-full left-0 z-40 mb-1.5 w-72 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {mentionMatches.map((a, i) => (
            <button
              key={a.agentId}
              type="button"
              onMouseEnter={() => setMentionIndex(i)}
              onClick={() => insertMention(a)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                a === activeMention ? "bg-gray-100 dark:bg-gray-800" : ""
              }`}
            >
              <span className="shrink-0 font-mono text-gray-800 dark:text-gray-200">
                @{a.agentId}
              </span>
              {a.name && a.name !== a.agentId && (
                <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
                  {a.name}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={i} className="anim-pop relative">
              <ZoomableImage
                src={url}
                alt={S.chat.imageAlt}
                className="h-16 w-16 rounded-md border border-gray-200 object-cover dark:border-gray-700"
              />
              <button
                type="button"
                aria-label={S.chat.removeImage}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-[10px] text-white transition-colors duration-150 hover:bg-gray-900"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* When the model doesn't support viewing images directly: images still upload as usual,
          and on send the server writes them to the session's scratchpad and appends the file
          path into the message text (the model views them via describe_image). A small note is
          shown while images are attached. */}
      {!vision && images.length > 0 && (
        <p className="anim-fade mb-1 text-xs text-gray-400 dark:text-gray-500">
          {S.chat.imagesAsPathHint}
        </p>
      )}

      {/* Unified input card: the multi-line text body occupies the top area, with all controls
          collected onto a single bottom row that never shares a line with the text.
          @container: the bottom toolbar row collapses based on the **card's actual width**
          (help text/button text visibility uses @md/@lg container breakpoints) — because the
          card's width changes with the viewport and the Files panel squeezing it, viewport
          breakpoints wouldn't judge it accurately. */}
      <div className="@container rounded-lg border border-gray-300 bg-white px-2.5 pb-2 pt-2 transition-[border-color,box-shadow] duration-200 focus-within:border-gray-500 focus-within:ring-2 focus-within:ring-gray-400/30 dark:border-gray-700 dark:bg-gray-900 dark:focus-within:border-gray-400">
        {/* Chip row above the text body: the @ handoff target (fixed at the front — send-time
            @ semantics stay leading-only) followed by the selected skills, mirroring the
            agent chip's look. Remove buttons recolor the x on hover (no background wash). */}
        {(target !== null || selectedSkills.length > 0) && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {target !== null && (
              <span
                className="anim-pop flex max-w-48 items-center gap-0.5 rounded-md bg-gray-100 py-0.5 pl-2 pr-1 font-mono text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                {...(target.name && target.name !== target.agentId ? { title: target.name } : {})}
              >
                <span className="truncate">@{target.agentId}</span>
                <button
                  type="button"
                  aria-label={S.chat.mentionRemove}
                  onClick={() => {
                    setTarget(null);
                    onHandoffTargetChange?.(null);
                    textareaRef.current?.focus();
                  }}
                  className="shrink-0 rounded p-0.5 text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  ×
                </button>
              </span>
            )}
            {selectedSkills.map((name) => {
              const meta = skills.find((sk) => sk.name === name);
              return (
                <span
                  key={name}
                  className="anim-pop flex max-w-48 items-center gap-1 rounded-md bg-gray-100 py-0.5 pl-2 pr-1 font-mono text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                  {...(meta ? { title: localizedShortText(locale, meta) } : {})}
                >
                  <SkillIcon
                    icon={meta?.icon}
                    size={13}
                    className="shrink-0 text-gray-500 dark:text-gray-400"
                  />
                  <span className="truncate">{name}</span>
                  <button
                    type="button"
                    aria-label={`${S.chat.skillRemove} ${name}`}
                    onClick={() => toggleSkill(name)}
                    className="shrink-0 rounded p-0.5 text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Multi-line input area (defaults to 2 lines, auto-grows, scrolls internally beyond the cap) */}
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            const value = e.target.value;
            const caretNow = e.target.selectionStart ?? value.length;
            setText(value);
            onTextChange?.(value);
            setCaret(caretNow);
            setSlashIndex(0);
            setMentionIndex(0);
            // Closing via Escape only persists for "the same token": continuing to type within
            // that slash command / mention won't reopen the menu; it re-opens once the cursor is
            // no longer on that token (deleted, moved away, or replaced by a new one).
            setSlashDismissed((d) => {
              if (d === null) return null;
              const m = matchSlash(value, caretNow);
              return m && m.start === d ? d : null;
            });
            setMentionDismissed((d) => {
              if (d === null) return null;
              const m = matchMention(value, caretNow);
              return m && m.start === d ? d : null;
            });
            autoGrow();
          }}
          // Cursor movement (arrow keys/click) syncs to caret: the @ menu filters by the prefix at the cursor.
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={narrow ? S.chat.inputPlaceholderShort : S.chat.inputPlaceholder}
          className="block max-h-44 min-h-[60px] w-full resize-none bg-transparent px-1 py-0.5 text-base leading-6 placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:placeholder:text-gray-500"
        />

        {/* Bottom toolbar row: attachments + approval mode + help text | context usage + Model + send */}
        <div className="mt-1 flex items-center gap-2 text-xs">
          <label
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title={vision ? S.chat.imageAlt : S.chat.imagesAsPathHint}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onPickFiles}
            />
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="block"
            >
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M3 15l5-5 4 4 3-3 6 6" />
            </svg>
          </label>
          <ApprovalModeSelect
            value={approvalMode}
            onChange={onChangeApprovalMode}
            disabled={modeSaving}
            direction={models && onChangeModel ? "down" : "up"}
          />
          {/* Multi-select skills dropdown (after approval mode): selected state is conveyed via the button badge. */}
          <SkillSelect
            skills={skills}
            selected={selectedSkills}
            onToggle={toggleSkill}
            disabled={running || compacting || busy}
            direction={models && onChangeModel ? "down" : "up"}
          />
          {/* Help text also serves as a flexible spacer: truncated first when space is short
              (min-w-0 truncate, full text goes into the title); hidden entirely when the card is
              narrower than @lg, leaving only the spacer to push the right-side controls to the
              end of the row — long copy (in English) still won't break the card layout. */}
          <span className="min-w-0 flex-1">
            <span
              title={`${S.chat.slashHint} · ${S.chat.mentionHint}`}
              className="hidden truncate text-gray-300 @lg:block dark:text-gray-600"
            >
              {S.chat.slashHint} · {S.chat.mentionHint}
            </span>
          </span>
          {/* Draft state (model still changeable = no session created yet) has no context usage to speak of: the ring isn't shown, it displays as usual once the session is created. */}
          {!onChangeModel && (
            <ContextGauge
              now={contextNow}
              unknown={contextStale}
              {...(contextWindow !== undefined ? { window: contextWindow } : {})}
            />
          )}
          {/* Left of the send button: model selector in draft state; once the Session is created the model is locked, shown read-only (still with the provider logo). */}
          {models && onChangeModel ? (
            <ModelSelect
              models={models}
              value={modelRef}
              {...(defaultModel !== undefined ? { defaultModel } : {})}
              onChange={onChangeModel}
              disabled={busy}
            />
          ) : (
            <span
              title={modelRef?.modelId ?? ""}
              className="flex h-8 min-w-0 max-w-44 shrink items-center gap-1.5 px-1 text-gray-400 dark:text-gray-500"
            >
              {/* Read-only display in session state: both the logo and the name come from the Session DTO's paired fields (no prefix parsing). */}
              <ProviderLogo
                provider={modelRef?.provider ?? "custom"}
                className="h-4 w-4 shrink-0"
              />
              <span className="hidden min-w-0 truncate @md:block">
                {(() => {
                  const m = models?.find((x) => sameModelRef(x, modelRef));
                  return m ? modelLabel(m) : (modelRef?.modelId ?? "…");
                })()}
              </span>
            </span>
          )}
          {running ? (
            <button
              type="button"
              title={S.chat.stop}
              aria-label={S.chat.stop}
              onClick={() => void onStop()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600 transition-colors duration-150 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-400 dark:hover:bg-red-950"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="block">
                <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              title={S.chat.send}
              aria-label={S.chat.send}
              disabled={!canSend}
              onClick={() => void send()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white transition-colors duration-150 hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300 dark:disabled:bg-gray-800 dark:disabled:text-gray-600"
            >
              {/* Up arrow (send) */}
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="block"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
