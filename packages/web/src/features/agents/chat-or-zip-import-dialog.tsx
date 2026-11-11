/**
 * The import dialog behind the Agent settings Plugins tab's Import menu, one for each kind —
 * Skill, hook package, workbench: the recommended chat import on top, the zip upload below, in
 * two ruled sections. Each kind's dialog (agent-skills.tsx, agent-hooks.tsx,
 * agent-workbenches.tsx) hands in what differs by kind — the title and the words, the prompt
 * builder, the upload call with the code of the 409 that asks before overwriting, and the file
 * type the picker accepts — and the rest is the same for every kind.
 *
 * The chat import takes a source (a web page, a repository, a local path, an install command, a
 * description …) and builds a review-then-import prompt from it, which can be copied or prefilled
 * into a new chat with this Agent, on the machine the Agent lives on. Both are disabled until a
 * source is typed: a blank chat would drop the prompt the dialog just built.
 *
 * The dialog is mounted only while it is open, so every opening starts with nothing typed. The
 * source is its draft under the settings commit model (compared without the spaces around it):
 * closing the dialog with one typed (Esc, the ×, a press outside) asks first, and nothing closes
 * it while an upload is in flight. Opening the chat hands the source over, so the draft is
 * forgotten before the page moves to the conversation.
 */
import { useState, type ChangeEvent } from "react";

