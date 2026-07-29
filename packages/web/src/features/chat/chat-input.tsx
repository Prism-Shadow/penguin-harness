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
 * Draft state also renders a thinking-level picker left of the model selector (backed by the
 * Agent settings: picking a level writes through to the Agent config and applies to the session
 * created on first send); in session state the level is fixed (llmConfig is assembled once per
 * session), shown as a read-only tag from session_meta;
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
 * When sent, the text body wraps in a `[use_skills]` block (the handoff's rest-of-message body is
 * wrapped the same way); the selection clears once sending succeeds. Quick-invoke pre-selects via
 * initialSkills (read once on mount; once the installed list is ready, names not in that list are
 * pruned); the slash menu also lists installed skills, and pressing Enter on `/<skill_name>`
 * selects it.
 * While a Task is running the input stays enabled and the toolbar keeps ONE action button:
 * an empty composer shows Stop (abort), and typing turns that same button into Send, which
 * follows the remembered mid-run send mode — steer (delivered between turns as a
 * [user_steering] user message) or queue-as-follow-up — chosen from the "+" menu's settings
 * row (available in draft state too, persisted in localStorage); sending is disabled with a
 * reason shown while compacting.
 * The toolbar is a single left/right row: settings controls left (scrolling horizontally when
 * the card is too narrow), status + model + the action button right (never shrinking), so a
 * phone viewport never pushes the action button off-screen.
 * Renders only the card body itself: outer positioning such as bottom-docking or vertical
 * centering is decided by the page.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from "react";
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
import { noAutofill } from "../../components/ui/input";
import { SkillIcon } from "../skills/skill-icon-view";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { Badge } from "../../components/ui/badge";
import {
  hasConfiguredKey,
  isFreeModel,
  sameModelRef,
  visibleChatModels,
} from "../models/model-grouping";
import { filterAgents, matchMention, splitLeadingMention } from "./agent-mentions";
import { matchSlash, removeSlashToken } from "./slash-token";
import { SELECTABLE_THINKING_LEVELS, thinkingLevelLabel } from "./thinking-level";
import {
  BOOK_ICON,
  buildSkillsMessage,
  filterSkills,
  localizedShortText,
  skillSlashItems,
} from "./skill-use";
import { GOAL_ICON, UNLIMITED_BUDGET, parseBudgetInput } from "./goal-use";

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
      // w-max: width exactly wraps the longest line (no wrapping within a line), avoiding an
      // overly wide panel. Placement is portal-driven (the toolbar scrolls horizontally on
      // phones, which would otherwise clip the panel); only size classes belong here.
      menuClass="w-max"
      portal={{ direction, align: "left" }}
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
 * Model candidate panel (search box + grouped list + "show all" expander) shared by the
 * draft-state ModelSelect dropdown and the in-session `/model` switch picker. Search and
 * expanded state are internal and reset by remount (both hosts only render the panel while
 * open); the list is capped by an internal scroll (max-h-56) so it never overflows the
 * viewport no matter how many models there are.
 * Dropdown order mirrors the model library page (visibleChatModels): a top quick-search box
 * (the model page's rule — filters by id / display name / provider name); by default only
 * models with a configured API key are listed (stored masked key — the same standard as the
 * model page's key status; `envKey` is merely the NAME of a fallback env var and doesn't
 * count), with the selected and the default model always visible even without a key; a muted
 * bottom row reveals the remaining key-less models (marked by a struck-through key icon, with
 * the "no key" text in its title) without closing the menu or changing the selection — when
 * no model has a key at all, everything is listed directly. Rows carry the provider logo, the
 * light-yellow "Free" badge for zero-cost models (same as the model library card), the
 * project-default marker, and the selected checkmark.
 */
function ModelMenuList({
  models,
  value,
  defaultModel,
  onPick,
}: {
  models: ModelInfo[];
  /** Currently selected (provider, modelId) pair; null = not yet chosen. */
  value: ModelRefDto | null;
  defaultModel?: ModelRefDto;
  onPick: (m: ModelInfo) => void;
}) {
  const [query, setQuery] = useState("");
  // Expanded "show all" state: collapses back to key-configured models on each open (remount).
  const [showAll, setShowAll] = useState(false);
  const visible = visibleChatModels(models, { showAll, query, selected: value, defaultModel });
  // How many models the key filter hides under the current query (0 when expanded): drives the bottom "show all" row.
  const hiddenCount = showAll
    ? 0
    : visibleChatModels(models, { showAll: true, query, selected: value, defaultModel }).length -
      visible.length;
  return (
    <>
      {/* Quick search: supports model id / display name / provider name */}
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={S.models.searchPlaceholder}
          aria-label={S.models.searchPlaceholder}
          {...noAutofill}
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
            onClick={() => onPick(m)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
              sameModelRef(m, value)
                ? "font-medium text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <ProviderLogo provider={m.provider} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{modelLabel(m)}</span>
            {/* Zero-cost rows (all three price buckets 0): same light-yellow "Free" badge as
                the model library card, so free models stand out while picking. */}
            {isFreeModel(m.pricing) && (
              <span className="shrink-0">
                <Badge tone="yellow">{S.models.freeBadge}</Badge>
              </span>
            )}
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
    </>
  );
}

/**
 * Model selector (draft state only; docked to the left of the send button): the button shows
 * the provider logo + name (logo only when the card is narrower than @md; the title carries
 * the full name), and the menu opens **downward** — the draft card is vertically centered
 * with room below. The candidate list itself is the shared ModelMenuList panel (search,
 * key-configured-first grouping, Free badge, "show all" expander — documented there).
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
  const current = models.find((m) => sameModelRef(m, value));
  // Display rule matches the model page's card: display name, or falls back to the upstream id (grouping is already conveyed by the provider logo).
  const label = current ? modelLabel(current) : (value?.modelId ?? "…");
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      // The panel's right edge docks to the button; portal placement then clamps both edges
      // inside the viewport, so a w-max panel can no longer run off-screen on phones (it used
      // to need a hand-tuned width clamp reserving the anchor offset).
      menuClass="w-max min-w-56 origin-top-right"
      portal={{ direction: "down", align: "right" }}
      button={
        <button
          type="button"
          title={`${S.chat.chooseModel}：${label}`}
          aria-label={S.chat.chooseModel}
          disabled={disabled || models.length === 0}
          onClick={() => setOpen(!open)}
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
      <ModelMenuList
        models={models}
        value={value}
        {...(defaultModel !== undefined ? { defaultModel } : {})}
        onPick={(m) => {
          onChange({ provider: m.provider, modelId: m.modelId });
          setOpen(false);
        }}
      />
    </Dropdown>
  );
}

/** Spark glyph for the thinking-level picker (24x24 line path, consistent with the toolbar icon set). */
const SPARK_ICON = "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z";

/**
 * Conversation-time thinking-level picker, used in two places. Both variants list only the
 * concrete levels (per review: a title bar names the control; short names only, no
 * descriptions, no "default"/"follow" row, and no "none" — many models cannot disable
 * thinking; a stored legacy "none" still displays via the label table, just never offered):
 * - Draft state (docked left of the model selector): shows the **selected Agent's** current
 *   `model.thinking_level` and writes a picked level straight through to the Agent settings —
 *   it applies to the session created on first send and becomes the Agent's new default
 *   (switch-becomes-default). An Agent without an explicit override shows an em dash until a
 *   level is picked.
 * - Active session: the level is a **per-turn parameter** sent with each task. The displayed
 *   value initializes to the Agent config's level and auto-follows it while the user hasn't
 *   picked (the parent resolves the display value and keeps omitting the level from tasks
 *   until touched); an explicit pick sticks for the session and rides on every subsequent
 *   send, never writing through to the Agent config.
 */
function ThinkingLevelSelect({
  value,
  onChange,
  disabled,
  direction = "down",
}: {
  /** Level to display and mark selected ("" = none to show yet); null = the Agent config is still loading (draft). */
  value: string | null;
  onChange: (level: string) => void;
  disabled: boolean;
  /** Popup direction: down for the draft card (room below), up for the bottom-docked session composer. */
  direction?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const label =
    value === null ? "…" : (thinkingLevelLabel(S.chat.thinkingLevelNames, value) ?? "—");
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-max min-w-36"
      portal={{ direction, align: "right" }}
      button={
        <button
          type="button"
          title={`${S.chat.thinkingLevel}：${label}`}
          aria-label={S.chat.thinkingLevel}
          disabled={disabled || value === null}
          onClick={() => setOpen(!open)}
          className="flex h-8 max-w-36 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d={SPARK_ICON} size={14} className="shrink-0" />
          {/* When the card is narrower than @md, only the icon remains (title shows the full state). */}
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
      {/* Title bar: names the control (the rows themselves are just the short names). */}
      <div className="border-b border-gray-100 px-3 pb-1.5 pt-0.5 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400">
        {S.chat.thinkingLevel}
      </div>
      {SELECTABLE_THINKING_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => {
            onChange(level);
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
            level === value
              ? "font-medium text-gray-900 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">
            {S.chat.thinkingLevelNames[level] ?? level}
          </span>
          <span className="w-3 shrink-0 text-center">{level === value ? "✓" : ""}</span>
        </button>
      ))}
    </Dropdown>
  );
}

/**
 * Mid-run send mode: steer (delivered mid-run as a [user_steering] input) vs follow-up
 * (queued server-side until the run ends). A remembered per-user UI preference, persisted
 * the same way as the sidebar grouping mode (validated localStorage read under a
 * `penguin.*` key); configurable from the "+" menu's settings row in draft state and active
 * sessions alike.
 */
type SteerMode = "steer" | "followup";
const STEER_MODE_KEY = "penguin.steerMode";
function initialSteerMode(): SteerMode {
  return localStorage.getItem(STEER_MODE_KEY) === "followup" ? "followup" : "steer";
}

/** Sliders icon (24×24 line path) for the mid-run send-mode settings row. */
const SLIDERS_ICON = "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6";

/**
 * The mid-run send mode row, rendered as the "+" menu's settings footer: Steer (default) /
 * Queue as a follow-up, the full explanation hover-only via each pill's title (the toolbar's
 * "full meaning on hover" convention). Laid out like the menu's items — leading icon, label,
 * the control where an item's description sits — so the menu reads as one list. Clicking a
 * pill keeps the menu open — it's a setting, not an action — and the row is never disabled:
 * the preference is settable before and during a run.
 */
function SteerModeRow({
  steerMode,
  onChangeSteerMode,
}: {
  steerMode: SteerMode;
  onChangeSteerMode: (mode: SteerMode) => void;
}) {
  // Compact pills, no bordered wrapper: the control must not out-height an item's 16px text
  // line by more than the row paddings absorb — h-5 pills inside py-1 land the row at the
  // same 28px an item's text + py-1.5 does, so the menu keeps one line rhythm.
  const modeButton = (mode: SteerMode, label: string, hint: string) => (
    <button
      type="button"
      title={hint}
      aria-pressed={steerMode === mode}
      onClick={() => onChangeSteerMode(mode)}
      className={`h-5 rounded px-1.5 text-xs transition-colors duration-150 ${
        steerMode === mode
          ? "bg-gray-200 font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-100"
          : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex w-full items-center gap-2 px-3 py-1 text-xs">
      <GlyphIcon d={SLIDERS_ICON} size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-400">
        {S.chat.steerModeLabel}
      </span>
      <div
        role="group"
        aria-label={S.chat.steerModeLabel}
        className="flex shrink-0 items-center gap-0.5"
      >
        {modeButton("steer", S.chat.steerModeSteer, S.chat.steerModeSteerHint)}
        {modeButton("followup", S.chat.steerModeFollowUp, S.chat.steerModeFollowUpHint)}
      </div>
    </div>
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
      // As wide as reasonably possible so descriptions stay readable; portal placement clamps
      // it to the viewport, so the old hand-tuned anchor-offset clamps are no longer needed.
      menuClass="w-[26rem]"
      portal={{ direction, align: "left" }}
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
          {...noAutofill}
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

/**
 * Picture glyph (24×24 line path) for the "+" menu's image-upload entry: the framing rectangle
 * and the mountain line as two subpaths of one `d`, since GlyphIcon renders a single `<path>`.
 */
const IMAGE_ICON =
  "M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3 15l5-5 4 4 3-3 6 6";

/** One entry of the composer's "+" extension menu. */
interface PlusMenuItem {
  key: string;
  icon: string;
  label: string;
  desc: string;
  /** Whether the entry is currently engaged (rendered with a check mark; clicking toggles). */
  active: boolean;
  /** Grayed out and inert (e.g. goal mode while a run is in progress); the menu still opens. */
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * The composer's "+" extension menu: a general-purpose entry point for input add-ons (goal
 * mode today; future modes, plugins, apps, files slot in as further items) plus input
 * settings (`footer`, currently the mid-run send mode row). Data-driven — the caller passes
 * the item list and footer; the menu itself knows nothing about the entries. The button is
 * never disabled: settings must stay reachable during a run, so unavailable *items* gray out
 * individually instead.
 */
function PlusMenu({
  items,
  footer,
  direction = "up",
}: {
  items: PlusMenuItem[];
  footer?: ReactNode;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      // Placement is portal-driven like the rest of the toolbar (its scroll container would
      // clip an absolutely-positioned panel); only size classes belong here.
      menuClass="w-72"
      portal={{ direction, align: "left" }}
      button={
        <button
          type="button"
          aria-label={S.chat.plusMenu}
          title={S.chat.plusMenu}
          onClick={() => setOpen(!open)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d="M12 5v14M5 12h14" size={15} className="shrink-0" />
        </button>
      }
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.active}
          disabled={item.disabled}
          onClick={() => {
            setOpen(false);
            item.onSelect();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-gray-800 dark:disabled:hover:bg-transparent ${
            item.active
              ? "font-medium text-gray-900 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400"
          }`}
        >
          <GlyphIcon
            d={item.icon}
            size={14}
            className="shrink-0 text-gray-400 dark:text-gray-500"
          />
          <span className="shrink-0">{item.label}</span>
          <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-500">
            {item.desc}
          </span>
          <span className="w-3 shrink-0 text-center">{item.active ? "✓" : ""}</span>
        </button>
      ))}
      {footer && (
        <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">{footer}</div>
      )}
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
      {/* The ring alone carries the meaning on phones: the numbers hide below @md (the title
          still shows the exact usage), keeping the right-hand control group inside a 320px
          viewport in the running state. */}
      <span className="hidden @md:inline">
        {unknown ? "—" : humanizeTokens(now)}/{humanizeTokens(max)}
      </span>
    </span>
  );
}

