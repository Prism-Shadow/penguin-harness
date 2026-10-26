/**
 * The archive receipt: what the page says right after a conversation is archived.
 *
 * Archiving used to be a silent side effect: the row left the sidebar and nothing else
 * happened, so a conversation filed away by accident was simply gone — the way back lived
 * two menus deep (Settings › Personal › Archived chats). The receipt closes that gap: it
 * names the conversation that was archived and offers the two ways back — **Undo** (the
 * conversation returns to the sidebar at once) and **View archived** (the archive page,
 * one click from the nav).
 *
 * - One receipt at a time, in the bottom-right corner: archiving a second conversation
 *   replaces the first one's receipt and restarts its clock. The receipt leaves by itself
 *   after a few seconds; the undo it offers stays useful while it is there.
 * - The undo is a second PATCH (archived: false) — the same write the archive page's own
 *   restore does — and the sessions store is told about the answer, so the row comes back
 *   where it was instead of waiting for the next list refresh.
 * - The store is module-level (like the UI package's toasts): raising a receipt needs no
 *   context, and the host reads it.
 */
import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import { useNavigate } from "react-router";
import { Button, GlyphIcon, ICONS, ICON_SIZE, toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { useSessions } from "../../state/sessions";

/** What the receipt is about: the conversation, and the title it was filed under. */
export interface ArchiveReceipt {
  sessionId: string;
  title: string;
}

/** How long the receipt stays on its own, ms. Long enough to undo, short enough to go. */
export const ARCHIVE_RECEIPT_MS = 8000;

interface ReceiptState {
  receipt: ArchiveReceipt | null;
  /** Bumped on every raise, so a second archive restarts the first one's clock. */
  seq: number;
}

export const archiveReceiptStore = createStore<ReceiptState>(() => ({ receipt: null, seq: 0 }));

/** Raise the receipt for a conversation just archived. */
export function showArchiveReceipt(receipt: ArchiveReceipt): void {
  archiveReceiptStore.setState((s) => ({ receipt, seq: s.seq + 1 }));
}

/** Take the receipt down (the clock ran out, or the user acted on it). */
export function dismissArchiveReceipt(): void {
  archiveReceiptStore.setState((s) => ({ receipt: null, seq: s.seq }));
}

/**
 * The archive page's address for a conversation: the page with its title query, so it opens
 * on that one row instead of on the whole archive. The title is carried as a query value, so
 * whatever it holds — spaces, punctuation, CJK — survives the round trip.
 */
export function archivedPageUrl(title: string): string {
  return `/archived?q=${encodeURIComponent(title)}`;
}

/**
 * The receipt itself, mounted once beside the app shell: a small bordered card in the
 * bottom-right corner with the conversation's name and the two ways back.
 */
export function ArchiveReceiptHost() {
  const receipt = useStore(archiveReceiptStore, (s) => s.receipt);
  const seq = useStore(archiveReceiptStore, (s) => s.seq);
  const navigate = useNavigate();
  const { replace } = useSessions();

  // The clock restarts whenever a new receipt is raised.
  useEffect(() => {
    if (receipt === null) return;
    const timer = setTimeout(() => dismissArchiveReceipt(), ARCHIVE_RECEIPT_MS);
    return () => clearTimeout(timer);
  }, [receipt, seq]);

  if (receipt === null) return null;

  /** Put the conversation back where it was: the same write the archive page's restore does. */
  const undo = async () => {
    const target = receipt;
    dismissArchiveReceipt();
    try {
      const res = await api.patchSession(target.sessionId, { archived: false });
      replace(res.session);
      toastSuccess(S.chat.archiveReceipt.undone);
    } catch (e) {
      toastError(S.chat.archiveReceipt.undoFailed(apiErrorText(e)));
    }
  };

  const viewArchived = () => {
    dismissArchiveReceipt();
    // The archive page carries the conversation's title, so it opens on that one row
    // instead of on the whole archive.
    navigate(archivedPageUrl(receipt.title));
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] w-[min(22rem,calc(100vw-2rem))]">
      {/* A polite live region, like the toast stack: the receipt is a notice, and a reader
          should hear that something was filed away (and that it can be undone). */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-overlay p-3 shadow-lg"
      >
        <GlyphIcon
          d={ICONS.archive}
          size={ICON_SIZE.rowLead}
          className="mt-0.5 shrink-0 text-fg-muted"
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm text-fg">{S.chat.archiveReceipt.archived(receipt.title)}</p>
          <div className="mt-2 flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void undo()}>
              {S.chat.archiveReceipt.undo}
            </Button>
            <Button size="sm" variant="ghost" onClick={viewArchived}>
              {S.chat.archiveReceipt.view}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