import {
  Button,
  ConfirmModal,
  CopiedStatus,
  CopyCheckGlyph,
  HiddenFileInput,
  Input,
  Modal,
  Textarea,
  buttonClass,
  discardUnsaved,
  useCopied,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { useAgentLocation } from "../../lib/agent-location";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { useAiBridge } from "../ai-create";

/** The Button look on the upload `<label>`. */
const UPLOAD_LABEL_CLASS = buttonClass("secondary", "sm");

/**
 * The dialog's words, under the names each kind's dictionary section gives them, so a caller
 * passes its section (`S.skills`, `S.hooks`, `S.workbenches`) as it is. Read at render time.
 */
export interface ChatOrZipImportStrings {
  importChatTitle: string;
  importChatWhy: string;
  importSourceLabel: string;
  importSourceHint: string;
  importSourcePlaceholder: string;
  /** Stands in for the source in the prompt preview until one is typed. */
  importSourceToken: string;
  importPromptLabel: string;
  importCopyPrompt: string;
  importOpenChat: string;
  importUploadTitle: string;
  importUploadDesc: string;
  importUploadAction: string;
  importUploading: string;
  importOverwriteTitle: string;
  importOverwriteBody: (name: string) => string;
  importOverwriteAction: string;
}

/** What an archive upload posts: the zip as base64, and `overwrite` once a 409 was confirmed. */
export interface ArchiveUpload {
  dataBase64: string;
  overwrite?: boolean;
}

/** A zip waiting on the overwrite confirm: the payload to resend with `overwrite`, and the name it would replace. */
interface PendingOverwrite {
  dataBase64: string;
  name: string;
}

/** The name at the end of a 409's message (`Skill is already installed: pdf`), the server's fixed tail. */
function nameAtMessageEnd(error: ApiError): string | undefined {
  return /:\s*([A-Za-z0-9_-]+)$/.exec(error.message)?.[1];
}

export interface ChatOrZipImportDialogProps<T> {
  /** The dialog's title ("Import skill" …). */
  title: string;
  strings: ChatOrZipImportStrings;
  /** The source field takes several lines (a pasted config block) instead of one. */
  multilineSource?: boolean;
  /** The whole prompt for one trimmed source; the preview hands it the placeholder token. */
  buildPrompt: (source: string) => string;
  /** The Agent the chat opens with. */
  agentId: string;
  /** The picker's file type, one extension (".zip"); the picked file's name without it stands in for a name the 409 does not carry. */
  accept: string;
  /** Posts one zip to the Agent's server; resolves to what the import installed. */
  upload: (body: ArchiveUpload) => Promise<T>;
  /** The code of the 409 that asks before overwriting (`skill_exists` …). */
  conflictCode: string;
  /** The name such a 409 names; by default the tail of its message. */
  conflictName?: (error: ApiError) => string | undefined;
  onClose: () => void;
  /** A zip landed: the tab closes the dialog and reads its lists again. */
  onImported: (result: T) => void;
}

export function ChatOrZipImportDialog<T>({
  title,
  strings,
  multilineSource = false,
  buildPrompt,
  agentId,
  accept,
  upload,
  conflictCode,
  conflictName = nameAtMessageEnd,
  onClose,
  onImported,
}: ChatOrZipImportDialogProps<T>) {
  const { openAiChat } = useAiBridge();
  const machineId = useAgentLocation();
  const form = useFormDraft<string>("", { normalize: (text) => text.trim() });
  const source = form.draft;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Non-null shows the overwrite confirm (the archive POST answered 409 `conflictCode`).
  const [overwriting, setOverwriting] = useState<PendingOverwrite | null>(null);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: uploading });

  // The preview substitutes the placeholder token until something is entered.
  const trimmedSource = source.trim();
  const chatPrompt = buildPrompt(trimmedSource || strings.importSourceToken);

  // Copy feedback lives at the button (the shared copy convention): its glyph flips to the check
  // while copied — no toast, and the button label never changes.
  const promptCopy = useCopied();

  /**
   * "Open a new chat" with this Agent: the AI bridge prefills the composer with the generated
   * prompt (parking typed-but-unsent draft text first) and clears a stale handoff target and
   * skill pre-selection along with it. The source goes with the chat, so nothing typed is left
   * to lose: it is forgotten first, or the leave guard would hold the move to the conversation.
   */
  const openChat = () => {
    if (trimmedSource === "") return;
    discardUnsaved(form.scope);
    openAiChat({ agentId, text: buildPrompt(trimmedSource), machineId });
    onClose();
  };

  /**
   * POST the zip. A 409 `conflictCode` pops the overwrite confirm for the name the answer carries
   * (`fallbackName` — the picked file's stem — covers an answer without one). Success hands over
   * to the tab, which closes the dialog and re-fetches its list.
   */
  const send = async (dataBase64: string, fallbackName: string, overwrite: boolean) => {
    setUploading(true);
    setUploadError(null);
    try {
      const result = await upload({ dataBase64, ...(overwrite ? { overwrite: true } : {}) });
      setOverwriting(null);
      onImported(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === conflictCode) {
        setOverwriting({ dataBase64, name: conflictName(e) ?? fallbackName });
      } else {
        setOverwriting(null);
        setUploadError(apiErrorText(e));
      }
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const fallbackName = file.name.toLowerCase().endsWith(accept.toLowerCase())
      ? file.name.slice(0, file.name.length - accept.length)
      : file.name;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      void send(dataUrl.slice(dataUrl.indexOf(",") + 1), fallbackName, false); // strip the data:...;base64, prefix
    };
    reader.onerror = () => setUploadError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <>
      <Modal open title={title} onClose={requestClose} widthClass="sm:max-w-lg">
        <div className="space-y-4">
          <section>
            <p className="text-sm font-medium">{strings.importChatTitle}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {strings.importChatWhy}
            </p>
            <div className="mt-2.5 space-y-3">
              {multilineSource ? (
                <Textarea
                  label={strings.importSourceLabel}
                  hint={strings.importSourceHint}
                  size="sm"
                  rows={3}
                  value={source}
                  onChange={(e) => form.setDraft(e.target.value)}
                  placeholder={strings.importSourcePlaceholder}
                />
              ) : (
                <Input
                  size="sm"
                  label={strings.importSourceLabel}
                  hint={strings.importSourceHint}
                  value={source}
                  onChange={(e) => form.setDraft(e.target.value)}
                  placeholder={strings.importSourcePlaceholder}
                  autoComplete="off"
                />
              )}
              <Textarea
                label={strings.importPromptLabel}
                size="sm"
                rows={5}
                readOnly
                value={chatPrompt}
                className="text-gray-600 dark:text-gray-300"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={trimmedSource === ""}
                  onClick={() => promptCopy.flash(buildPrompt(trimmedSource))}
                >
                  <CopyCheckGlyph copied={promptCopy.copied} size={12} />
                  {strings.importCopyPrompt}
                </Button>
                <CopiedStatus copied={promptCopy.copied} />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={trimmedSource === ""}
                  onClick={openChat}
                >
                  {strings.importOpenChat}
                </Button>
              </div>
            </div>
          </section>

          <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <p className="text-sm font-medium">{strings.importUploadTitle}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {strings.importUploadDesc}
            </p>
            <label
              className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept={accept} disabled={uploading} onChange={onPickFile} />
              {uploading ? strings.importUploading : strings.importUploadAction}
            </label>
            {uploadError && <p className={`mt-1.5 text-xs ${toneInk.danger}`}>{uploadError}</p>}
          </section>
        </div>
      </Modal>

      {/* Overwrite confirmation: the import modal stays underneath, so cancel returns to it; confirm resends the same zip with overwrite: true. */}
      <ConfirmModal
        open={overwriting !== null}
        title={strings.importOverwriteTitle}
        tone="primary"
        confirmLabel={strings.importOverwriteAction}
        cancelLabel={S.common.cancel}
        busy={uploading}
        onClose={() => setOverwriting(null)}
        onConfirm={() => {
          if (overwriting !== null) void send(overwriting.dataBase64, overwriting.name, true);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {overwriting !== null ? strings.importOverwriteBody(overwriting.name) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
