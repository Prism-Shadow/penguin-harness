/**
 * Confirmation dialog for destructive or overwriting actions (delete, overwrite-on-update,
 * save-to-file, …), deliberately minimal: **no title bar** — just the tone mark, the message and a
 * small Cancel / Confirm pair, so every confirmation in the app is one compact, identical card.
 * `tone` picks the look — danger for deletions, primary for saves and other overwrites. The
 * message and any details (e.g. a version list) go in children; `title` only names the dialog for
 * assistive tech (never rendered).
 *
 * Both button labels are the caller's copy: what "confirm" means is the action's own verb
 * (Delete, Overwrite, Save), and the app's dictionary owns the Cancel beside it.
 *
 * A dialog may add ONE extra choice (`secondaryLabel` + `onSecondary`) between Cancel and Confirm
 * — for prompts whose recommended path is the confirm button while a plain "do it anyway" escape
 * hatch has to stay one click away (the mid-chat thinking-level switch: compact-then-switch /
 * switch anyway / cancel). It stays the same card: a neutral button in the same row, never a
 * second primary. `confirmDisabled` covers the case where that recommended action is temporarily
 * unavailable — the body then says why, and the other choices stay live.
 */
import type { ReactNode } from "react";
import { Button } from "../../actions/button/button";
import { ICONS } from "../../icons/icons";
import { Modal } from "../modal/modal";

/**
 * The card's leading mark: a warning triangle for danger, a pencil for confirmations that
 * overwrite or save. The tone is carried by the glyph's ink alone, on the same neutral disc for
 * both — an icon never sits in a tint of its own tone.
 */
function ToneMark({ tone }: { tone: "danger" | "primary" }) {
  const glyph =
    tone === "danger"
      ? ICONS.triangleAlert
      : // Pencil-line (lucide): writing changes down.
        "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";
  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-line-muted ${
        tone === "danger" ? "text-tone-danger-fg" : "text-tone-neutral-fg"
      }`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={glyph} />
      </svg>
    </span>
  );
}

export interface ConfirmModalProps {
  open: boolean;
  /** Accessible dialog name only — the compact card renders no title bar. */
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  /** Confirm button text: the action's own verb where it has one, else the app's "Confirm". */
  confirmLabel: string;
  /** Cancel button text, from the app's dictionary. */
  cancelLabel: string;
  /** Disables ONLY the confirm button (its action is temporarily unavailable — the body copy is expected to say why); Cancel and the secondary action stay clickable. */
  confirmDisabled?: boolean;
  /** Optional third choice, rendered as a neutral button between Cancel and Confirm; needs `onSecondary` to appear. */
  secondaryLabel?: string;
  /** Handler for the third choice (the dialog does not close itself — the caller decides, exactly like onConfirm). */
  onSecondary?: () => void;
  /** Confirm button variant: danger for deletions, primary for saves and other overwrites. */
  tone?: "danger" | "primary";
  busy?: boolean;
  children: ReactNode;
}

export function ConfirmModal({
  open,
  title,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel,
  confirmDisabled = false,
  secondaryLabel,
  onSecondary,
  tone = "danger",
  busy = false,
  children,
}: ConfirmModalProps) {
  return (
    <Modal open={open} title={title} onClose={onClose} headerless widthClass="sm:max-w-sm">
      <div className="flex items-start gap-3">
        <ToneMark tone={tone} />
        <div className="min-w-0 flex-1 pt-1.5">{children}</div>
      </div>
      {/* Wraps rather than overflows: three choices with long labels don't fit one row inside
          the bottom-sheet width on a phone (a two-button card never reaches the wrap point). */}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        {secondaryLabel !== undefined && onSecondary !== undefined && (
          <Button size="sm" onClick={onSecondary} disabled={busy}>
            {secondaryLabel}
          </Button>
        )}
        <Button size="sm" variant={tone} disabled={busy || confirmDisabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
