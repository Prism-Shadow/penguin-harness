import {
  Pill,
  Button,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import { formatDateTime } from "@prismshadow/penguin-web/internal";
import { programSource } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";


export function ArchivedSessionStub({
  session,
  onUnarchived,
  onDeleted,
}: {
  session: SessionInfo;
  /** The row the unarchive answered with: the page swaps it in and shows the conversation. */
  onUnarchived: (session: SessionInfo) => void;
  /** The Session is gone: the page leaves its URL. */
  onDeleted: (session: SessionInfo) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const title = session.title ?? S.chat.defaultSessionTitle;
  // Who opened it, in the archive page's words: the program, or a person (「用户」).
  const source = programSource(session) ?? "user";

  const unarchive = async () => {
    setBusy(true);
    try {
      const res = await api.patchSession(session.sessionId, { archived: false });
      onUnarchived(res.session);
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteSession(session.sessionId);
      setConfirming(false);
      onDeleted(session);
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <GlyphIcon d={ICONS.archive} size={ICON_SIZE.sectionMark} className="text-fg-subtle" />
        <h2 className="max-w-full break-words text-base font-semibold text-fg">{title}</h2>
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span>{formatDateTime(session.lastActiveAt)}</span>
          <span aria-hidden>·</span>
          <Pill tone="neutral">{S.chat.sessionSource[source]}</Pill>
        </p>
        <p className="text-sm text-fg-muted">{S.chat.archivedStub.note}</p>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void unarchive()}>
            {S.chat.unarchiveSession}
          </Button>
          <button
            type="button"
            data-tooltip={S.common.delete}
            aria-label={S.chat.deleteSession}
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="flex h-8 w-8 items-center justify-center text-fg-subtle transition-colors duration-150 hover:text-fg disabled:opacity-60"
          >
            <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
          </button>
        </div>
      </div>
      <ConfirmModal
        open={confirming}
        title={S.chat.deleteSession}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirming(false))}
        onConfirm={() => void remove()}
      >
        <p className="text-sm text-fg-muted">{S.chat.deleteSessionConfirm(title)}</p>
      </ConfirmModal>
    </div>
  );
}