export function ChatInput({
  status,
  onSend,
  onSteer,
  steeringDeliveredCount,
  onQueueFollowUp,
  queuedFollowUps = 0,
  onStop,
  onCompact,
  modelRef,
  models,
  onChangeModel,
  onSwitchModel,
  defaultModel,
  thinkingLevel,
  onChangeThinkingLevel,
  turnThinkingLevel,
  onChangeTurnThinkingLevel,
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
  modelAuthDead = false,
  onOpenModels,
  onRetryModelAuth,
  onNewSession,
}: {
  status: SessionStatus;
  /**
   * Returns whether it succeeded: on failure the input draft is kept (not cleared).
   * `goal` is non-null when goal mode is engaged: the text is the objective and the server
   * loops the Session until the goal reaches a terminal state (budget -1 = unlimited).
   */
  onSend: (input: TaskInputPart[], goal: { budget: number } | null) => Promise<boolean>;
  /**
   * Mid-run steering (session state only): while a Task is running, Enter/send queues the
   * trimmed text **and any attached images** for the running agent — delivered between turns
   * as a standalone `[user_steering]` user message followed by its images. `"queued"` clears
   * the text and images and shows the queued hint; `"not_running"` (409 race with completion)
   * makes the input fall back to its full normal send path; `"failed"` keeps the draft. When
   * absent (draft state), the input stays send-disabled while running, as before.
   */
  onSteer?: (text: string, images: string[]) => Promise<"queued" | "not_running" | "failed">;
  /**
   * Count of steering messages already visible in the message stream: the queued hint stays
   * up until this increases past its value at queue time (i.e. the message was delivered).
   */
  steeringDeliveredCount?: number;
  /**
   * Follow-up queue (session state only): posts the full input with `queueIfBusy` — a busy
   * session holds it server-side and auto-sends it as an ordinary next task once the current
   * run finishes. Offered as the "follow-up" choice of the mid-run mode switch; when absent,
   * only steering is offered while running.
   */
  onQueueFollowUp?: (input: TaskInputPart[]) => Promise<boolean>;
  /** Server-reported queued follow-up count (from task_state): renders the "N queued" hint until they auto-send. */
  queuedFollowUps?: number;
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
  /**
   * Session state: model switch via the `/model` command — forks the session onto the picked
   * model (a NEW session carrying this conversation) and navigates there; any text remaining
   * after the command token is posted as the new session's first task. Returns whether it
   * succeeded (draft kept on failure). Only passed for an active session (the command is
   * additionally gated on not running/compacting); picking the current model is a no-op.
   */
  onSwitchModel?: (ref: ModelRefDto, input: TaskInputPart[]) => Promise<boolean>;
  /** Project default model (marked "default" on the selector's candidate item). */
  defaultModel?: ModelRefDto;
  /**
   * Draft state: the selected Agent's current thinking level ("" = no override / provider
   * default; null while the Agent config is loading — the picker renders disabled). Supplied
   * together with onChangeThinkingLevel; without the callback the picker isn't rendered.
   */
  thinkingLevel?: string | null;
  /**
   * Draft state: writes the picked level straight through to the Agent settings (the parent
   * persists it via the agent-config API; the session created on first send picks it up and it
   * becomes the Agent's new default).
   */
  onChangeThinkingLevel?: (level: string) => void;
  /**
   * Session state: the per-turn thinking level to DISPLAY — the parent resolves it as "the
   * user's pick for this session, else the Agent config's level" ("" = neither known yet),
   * so the picker auto-follows the config until touched. The send path is the parent's own
   * state: while untouched nothing is sent with tasks (the server/core fallback applies and
   * mid-session Agent-config edits keep taking effect); an explicit pick sticks and is sent
   * with every subsequent task, never writing through to the Agent config (that behavior
   * stays draft-only).
   */
  turnThinkingLevel?: string;
  /** Session state: pins the per-turn thinking level for this session; also enables the editable picker. */
  onChangeTurnThinkingLevel?: (level: string) => void;
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
  /**
   * Session state: the Session's model credentials failed authentication (abort with
   * status "auth") and the Project's credentials have not been updated since (the parent
   * computes the time gate — see isModelAuthDead). Recoverable: only the model reference
   * is fixed at creation, credentials come from the current Project config — so the
   * composer disables and grays itself with a notice pointing at the Models page (primary),
   * a Retry affordance, and a New Session escape. Updating the key auto-unlocks (live via
   * the credentials_updated event, and across reloads via the time gate).
   */
  modelAuthDead?: boolean;
  /** Navigates to the Models page (where the credential is actually fixed); renders the notice's primary button when supplied. */
  onOpenModels?: () => void;
  /**
   * Clears the auth-dead state and re-enables the composer for another attempt (the state
   * re-arms on the next auth failure). The escape hatch for credential changes the
   * timestamps miss (e.g. edited outside the UI).
   */
  onRetryModelAuth?: () => void;
  /** Navigates to a fresh draft (`/chat/new`); renders the notice's "New Session" button when supplied. */
  onNewSession?: () => void;
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
  // /model switch picker (session state): opened by the /model command. The command consumes
  // its slash token immediately (same as /compact), so closing the picker — Escape, click
  // outside, or the picked-current-model no-op — can never re-open the slash menu, and there
  // is no stale token range to recompute at pick time; whatever text remains is the draft
  // (and becomes the new session's first message on a successful pick).
  const [modelSwitchOpen, setModelSwitchOpen] = useState(false);
  const modelSwitchRef = useRef<HTMLDivElement>(null);
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
  // The draft's "anything sendable at all" rule, shared by canSend / canFollowUp / the
  // steer-mode queue fallback and (negated) by the Stop face of the action button.
  const draftHasContent =
    text.trim().length > 0 || images.length > 0 || target !== null || selectedSkills.length > 0;
  // Goal mode (engaged via the "+" menu or /goal): the text body becomes the objective. It is
  // exclusive with the @ handoff target (engaging either clears the other); attached images
  // ride along (core folds them into the objective as path lines) and selected skills ride the
  // round-1 message as a [use_skills] block, exactly like a normal send.
  const [goalOn, setGoalOn] = useState(false);
  const [goalBudgetText, setGoalBudgetText] = useState("");
  const [goalBudgetOpen, setGoalBudgetOpen] = useState(false);
  const [goalBudgetDraft, setGoalBudgetDraft] = useState("");
  /** The committed budget is always valid: the popover keeps invalid edits in its local draft. */
  const goalBudget = goalOn ? parseBudgetInput(goalBudgetText) : null;
  const goalBudgetDraftValue = parseBudgetInput(goalBudgetDraft);
  const goalBudgetDraftInvalid = goalBudgetDraftValue === null;
  const goalBudgetSummary =
    goalBudget !== null && goalBudget !== UNLIMITED_BUDGET
      ? S.chat.goalBudgetValue(humanizeTokens(goalBudget))
      : S.chat.goalBudgetUnlimited;
  // Sending is also allowed with only an @ target (chip) or skills selected and no text: a handoff's
  // first message may be just a [handoff_from] source block; with skills and empty text, the sent
  // text automatically falls back to S.chat.skillsAutoMessage (see send). Goal mode instead
  // requires a text objective and a parseable budget — and an open editor showing an invalid
  // draft disables Send outright: combined with the editor refusing to close over an invalid
  // draft (below), no click sequence can fire a goal with a stale committed budget.
  // Images may come along (core folds them into the objective as `[attached image: …]` lines
  // so they survive the rounds), but they don't substitute for the text.
  const canSend =
    !running &&
    !compacting &&
    !busy &&
    !modelAuthDead &&
    (goalOn
      ? text.trim().length > 0 && goalBudget !== null && !(goalBudgetOpen && goalBudgetDraftInvalid)
      : draftHasContent);

  /**
   * The budget editor is a fixed upward popover. Opening copies the committed value; closing
   * commits a valid draft — so typing a budget and clicking straight onto Send keeps it (the
   * Send mousedown closes the popover before the click lands). An INVALID draft refuses to
   * close: silently reverting would let the very next click fire the goal with the stale
   * committed budget — fix the draft or cancel with Escape (cancelGoalBudget below).
   */
  const setGoalBudgetEditorOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setGoalBudgetDraft(goalBudgetText);
        setGoalBudgetOpen(true);
        return;
      }
      if (parseBudgetInput(goalBudgetDraft) === null) return;
      setGoalBudgetText(goalBudgetDraft.trim());
      setGoalBudgetOpen(false);
    },
    [goalBudgetText, goalBudgetDraft],
  );

  /**
   * Cancel the budget editor: close WITHOUT committing (reopening re-copies the committed
   * value). Wired to the Dropdown's window-level Escape, so it is genuinely
   * focus-independent — including after an invalid draft refused an outside-click close and
   * focus already left the chip (e.g. sits in the objective textarea).
   */
  const cancelGoalBudget = useCallback(() => {
    setGoalBudgetOpen(false);
    textareaRef.current?.focus();
  }, []);

  /** Commit only valid input; Enter and the check button share this path. */
  const saveGoalBudget = useCallback(() => {
    if (parseBudgetInput(goalBudgetDraft) === null) return;
    setGoalBudgetText(goalBudgetDraft.trim());
    setGoalBudgetOpen(false);
    textareaRef.current?.focus();
  }, [goalBudgetDraft]);

  /**
   * Engage/exit goal mode; engaging clears the @ target and images (genuinely exclusive:
   * a handoff opens another session, and the server rejects non-text goal input). Selected
   * skills stay — they ride the round-1 message as a [use_skills] block, like a normal send.
   */
  const toggleGoal = useCallback(
    (on: boolean) => {
      setGoalOn(on);
      setGoalBudgetOpen(false);
      setGoalBudgetDraft("");
      if (on) {
        setGoalBudgetText("");
        setTarget(null);
        onHandoffTargetChange?.(null);
      }
    },
    [onHandoffTargetChange],
  );

  // Mid-run steering: while running, Enter/send queues the text **and the attached images**
  // for the running agent (delivered between turns as a [user_steering] user message followed
  // by its images) — so an image with no caption is a complete steering message on its own.
  // Selected skills still stay in the draft for a later normal send: a [use_skills] block is
  // task-level setup, not something to hand a turn that is already under way. An @ target
  // also blocks steering: a leading mention means a handoff, not a message to this agent.
  // `!goalOn`: with the goal chip engaged the text is an OBJECTIVE — steering it into a run
  // that happens to be active (e.g. a schedule fired) would silently repurpose it.
  const canSteer =
    running &&
    !busy &&
    !goalOn &&
    !modelAuthDead &&
    onSteer !== undefined &&
    target === null &&
    (text.trim().length > 0 || images.length > 0);
  // Mid-run send mode (owner directive): the user chooses between "steer" (delivered
  // mid-run as a [user_steering] input) and "follow-up" (held server-side and auto-sent as
  // an ordinary next task once this run finishes). Set from the "+" menu's settings row —
  // available in draft state and active sessions alike — and **remembered** across
  // sessions/reloads (localStorage, see STEER_MODE_KEY); the running-state send simply
  // follows the remembered mode.
  const [steerMode, setSteerModeState] = useState<SteerMode>(initialSteerMode);
  const setSteerMode = (mode: SteerMode): void => {
    setSteerModeState(mode);
    localStorage.setItem(STEER_MODE_KEY, mode);
  };
  const followUpMode = steerMode === "followup" && onQueueFollowUp !== undefined;
  // A follow-up is a full normal message: the whole draft (text / images / skills / handoff)
  // is eligible, same content rule as canSend.
  const canFollowUp =
    running && !busy && !goalOn && !modelAuthDead && followUpMode && draftHasContent;
  // Steer mode holding a draft the steer channel can't carry — since steering carries text
  // and images, what is left is a skills-only draft or an @ target: the draft is still
  // perfectly sendable, so THIS send falls back to the follow-up queue (held server-side,
  // auto-sent as the next ordinary message once the run finishes; an @ handoff opens its new
  // chat directly). Without the fallback the button face flips to send (any content does
  // that) but could never enable, stranding the user on a dead button that also displaced Stop.
  // `!goalOn` / `!modelAuthDead`: same gates as canSteer / canFollowUp — a goal draft is an
  // objective, not a queueable message (sendNormal would fire it as a goal run), and a dead
  // model key has nothing to send with. Both keep the send button disabled, as on main.
  const steerFallbackToQueue =
    running &&
    !busy &&
    !goalOn &&
    !modelAuthDead &&
    !followUpMode &&
    !canSteer &&
    onQueueFollowUp !== undefined &&
    draftHasContent;
  // The single action button's mode: while running, an **empty** composer means Stop
  // (abort); as soon as there is any content it becomes the send button — steer or
  // follow-up per the remembered mode, with the label following the path this send will
  // actually take. Idle/compacting is always send.
  const canMidRunSend = followUpMode ? canFollowUp : canSteer || steerFallbackToQueue;
  const midRunSendLabel =
    followUpMode || steerFallbackToQueue ? S.chat.followUpSend : S.chat.steerSend;
  const stopAction = running && !draftHasContent;
  // Queued hint: shown after a successful steer until the message shows up in the stream
  // (steeringDeliveredCount increases past the baseline captured at queue time) or the run
  // stops being observable (task no longer running).
  const [steerPending, setSteerPending] = useState(false);
  const steerBaseline = useRef(0);
  useEffect(() => {
    if (!steerPending) return;
    if (!running || (steeringDeliveredCount ?? 0) > steerBaseline.current) {
      setSteerPending(false);
    }
  }, [steerPending, running, steeringDeliveredCount]);

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
    /** Removes just the slash token after a command runs (the rest of the text stays; the height re-measures itself off the new value, see the autoGrow layout effect). */
    const clearInput = () => {
      const match = slashMatchRef.current;
      const next = match ? removeSlashToken(textRef.current, match) : "";
      setText(next);
      onTextChange?.(next);
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
      {
        cmd: "/goal",
        desc: S.chat.goalModeDesc,
        run: () => {
          clearInput();
          toggleGoal(!goalOn);
        },
      },
      // Model switch (active idle session only — the parent passes onSwitchModel just there;
      // draft state has its own model picker). Gated on the model list being loaded: without
      // it the picker would open empty. Running the command consumes the /model token (like
      // /compact) and opens the picker; the rest of the draft stays.
      ...(onSwitchModel && models && models.length > 0
        ? [
            {
              cmd: "/model",
              desc: S.chat.switchModel,
              run: () => {
                clearInput();
                setModelSwitchOpen(true);
              },
            },
          ]
        : []),
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
  }, [
    onCompact,
    onSwitchModel,
    models,
    onTextChange,
    skills,
    locale,
    toggleSkill,
    toggleGoal,
    goalOn,
  ]);
  // Positional matching (like @ mentions): a slash opens the menu from any caret position;
  // running a command removes just the token, leaving the rest of the text intact. Doesn't
  // reopen after Escape until the caret sits on a different token; suppressed while the
  // /model picker is open (its trigger token is still in the text).
  const slashTok = !running && !compacting && !modelSwitchOpen ? matchSlash(text, caret) : null;
  slashMatchRef.current = slashTok;
  const slashMatches =
    slashTok && slashTok.start !== slashDismissed
      ? commands.filter((c) => c.cmd.startsWith(`/${slashTok.query}`))
      : [];
  const slashOpen = slashMatches.length > 0;
  const activeSlash = slashMatches[Math.min(slashIndex, slashMatches.length - 1)];

  // @ subagent menu: the `@prefix` currently being typed at the cursor drives candidate
  // filtering (the slash menu and the /model picker take priority; doesn't reopen after Escape).
  const mention =
    !running && !compacting && !slashOpen && !modelSwitchOpen ? matchMention(text, caret) : null;
  const mentionMatches =
    mention && mention.start !== mentionDismissed ? filterAgents(agents, mention.query) : [];
  const mentionOpen = mentionMatches.length > 0;
  const activeMention = mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)];

  // Close the /model picker on click-outside / Escape (same convention as Dropdown; the
  // panel has no trigger button of its own, so the handling lives here).
  useEffect(() => {
    if (!modelSwitchOpen) return;
    // globalThis.* event types: the React ones imported above would shadow the DOM ones here.
    const onClick = (e: globalThis.MouseEvent) => {
      if (modelSwitchRef.current && !modelSwitchRef.current.contains(e.target as Node)) {
        setModelSwitchOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setModelSwitchOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [modelSwitchOpen]);

  /**
   * /model pick: the CURRENT model is a no-op (close only), and the run state is re-checked
   * — the picker may have survived a status flip (a task/compaction starting while it was
   * open). Otherwise the pick opens a new session on the chosen model via onSwitchModel,
   * with the first-task input assembled **like a normal send**: the remaining draft text
   * (wrapped with the selected skills; an interface-language auto-line when empty — same
   * convention as the skills auto message) plus the attached images. On failure the draft
   * is kept so the user can retry.
   */
  const pickSwitchModel = async (m: ModelInfo) => {
    setModelSwitchOpen(false);
    if (!onSwitchModel || busy || running || compacting) return;
    if (sameModelRef(m, modelRef)) return;
    const rest = textRef.current.trim();
    const bodyText =
      rest ||
      (selectedSkills.length > 0
        ? S.chat.skillsAutoMessage(selectedSkills)
        : S.chat.modelSwitchAutoMessage);
    const body = buildSkillsMessage(selectedSkills, bodyText);
    const input: TaskInputPart[] = [{ type: "text", text: body }];
    for (const url of images) input.push({ type: "image_url", imageUrl: url });
    setBusy(true);
    try {
      const ok = await onSwitchModel({ provider: m.provider, modelId: m.modelId }, input);
      if (ok) {
        // Consumed into the new session's first task (the parent has already discarded the
        // draft cache — no change callbacks here, same as send()).
        setText("");
        setImages([]);
        setSelectedSkills([]);
      }
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  // The menus above are drawn upward (`bottom-full`) from the composer, so their ceiling is
  // whatever ancestor clips overflow — on the draft page that's the centered scroll area, whose
  // top edge sits well below the viewport's. A static `40vh` cap can't know that distance and
  // clipped the first rows on shorter windows, so measure the real gap when a menu opens.
  useEffect(() => {
    if (!slashOpen && !mentionOpen && !modelSwitchOpen) return;
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
  }, [slashOpen, mentionOpen, modelSwitchOpen]);

  /** Auto-grow the textarea (caps at roughly 6 lines, scrolls internally beyond that). */
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  };

  /**
   * The height follows the **rendered** value, measured in a layout effect — the single place
   * that sizes the box, covering mount (a restored multi-line draft), typing, and the clear
   * after a send alike.
   *
   * It must be a layout effect keyed on `text` rather than a call next to each `setText`: the
   * textarea is controlled, so after `setText("")` the DOM still holds the old text until React
   * commits. A `requestAnimationFrame` scheduled alongside the state update races that commit
   * and, when it wins, measures the old multi-line content and re-pins the tall height — with
   * nothing left to measure again, the composer stayed expanded after every send. A layout
   * effect runs after the commit by construction, and before paint, so the box never flashes.
   */
  useLayoutEffect(autoGrow, [text]);

  // Cursor placement on mount: move it to the end of a restored draft (by default the browser
  // places the cursor at the start when focusing a textarea that already has content), so typing
  // continues the text naturally, and sync the caret state to match (the @ mention menu filters
  // by cursor position).
  useEffect(() => {
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
    setGoalOn(false); // exclusive with goal mode: picking an @ target exits it (latest wins)
    setText(value);
    onTextChange?.(value);
    setCaret(start);
    setMentionIndex(0);
  };

  /**
   * The full normal send path (task / handoff), also the follow-up queue path and the
   * fallback target when a steer hits the completion race: assembles the [use_skills]
   * block, images and @ handoff from the whole draft; `post` decides where a non-handoff
   * message goes (default: onSend; follow-up mode: onQueueFollowUp). Deliberately not
   * gated on `running` — the caller decides (send() gates the normal path; the steering
   * fallback calls this directly after the server said 409 not_running, when the local
   * `status` may still lag behind).
   */
  // `post` accepts onSend's goal parameter so onSend can be its default; the follow-up queue
  // (fewer params) is assignable too. Non-goal calls always pass null.
  const sendNormal = async (
    post: (input: TaskInputPart[], goal: { budget: number } | null) => Promise<boolean> = onSend,
  ) => {
    const t = text.trim();
    // Goal mode: the trimmed text is the objective (no images, no @ handoff — cleared/blocked
    // while the chip is on; a leading @ stays plain text). Selected skills prefix the round-1
    // message as a [use_skills] block, exactly like a normal send — the server strips leading
    // marker blocks when recording the objective, and rounds after the first re-inject the
    // objective alone.
    if (goalOn) {
      setBusy(true);
      try {
        // Attached images go with the objective; core folds them into `[attached image: <path>]`
        // lines inside it so they are still there in later rounds.
        const goalInput: TaskInputPart[] = [
          { type: "text", text: buildSkillsMessage(selectedSkills, t) },
        ];
        for (const url of images) goalInput.push({ type: "image_url", imageUrl: url });
        const ok = await onSend(goalInput, { budget: goalBudget! });
        if (ok) {
          setText("");
          setImages([]);
          setSelectedSkills([]);
          toggleGoal(false);
        }
      } finally {
        setBusy(false);
        textareaRef.current?.focus();
      }
      return;
    }
    // @ target = the chip (selected via menu), or a leading `@<agentId>` typed/pasted manually
    // (an @ in the middle of the text is plain text); with a target present, this becomes a
    // handoff to a new chat, the current Session isn't sent to, and the text carries no @ marker.
    const lead = target ? { agent: target, rest: t } : splitLeadingMention(t, agents);
    // With skills selected and an empty text body: the sent text automatically falls back to a
    // localized invocation sentence generated per the UI language.
    const rest = lead ? lead.rest : t;
    const bodyText =
      selectedSkills.length > 0 && rest === "" ? S.chat.skillsAutoMessage(selectedSkills) : rest;
    // With non-empty selected skills: the text body is replaced with a [use_skills] block + the text (the handoff branch wraps rest the same way).
    const body = buildSkillsMessage(selectedSkills, bodyText);
    const input: TaskInputPart[] = [];
    if (body) input.push({ type: "text", text: body });
    for (const url of images) input.push({ type: "image_url", imageUrl: url });
    setBusy(true);
    try {
      const ok = lead ? await onHandoff(lead.agent, input) : await post(input, null);
      // Only clear the draft after a successful send: on failure (network / conflict / server error) keep the user's input and images.
      if (ok) {
        setText("");
        setImages([]);
        setTarget(null);
        setSelectedSkills([]);
      }
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  const send = async () => {
    if (running) {
      // Follow-up branch: the whole draft goes out through the normal composition path,
      // but posted with queueIfBusy — the server holds it and auto-sends once this run
      // finishes (an @ handoff still opens a new chat directly: the target session isn't
      // the one running).
      if (followUpMode) {
        if (!canFollowUp) return;
        await sendNormal(onQueueFollowUp!);
        return;
      }
      // Steer mode, draft the text-only steer channel can't carry: whole draft through the
      // follow-up queue instead (one complete message; see steerFallbackToQueue).
      if (steerFallbackToQueue) {
        await sendNormal(onQueueFollowUp!);
        return;
      }
      // Steering branch: queue the trimmed text and the attached images for the running
      // agent; both are sent and cleared together — only selected skills stay behind for a
      // normal send (see canSteer).
      if (!canSteer) return;
      const steerText = text.trim();
      const steerImages = images;
      setBusy(true);
      let res: "queued" | "not_running" | "failed" = "failed";
      try {
        res = await onSteer!(steerText, steerImages);
        if (res === "queued") {
          // Show the "queued" hint until the steering message shows up in the stream
          // (steeringDeliveredCount increases) — see the effect below.
          steerBaseline.current = steeringDeliveredCount ?? 0;
          setSteerPending(true);
          setText("");
          setImages([]);
        }
      } finally {
        setBusy(false);
        textareaRef.current?.focus();
      }
      // Completion race (server: no Task running anymore): deliver the whole draft — skills
      // and all — through the full normal send path. The draft is untouched in this branch
      // (nothing was cleared), so the images go out with it.
      if (res === "not_running") await sendNormal();
      return;
    }
    if (!canSend) return;
    await sendNormal();
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
  /**
   * The image picker moved into the "+" menu, so the file input can no longer be a `<label>`
   * wrapper: the menu unmounts its items on select. It lives outside the menu instead and the
   * entry clicks it — still inside the click's user-activation window, so the dialog opens.
   */
  const imageInputRef = useRef<HTMLInputElement>(null);

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

      {/* /model switch picker (session state): reuses the draft model dropdown's list —
          search + configured-key-first grouping + "show all"; the current model is marked and
          picking it is a no-op. The /model token was already consumed when the command ran,
          so cancelling (Escape / click outside) keeps the remaining draft and cannot re-open
          the slash menu. */}
      {modelSwitchOpen && models && (
        <div
          ref={modelSwitchRef}
          style={{ maxHeight: upwardMaxH }}
          className="anim-pop absolute bottom-full left-0 z-40 mb-1.5 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="border-b border-gray-100 px-3 pb-1.5 pt-0.5 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {S.chat.switchModelTitle}
          </div>
          <ModelMenuList
            models={models}
            value={modelRef}
            {...(defaultModel !== undefined ? { defaultModel } : {})}
            onPick={(m) => void pickSwitchModel(m)}
          />
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

      {/* Mid-run steering queued: lightweight hint until the steering message appears in the
          stream (or the run ends). */}
      {steerPending && (
        <p className="anim-fade mb-1 text-xs text-gray-400 dark:text-gray-500">
          {S.chat.steerQueuedIndicator}
        </p>
      )}

      {/* Queued follow-ups (server-side, auto-sent once this run finishes): count from
          task_state — survives reloads because the queue lives on the server. */}
      {queuedFollowUps > 0 && (
        <p className="anim-fade mb-1 text-xs text-gray-400 dark:text-gray-500">
          {S.chat.followUpQueuedChip(queuedFollowUps)}
        </p>
      )}

      {/* Auth-dead session (model credentials failed): slim notice above the composer, same
          width — the abort line in the stream keeps the raw reason, this adds the "what now"
          guidance. Recoverable: primary CTA opens the Models page (fixing the key there
          auto-unlocks the session), Retry clears the state for another attempt (re-arms on
          the next auth failure), New Session stays as the escape. The composer below is
          disabled and hazed. */}
      {modelAuthDead && (
        <div className="anim-fade mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
          <span className="min-w-0 flex-1 basis-56">{S.chat.modelAuthDead}</span>
          <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            {onOpenModels && (
              <button
                type="button"
                onClick={onOpenModels}
                className="shrink-0 rounded-md bg-gray-900 px-2.5 py-1 font-medium text-white transition-colors duration-150 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
              >
                {S.chat.modelAuthDeadOpenModels}
              </button>
            )}
            {onRetryModelAuth && (
              <button
                type="button"
                onClick={onRetryModelAuth}
                className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {S.chat.modelAuthDeadRetry}
              </button>
            )}
            {onNewSession && (
              <button
                type="button"
                onClick={onNewSession}
                className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {S.chat.modelAuthDeadCta}
              </button>
            )}
          </span>
        </div>
      )}

      {/* Unified input card: the multi-line text body occupies the top area, with all controls
          collected onto a single bottom row that never shares a line with the text.
          @container: the bottom toolbar row collapses based on the **card's actual width**
          (help text/button text visibility uses @md/@lg container breakpoints) — because the
          card's width changes with the viewport and the Files panel squeezing it, viewport
          breakpoints wouldn't judge it accurately. */}
      <div
        // Auth-dead haze deliberately keeps pointer events and text selection: the
        // textarea's `disabled` already blocks editing, and the stuck draft must stay
        // selectable/copyable — a long message that failed to send is exactly what the
        // user wants to copy back out.
        className={`@container rounded-lg border border-gray-300 bg-white px-2.5 pb-2 pt-2 transition-[border-color,box-shadow] duration-200 focus-within:border-gray-500 focus-within:ring-2 focus-within:ring-gray-400/30 dark:border-gray-700 dark:bg-gray-900 dark:focus-within:border-gray-400${
          modelAuthDead ? " opacity-50 grayscale" : ""
        }`}
      >
        {/* Chip row above the text body: the @ handoff target (fixed at the front — send-time
            @ semantics stay leading-only) followed by the selected skills, mirroring the
            agent chip's look. Remove buttons recolor the x on hover (no background wash). */}
        {(target !== null || selectedSkills.length > 0 || goalOn) && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {/* Goal-mode chip: the budget stays compact as a value button; its editor is a
                fixed upward popover so it never covers the objective textarea below. */}
            {goalOn && (
              <span className="anim-pop flex max-w-full items-center gap-1 rounded-md bg-gray-100 py-0.5 pl-2 pr-1 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                <span className="flex shrink-0 items-center gap-1" title={S.chat.goalModeDesc}>
                  <GlyphIcon d={GOAL_ICON} size={13} className="text-gray-500 dark:text-gray-400" />
                  <span>{S.chat.goalMode}</span>
                </span>
                <span
                  aria-hidden
                  className="mx-0.5 h-4 w-px shrink-0 bg-gray-300 dark:bg-gray-600"
                />
                <Dropdown
                  open={goalBudgetOpen}
                  setOpen={setGoalBudgetEditorOpen}
                  onEscape={cancelGoalBudget}
                  className="min-w-0"
                  menuClass="bottom-full left-1/2 -ml-32 mb-2 w-64 max-w-[calc(100vw-2rem)] origin-bottom"
                  button={
                    <button
                      type="button"
                      aria-label={goalBudgetSummary}
                      aria-expanded={goalBudgetOpen}
                      onClick={() => setGoalBudgetEditorOpen(!goalBudgetOpen)}
                      className="flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-xs text-gray-600 transition-colors duration-150 hover:bg-white/80 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                    >
                      <span className="truncate">{goalBudgetSummary}</span>
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                        aria-hidden
                      >
                        <path d="M3 4.5l3 3 3-3" />
                      </svg>
                    </button>
                  }
                >
                  <div className="px-3 py-2">
                    <label
                      htmlFor="goal-budget-input"
                      className="block text-xs font-medium text-gray-700 dark:text-gray-200"
                    >
                      {S.chat.goalBudgetLabel}
                    </label>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        id="goal-budget-input"
                        autoFocus
                        value={goalBudgetDraft}
                        onChange={(e) => setGoalBudgetDraft(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          // Escape is handled at the window level (Dropdown onEscape →
                          // cancelGoalBudget), so it cancels no matter where focus sits.
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            saveGoalBudget();
                          }
                        }}
                        placeholder={S.chat.goalBudgetPlaceholder}
                        aria-invalid={goalBudgetDraftInvalid}
                        aria-describedby="goal-budget-hint"
                        {...noAutofill}
                        title={
                          goalBudgetDraftInvalid ? S.chat.goalBudgetInvalid : S.chat.goalBudgetHint
                        }
                        className={`min-w-0 flex-1 rounded-md border bg-white px-2 py-1 font-mono text-sm leading-5 placeholder:text-gray-400 focus:outline-none focus:ring-2 dark:bg-gray-950 dark:placeholder:text-gray-500 ${
                          goalBudgetDraftInvalid
                            ? "border-red-400 text-red-600 focus:border-red-500 focus:ring-red-400/20 dark:border-red-500 dark:text-red-400"
                            : "border-gray-300 text-gray-800 focus:border-gray-500 focus:ring-gray-400/20 dark:border-gray-700 dark:text-gray-100 dark:focus:border-gray-500"
                        }`}
                      />
                      <button
                        type="button"
                        aria-label={S.chat.goalBudgetSave}
                        title={S.chat.goalBudgetSave}
                        disabled={goalBudgetDraftInvalid}
                        onClick={saveGoalBudget}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white transition-colors duration-150 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                      >
                        <GlyphIcon d="M5 12l4 4L19 6" size={14} />
                      </button>
                    </div>
                    <p
                      id="goal-budget-hint"
                      className={`mt-1.5 text-[11px] leading-4 ${
                        goalBudgetDraftInvalid
                          ? "text-red-500 dark:text-red-400"
                          : "text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {goalBudgetDraftInvalid ? S.chat.goalBudgetInvalid : S.chat.goalBudgetHint}
                    </p>
                  </div>
                </Dropdown>
                <button
                  type="button"
                  aria-label={S.chat.goalRemove}
                  onClick={() => toggleGoal(false)}
                  className="shrink-0 rounded p-0.5 text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  ×
                </button>
              </span>
            )}
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
          }}
          // Cursor movement (arrow keys/click) syncs to caret: the @ menu filters by the prefix at the cursor.
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={modelAuthDead}
          placeholder={
            modelAuthDead
              ? S.chat.modelAuthDeadPlaceholder
              : running && followUpMode
                ? narrow
                  ? S.chat.followUpPlaceholderShort
                  : S.chat.followUpPlaceholder
                : running && onSteer
                  ? narrow
                    ? S.chat.steerPlaceholderShort
                    : S.chat.steerPlaceholder
                  : narrow
                    ? S.chat.inputPlaceholderShort
                    : S.chat.inputPlaceholder
          }
          className="block max-h-44 min-h-[60px] w-full resize-none bg-transparent px-1 py-0.5 text-base leading-6 placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:placeholder:text-gray-500"
        />

        {/* Bottom toolbar row — one line, two groups: the settings controls sit left, the
            status/model/action controls right (`justify-between`). The left group is the only
            one allowed to give way: `min-w-0` + horizontal scroll means a crowded phone
            viewport scrolls those controls instead of pushing the right group (and with it the
            action button) off-screen. The right group is `shrink-0` so the action button is
            always reachable. */}
        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {/* The image picker's actual input: kept mounted here (outside the menu, which
                unmounts its items on select) and driven by the menu entry below. */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onPickFiles}
            />
            {/* "+" extension menu, leading the row: input add-ons (image upload, goal mode)
                plus the input settings footer (mid-run send mode — usable while running, which
                is exactly when it matters, so the button itself never disables). Image upload
                lives in here rather than as its own toolbar button: one 8x8 slot instead of
                two, which is the difference between the phone row scrolling and not. */}
            <PlusMenu
              items={[
                {
                  key: "image",
                  icon: IMAGE_ICON,
                  label: S.chat.uploadImage,
                  // Without vision the images still send — as scratchpad file paths — so the
                  // entry stays usable and the hint says what will happen instead. Goal mode
                  // sends them that way on any model, since the objective is re-injected as
                  // text every round.
                  desc: vision && !goalOn ? S.chat.uploadImageDesc : S.chat.imagesAsPathHint,
                  active: images.length > 0,
                  onSelect: () => imageInputRef.current?.click(),
                },
                {
                  key: "goal",
                  icon: GOAL_ICON,
                  label: S.chat.goalMode,
                  desc: S.chat.goalModeDesc,
                  active: goalOn,
                  disabled: running || compacting || busy,
                  onSelect: () => toggleGoal(!goalOn),
                },
              ]}
              footer={<SteerModeRow steerMode={steerMode} onChangeSteerMode={setSteerMode} />}
              direction={models && onChangeModel ? "down" : "up"}
            />
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
            {/* Help text: shown only when the card is wide enough (@lg); it never competes for
                space on phones, where the group scrolls instead. */}
            <span
              title={`${S.chat.slashHint} · ${S.chat.mentionHint}`}
              className="hidden min-w-0 truncate text-gray-300 @lg:block dark:text-gray-600"
            >
              {S.chat.slashHint} · {S.chat.mentionHint}
            </span>
          </div>

          {/* Right group: status + model + the single action button; never shrinks. */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Draft state (model still changeable = no session created yet) has no context usage to speak of: the ring isn't shown, it displays as usual once the session is created. */}
            {!onChangeModel && (
              <ContextGauge
                now={contextNow}
                unknown={contextStale}
                {...(contextWindow !== undefined ? { window: contextWindow } : {})}
              />
            )}
            {/* Draft state: conversation-time thinking level (backed by Agent settings), docked left of the model selector. */}
            {models && onChangeModel && onChangeThinkingLevel && (
              <ThinkingLevelSelect
                value={thinkingLevel ?? null}
                onChange={onChangeThinkingLevel}
                disabled={busy}
              />
            )}
            {/* Session state: per-turn thinking level (editable) — displays the user's pick,
              else the Agent config's level (auto-follow; the parent resolves it). While
              untouched nothing rides on tasks; a pick sticks for the session and is sent
              with every subsequent send, never writing through to the Agent config. */}
            {!onChangeModel && onChangeTurnThinkingLevel && (
              <ThinkingLevelSelect
                value={turnThinkingLevel ?? ""}
                onChange={onChangeTurnThinkingLevel}
                disabled={busy}
                direction="up"
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
            {/* One action button, never two: while running an empty composer means "Stop"
              (abort), and typing turns the very same button into "Send" — which, mid-run,
              steers or queues per the remembered send mode (the "+" menu's settings row).
              Idle/compacting keeps the ordinary send button (disabled while compacting via
              canSend). Merging the pair keeps the running-state row within a 320px viewport. */}
            <button
              type="button"
              title={stopAction ? S.chat.stop : running ? midRunSendLabel : S.chat.send}
              aria-label={stopAction ? S.chat.stop : running ? midRunSendLabel : S.chat.send}
              disabled={stopAction ? false : running ? !canMidRunSend : !canSend}
              onClick={() => (stopAction ? void onStop() : void send())}
              className={
                stopAction
                  ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600 transition-colors duration-150 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-400 dark:hover:bg-red-950"
                  : "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-900 text-white transition-colors duration-150 hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300 dark:disabled:bg-gray-800 dark:disabled:text-gray-600"
              }
            >
              {stopAction ? (
                /* Stop (filled square) */
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="block">
                  <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              ) : (
                /* Up arrow (send) */
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
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
