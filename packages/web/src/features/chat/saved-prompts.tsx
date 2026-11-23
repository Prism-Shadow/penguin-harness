/** Account shortcuts sit beside suggestions. The editor saves their title and prompt together. */
import { useEffect, useState } from "react";
import {
  Button,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  IconButton,
  ICON_SIZE,
  Modal,
  PlusIcon,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import {
  canAddShortcut,
  defaultShortcutTitle,
  normalizeShortcuts,
  removeShortcut,
  upsertShortcut,
  type ShortcutDraft,
  type UserShortcut,
} from "./user-shortcuts";
import { toastApiError } from "../../lib/toast-api-error";

import { ShortcutDialog } from "./shortcut-dialog";

export function SavedPrompts({
  exampleText,
  readComposerText,
  onFill,
}: {
  exampleText?: string | null;
  /** The composer's current text, read at click time — a new shortcut starts from what was typed. */
  readComposerText: () => string;
  /** Hand the saved prompt to the composer. Pins no Skills; see user-shortcuts.ts. */
  onFill: (prompt: string) => void;
}) {
  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  /** Until the stored list has arrived the body stays blank: the empty state must not flash first. */
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState<ShortcutDraft | null>(null);
  const [deleting, setDeleting] = useState<UserShortcut | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (!cancelled) {
          setShortcuts(normalizeShortcuts(res.prefs.draftShortcuts));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [readAttempt]);

  const [deletePending, setDeletePending] = useState(false);
  const confirmDelete = async () => {
    if (deleting === null || deletePending) return;
    const next = removeShortcut(shortcuts, deleting.id);
    setDeletePending(true);
    try {
      await api.putPrefs({ draftShortcuts: next });
      setShortcuts(next);
      setDeleting(null);
    } catch (error) {
      toastApiError(error);
    } finally {
      setDeletePending(false);
    }
  };

  const startCreate = () => {
    // The high-value path: whatever is already in the composer becomes the body of the new
    // shortcut, with its first line suggested as the name. Both fields stay editable.
    const text = readComposerText().trim();
    setDraft({ id: null, title: defaultShortcutTitle(text), prompt: text });
  };

  /** The dialog's write: resolves with whether it landed; the list changes only once it has. */
  const saveDraft = async (next: ShortcutDraft): Promise<boolean> => {
    const list = upsertShortcut(shortcuts, next);
    try {
      await api.putPrefs({ draftShortcuts: list });
    } catch (e) {
      toastApiError(e);
      return false;
    }
    setShortcuts(list);
    setDraft(null);
    return true;
  };

  return (
    <>
      {shortcuts.map((shortcut) => (
        <Button
          key={shortcut.id}
          size="sm"
          className="min-h-9 max-w-full"
          data-slot="saved-prompt"
          aria-current={shortcut.prompt === exampleText || undefined}
          title={shortcut.prompt}
          onClick={() => onFill(shortcut.prompt)}
          leading={
            <GlyphIcon
              d={shortcut.prompt === exampleText ? ICONS.check : ICONS.zap}
              size={ICON_SIZE.inlineGlyph}
            />
          }
        >
          <span className="min-w-0 truncate">{shortcut.title}</span>
        </Button>
      ))}
      {readFailed && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setReadFailed(false);
            setReadAttempt((attempt) => attempt + 1);
          }}
        >
          {S.chat.shortcuts.retry}
        </Button>
      )}
      {loaded && (
        <Button
          size="sm"
          variant="ghost"
          className="min-h-9"
          leading={
            shortcuts.length ? (
              <GlyphIcon d={ICONS.pencil} size={ICON_SIZE.inlineGlyph} />
            ) : (
              <PlusIcon size={ICON_SIZE.inlineGlyph} />
            )
          }
          onClick={() => (shortcuts.length ? setManaging(true) : startCreate())}
        >
          {shortcuts.length ? S.chat.shortcuts.manage : S.chat.shortcuts.new}
        </Button>
      )}
      <Modal
        open={managing}
        title={S.chat.shortcuts.manage}
        widthClass="sm:max-w-md"
        onClose={() => setManaging(false)}
      >
        <ul>
          {shortcuts.map((shortcut) => (
            <li key={shortcut.id} className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 break-words">{shortcut.title}</span>
              <IconButton
                label={S.common.edit}
                variant="ghost"
                onClick={() => {
                  setManaging(false);
                  setDraft({ ...shortcut });
                }}
              >
                <GlyphIcon d={ICONS.pencil} size={ICON_SIZE.rowLead} />
              </IconButton>
              <IconButton
                label={S.common.delete}
                variant="ghost"
                onClick={() => {
                  setManaging(false);
                  setDeleting(shortcut);
                }}
              >
                <GlyphIcon d={ICONS.trash} size={ICON_SIZE.rowLead} />
              </IconButton>
            </li>
          ))}
        </ul>
        {canAddShortcut(shortcuts) && (
          <Button
            className="mt-2"
            size="sm"
            leading={<PlusIcon size={ICON_SIZE.inlineGlyph} />}
            onClick={() => {
              setManaging(false);
              startCreate();
            }}
          >
            {S.chat.shortcuts.new}
          </Button>
        )}
      </Modal>
      {/* Create and edit share one dialog — the fields and the rules are identical, and only the
          dialog's name says which one is happening (the same Modal + Input idiom as the sidebar's
          rename dialogs). Mounted per opening, so it starts from what it was opened with. */}
      {draft !== null && (
        <ShortcutDialog opening={draft} onClose={() => setDraft(null)} onSave={saveDraft} />
      )}

      <ConfirmModal
        open={deleting !== null}
        title={S.chat.shortcuts.deleteTitle}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={deletePending}
        onClose={() => {
          if (!deletePending) setDeleting(null);
        }}
        onConfirm={() => void confirmDelete()}
      >
        <p className="text-sm text-fg-muted">
          {deleting !== null ? S.chat.shortcuts.deleteConfirm(deleting.title) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
