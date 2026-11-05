/**
 * The 「详细配置」 / "Details" fold of the two model dialogs (add model, model settings), and the
 * rules for what it holds — kept apart from the page so they are checked without a DOM.
 *
 * Both dialogs fold the fields a model rarely changes after it is set up: the context window and
 * the max output length, the three prices, vision with its Detect, and fast mode. The add dialog
 * shows by default only what names the model — its id, display name and group — and also folds
 * the connection overrides (API key, base URL with its protocol and Detect) and the connectivity
 * test: a new model follows its group's connection, so those are overrides. The settings dialog
 * keeps the API key and base URL in view.
 *
 * The fold starts closed every time a dialog opens; nothing remembers it. The dialog's Save stays
 * disabled while a field is wrong, so a wrong field inside the closed fold opens it: Save is never
 * held back by an error the reader cannot see.
 */
import { useId } from "react";
import type { ReactNode } from "react";
import { Chevron, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** A block of a model dialog below its identity fields. */
export type ModelDialogSlot =
  /** The row of model actions: the connectivity test (and, on a saved model, default / vision / remove). */
  | "actions"
  | "apiKey"
  | "baseUrl"
  /** Context window and max output length. */
  | "limits"
  | "pricing"
  /** Vision with its Detect, and fast mode. */
  | "capabilities";

/** The blocks in the order the dialog shows them, wherever each is placed. */
export const MODEL_DIALOG_SLOTS: readonly ModelDialogSlot[] = [
  "actions",
  "apiKey",
  "baseUrl",
  "limits",
  "pricing",
  "capabilities",
];

/** A field the dialog validates, in the order the dialog shows them. */
export type ModelDialogField =
  "modelId" | "baseUrl" | "contextWindow" | "maxTokens" | "cacheRead" | "cacheWrite" | "output";

const FIELD_ORDER: readonly ModelDialogField[] = [
  "modelId",
  "baseUrl",
  "contextWindow",
  "maxTokens",
  "cacheRead",
  "cacheWrite",
  "output",
];

/** Where each validated field sits; the model id is an identity field, never folded. */
const FIELD_SLOT: Readonly<Record<ModelDialogField, ModelDialogSlot | null>> = {
  modelId: null,
  baseUrl: "baseUrl",
  contextWindow: "limits",
  maxTokens: "limits",
  cacheRead: "pricing",
  cacheWrite: "pricing",
  output: "pricing",
};

/** The blocks inside the fold: the add dialog folds the connection and the test as well. */
export function foldedSlots(isNew: boolean): ReadonlySet<ModelDialogSlot> {
  return new Set<ModelDialogSlot>(
    isNew
      ? ["actions", "apiKey", "baseUrl", "limits", "pricing", "capabilities"]
      : ["limits", "pricing", "capabilities"],
  );
}

/**
 * The fields with an error that sit inside the fold, in the dialog's order. The dialog opens the
 * fold whenever this list gains a field, so the reason Save is disabled is on screen.
 */
export function foldedErrors(
  errors: Partial<Record<ModelDialogField, string>>,
  isNew: boolean,
): ModelDialogField[] {
  const folded = foldedSlots(isNew);
  return FIELD_ORDER.filter((field) => {
    if (errors[field] === undefined) return false;
    const slot = FIELD_SLOT[field];
    return slot !== null && folded.has(slot);
  });
}

/**
 * The fold itself: a ruled row naming itself, with the app's one collapse chevron, over a panel
 * that stays in the DOM and is `hidden` while closed (the WAI-ARIA disclosure pattern, so its
 * `aria-controls` always resolves). Inline flow — no portal. The open state is the dialog's.
 */
export function DetailsFold({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <div className="border-t border-gray-200 pt-2 dark:border-gray-800">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={`flex items-center ${ICON_GAP.tight} rounded-sm text-xs font-semibold text-gray-600 transition-colors duration-150 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100`}
      >
        <Chevron open={open} size={ICON_SIZE.chevronDense} />
        {S.models.details}
      </button>
      <div id={panelId} hidden={!open} className="space-y-3 pt-3">
        {children}
      </div>
    </div>
  );
}
