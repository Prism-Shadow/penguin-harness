/** Account shortcuts sit beside suggestions. The editor saves their title and prompt together. */
import { useEffect, useState } from "react";
import {
  Button,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  IconButton,
  ICON_SIZE,
  Input,
  Modal,
  PlusIcon,
  Textarea,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import {
  SHORTCUT_PROMPT_MAX,
  SHORTCUT_TITLE_MAX,
  canAddShortcut,
  defaultShortcutTitle,
  normalizeShortcuts,
  removeShortcut,
  shortcutDraftError,
  upsertShortcut,
  type ShortcutDraft,
  type UserShortcut,
} from "./user-shortcuts";
import { toastApiError } from "../../lib/toast-api-error";

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

/**
 * The create / edit dialog. It opens on the shortcut being edited, or on a new one already
 * filled from the composer — that prefill is where it starts, so closing it untouched asks
 * nothing, and a valid new shortcut can be saved as it stands. Save waits for its write: a
 * refused one leaves the dialog open with what was typed.
 */
function ShortcutDialog({
  opening,
  onClose,
  onSave,
}: {
  opening: ShortcutDraft;
  onClose: () => void;
  onSave: (draft: ShortcutDraft) => Promise<boolean>;
}) {
  const form = useFormDraft(opening, {
    normalize: (d) => ({ id: d.id, title: d.title.trim(), prompt: d.prompt.trim() }),
  });
  const draft = form.draft;
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const editing = draft.id !== null;
  const draftError = shortcutDraftError(draft);
  // A new shortcut is a change on its own; an edit has to change something.
  const canSave = draftError === null && (!editing || form.dirty) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    // On success the host closes the dialog; a refused write leaves the typing as it was.
    if (!(await onSave(draft))) setBusy(false);
  };

  return (
    <Modal
      open
      title={editing ? S.chat.shortcuts.editTitle : S.chat.shortcuts.createTitle}
      onClose={requestClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button size="sm" disabled={busy} onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          size="sm"
          label={S.chat.shortcuts.titleLabel}
          hint={S.chat.shortcuts.titleHint(SHORTCUT_TITLE_MAX)}
          error={
            draftError === "titleTooLong"
              ? S.chat.shortcuts.titleTooLong(SHORTCUT_TITLE_MAX)
              : undefined
          }
          value={draft.title}
          autoFocus
          maxLength={SHORTCUT_TITLE_MAX}
          onChange={(e) => form.patch({ title: e.target.value })}
        />
        <Textarea
          label={S.chat.shortcuts.promptLabel}
          info={S.chat.shortcuts.promptInfo}
          infoLabel={S.common.moreInfoAbout(S.chat.shortcuts.promptLabel)}
          hint={S.chat.shortcuts.promptHint(SHORTCUT_PROMPT_MAX)}
          error={
            draftError === "promptTooLong"
              ? S.chat.shortcuts.promptTooLong(SHORTCUT_PROMPT_MAX)
              : undefined
          }
          value={draft.prompt}
          rows={8}
          size="sm"
          maxLength={SHORTCUT_PROMPT_MAX}
          onChange={(e) => form.patch({ prompt: e.target.value })}
        />
      </div>
    </Modal>
  );
}
