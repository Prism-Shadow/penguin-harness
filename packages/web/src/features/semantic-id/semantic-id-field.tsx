/**
 * The id field every create dialog that names an object with a semantic id wears — a Project's,
 * an Agent's, a Benchmark's, an organization's and a channel's. The id is still required and
 * still validated by the caller (each kind has its own rule and its own error copy), but it no
 * longer has to be invented: the field carries a "generate" button that asks the server to
 * propose one from the display name (or, when nothing else names the thing yet, from the
 * mission or the description), which is why the name is the field above it.
 *
 * The proposal REPLACES whatever is in the box: the button is pressed to get an id, not to
 * get a suggestion beside the one already typed. It is unavailable while there is no text to
 * derive from and while a request is in flight, and it always comes back with an id — a name
 * nothing could translate gets a placeholder, and the note under the field says so and asks
 * for a real name, rather than a toast that would be gone by the time the user looks down.
 * Nothing is proposed on its own: typing a name never rewrites the id.
 *
 * The button says what it does in words — a model is asked for the id, which is not something
 * a sparkles glyph on its own tells anyone — so it sits BESIDE the box rather than inside it,
 * where a label would crowd the value it is meant to leave room for. What it must stay outside
 * of is the field's `<label>`: a `<button>` is a labelable element, so a wrapping label would
 * name the button instead of the input (the trap field.tsx documents). Hence the label row and
 * the hint are drawn here and the `Input` renders bare.
 *
 * A non-admin's Project id is `<username>-<suffix>` and only the suffix is typed: the fixed part
 * is drawn as `lockedPrefix` in front of the box, and a proposal (which the server returns whole)
 * fills in the part after it.
 */
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SemanticIdKind } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { toastError } from "../../components/ui/toast";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { idSuggestNotice, proposalValue } from "./id-suggest-notice";
import type { IdSuggestNotice } from "./id-suggest-notice";

/** Generate (lucide sparkles): the four-pointed star with its two smaller companions. */
const SPARKLES_ICON =
  "m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275zM5 3v4M19 17v4M3 5h4M17 19h4";

export function SemanticIdField({
  projectId,
  kind,
  label,
  hint,
  value,
  source,
  taken,
  error,
  lockedPrefix,
  generateHint,
  disabled = false,
  onChange,
  onEnter,
}: {
  /**
   * The Project whose default model is asked — for a Project id, the Project the dialog was
   * opened from. Null while there is none, which leaves the button unavailable.
   */
  projectId: string | null;
  /** What the id is for; the server's proposal is shaped by it. */
  kind: SemanticIdKind;
  label: string;
  /** The id rule, which stays on screen while the user types; the generation clause is appended here. */
  hint: string;
  value: string;
  /** The text a proposal is derived from — the display name, or the mission while the name is empty. */
  source: string;
  /** Ids already taken in the target scope, so a proposal never collides. Omitted where the caller knows of none. */
  taken?: readonly string[];
  /** The caller's own validation message; it outranks anything the generation has to say. */
  error?: string | undefined;
  /** A fixed start of the id drawn in front of the box and not typed (`value` is what follows it). */
  lockedPrefix?: string;
  /** The generation clause appended to `hint`, when "the display name" is not what the dialog calls it. */
  generateHint?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
  /** Enter inside the field, where the dialog submits on it. */
  onEnter?: () => void;
}) {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  const [busy, setBusy] = useState(false);
  /** What the last proposal has to say about the id it filled in; cleared by the next edit or attempt. */
  const [notice, setNotice] = useState<IdSuggestNotice | null>(null);
  const derivable = source.trim() !== "";
  // The caller's validation outranks the proposal's own note: a rejected id is about what is
  // in the box, which is what the user is looking at.
  const showError = error !== undefined;
  const below = showError || notice !== null;

  const generate = async () => {
    if (projectId === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.suggestSemanticId(projectId, {
        name: source.trim(),
        kind,
        ...(taken !== undefined && taken.length > 0 ? { taken: [...taken] } : {}),
      });
      onChange(proposalValue(res.id, lockedPrefix));
      setNotice(idSuggestNotice(res, S.semanticId.idSuggest));
    } catch (e) {
      // The request itself failed (offline, no permission, the mode switched off): the id is
      // unchanged and there is nothing to say under the field.
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const input = (
    <Input
      id={controlId}
      size="sm"
      required
      value={value}
      invalid={error !== undefined}
      className={`min-w-0 flex-1 font-mono${lockedPrefix !== undefined ? " rounded-l-none" : ""}`}
      disabled={disabled}
      {...(below ? { "aria-describedby": messageId } : {})}
      onChange={(e) => {
        setNotice(null);
        onChange(e.target.value);
      }}
      {...(onEnter !== undefined
        ? {
            onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter();
              }
            },
          }
        : {})}
    />
  );

  return (
    <div>
      <FieldLabel htmlFor={controlId} required>
        {label}
      </FieldLabel>
      <div className="flex items-center gap-2">
        {lockedPrefix === undefined ? (
          input
        ) : (
          <div className="flex min-w-0 flex-1 items-stretch">
            <span className="flex shrink-0 items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-100 px-2 font-mono text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              {lockedPrefix}
            </span>
            {input}
          </div>
        )}
        {/* The tooltip keeps saying where the id comes from; the label only says who makes it. */}
        <Button
          size="sm"
          title={S.semanticId.generateId}
          aria-busy={busy || undefined}
          disabled={disabled || busy || !derivable || projectId === null}
          onClick={() => void generate()}
          className="shrink-0 whitespace-nowrap"
        >
          {busy ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <GlyphIcon d={SPARKLES_ICON} size={ICON_SIZE.inlineGlyph} />
          )}
          {S.semanticId.generateIdLabel}
        </Button>
      </div>
      {showError ? (
        <FieldError id={messageId}>{error}</FieldError>
      ) : notice?.tone === "attention" ? (
        // A placeholder id: what the user must act on, so it takes the slot the error would.
        // `status` rather than `alert` — the box holds a valid id, nothing was rejected.
        <span id={messageId} role="status" className={`mt-1 block text-xs ${toneInk.attention}`}>
          {notice.text}
        </span>
      ) : (
        <>
          {/* The generation clause carries its own leading separator: what joins two clauses
              is punctuation, and punctuation is part of the language. The id rule stays on
              screen beside a quiet note — it is what the user reads while typing. */}
          <FieldHint>{`${hint}${generateHint ?? S.semanticId.idGenerateHint}`}</FieldHint>
          {notice !== null && (
            <span id={messageId} role="status" className={`mt-1 block text-xs ${toneInk.muted}`}>
              {notice.text}
            </span>
          )}
        </>
      )}
    </div>
  );
}
