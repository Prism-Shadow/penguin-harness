/**
 * The one discard prompt and the unload guard: mount once at the app root, beside the toasts.
 *
 * Every leave that finds unsaved edits asks through here (`confirmDiscard`), so the app has one
 * card for it: a danger-tone `ConfirmModal`, 「放弃修改」 against 「继续编辑」, and no third
 * choice. Because the card is a `Modal`, it joins the Escape-layer stack above the dialog that
 * asked: Escape answers "keep editing" and leaves that dialog open behind it.
 *
 * While any form is dirty the host also keeps a `beforeunload` listener on the window, so a
 * reload, a closed tab or a closed desktop window asks first, in the browser's own words.
 *
 * The four strings are the app's copy (the package owns no app words); read them from the
 * dictionary at render time.
 */
import { useEffect } from "react";
import { useStore } from "zustand/react";
import { ConfirmModal } from "../../overlays/confirm-modal/confirm-modal";
import { answerDiscard, registerUnsavedHost, unsavedStore, watchUnload } from "./unsaved-changes";

export interface UnsavedChangesHostProps {
  /** The card's accessible name (it draws no title bar). */
  title: string;
  /** The question itself. */
  body: string;
  /** The danger button: discard the edits and leave. */
  discardLabel: string;
  /** The neutral button, and what Escape and a scrim click answer: stay with the edits. */
  keepLabel: string;
}

export function UnsavedChangesHost({
  title,
  body,
  discardLabel,
  keepLabel,
}: UnsavedChangesHostProps) {
  const asking = useStore(unsavedStore, (s) => s.asking);
  useEffect(() => registerUnsavedHost(), []);
  useEffect(() => watchUnload(window), []);
  return (
    <ConfirmModal
      open={asking}
      title={title}
      tone="danger"
      confirmLabel={discardLabel}
      cancelLabel={keepLabel}
      onConfirm={() => answerDiscard(true)}
      onClose={() => answerDiscard(false)}
    >
      <p className="text-sm text-fg-muted">{body}</p>
    </ConfirmModal>
  );
}
