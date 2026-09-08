/**
 * The id field both create dialogs wear — an organization's and a channel's. The id is still
 * required and still validated by the caller (the two have different rules and different
 * error copy), but it no longer has to be invented: the field carries a "generate" button
 * that asks the server to propose one from the display name (or, when nothing else names the
 * thing yet, from the mission), which is why the name is the field above it.
 *
 * The proposal REPLACES whatever is in the box: the button is pressed to get an id, not to
 * get a suggestion beside the one already typed. It is unavailable while there is no text to
 * derive from and while a request is in flight, and a name a proposal cannot be derived from
 * (a name with no ASCII in it, when no model is configured) answers 422 and says so under
 * the field rather than in a toast that would be gone by the time the user looks down.
 *
 * The button sits INSIDE the box rather than beside it, and outside the field's `<label>`:
 * a `<button>` is a labelable element, so a wrapping label would name the button instead of
 * the input (the trap field.tsx documents). Hence the label row and the hint are drawn here
 * and the `Input` renders bare.
 */
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SemanticIdSuggestRequest } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Input } from "../../components/ui/input";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { toastError } from "../../components/ui/toast";
import { GlyphIcon } from "../../components/ui/glyph-icon";

/** Generate (lucide sparkles): the four-pointed star with its two smaller companions. */
const SPARKLES_ICON =
  "m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275zM5 3v4M19 17v4M3 5h4M17 19h4";

/** The failure that is the user's to resolve, not a transient one: no id can be derived from this name. */
const NOT_DERIVABLE = "id_not_derivable";

export function SemanticIdField({
  projectId,
  kind,
  label,
  hint,
  value,
  source,
  taken,
  error,
  disabled = false,
  onChange,
  onEnter,
}: {
  projectId: string;
  /** What the id is for; the server's proposal is shaped by it. */
  kind: SemanticIdSuggestRequest["kind"];
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
  disabled?: boolean;
  onChange: (id: string) => void;
  /** Enter inside the field, where the dialog submits on it. */
  onEnter?: () => void;
}) {
  const controlId = useId();
  const errorId = `${controlId}-message`;
  const [busy, setBusy] = useState(false);
  /** What the last generation attempt has to say, cleared by the next edit or attempt. */
  const [notice, setNotice] = useState<string | null>(null);
  const derivable = source.trim() !== "";
  // The caller's validation outranks the generation's own message: a rejected id is about
  // what is in the box, which is what the user is looking at.
  const message = error ?? notice;

  const generate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.suggestSemanticId(projectId, {
        name: source.trim(),
        kind,
        ...(taken !== undefined && taken.length > 0 ? { taken: [...taken] } : {}),
      });
      onChange(res.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === NOT_DERIVABLE) setNotice(S.company.idNotDerivable);
      else toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <FieldLabel htmlFor={controlId} required>
        {label}
      </FieldLabel>
      <div className="relative">
        <Input
          id={controlId}
          size="sm"
          required
          value={value}
          invalid={error !== undefined}
          className="pr-7 font-mono"
          disabled={disabled}
          {...(message !== null ? { "aria-describedby": errorId } : {})}
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
        <button
          type="button"
          title={S.company.generateId}
          aria-label={S.company.generateId}
          aria-busy={busy || undefined}
          disabled={disabled || busy || !derivable}
          onClick={() => void generate()}
          className="absolute inset-y-0 right-1 my-auto flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          {busy ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <GlyphIcon d={SPARKLES_ICON} size={ICON_SIZE.iconButton} />
          )}
        </button>
      </div>
      {message !== null ? (
        <FieldError id={errorId}>{message}</FieldError>
      ) : (
        // The generation clause carries its own leading separator: what joins two clauses is
        // punctuation, and punctuation is part of the language.
        <FieldHint>{`${hint}${S.company.idGenerateHint}`}</FieldHint>
      )}
    </div>
  );
}
