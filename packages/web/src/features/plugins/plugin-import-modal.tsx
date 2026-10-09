/**
 * The Plugins page's import dialog — an admin's: the page shows its button to admins alone, and
 * the server refuses anyone else. A plugin goes on the whole server, shared by every Project, and
 * the dialog says so before anything else. The Skills tab's import, in a plugin's words:
 *
 * - Install from npm or a link: a package name or an https link (checked here the way the server
 *   checks it, plugin-import-prompt.ts) is installed by the server itself, through the Project's
 *   plugin route; what it may cost the runs in progress sits under the button in small type.
 *   Beneath it, anything else — a page, a repository, a description — becomes a prompt
 *   (previewed read-only) for the Project's default Agent, which reviews the package and installs
 *   it with `penguin plugin install`; nothing is sent until the user sends it.
 * - Upload a plugin zip: the package directory, what another server's Export downloads. Another
 *   version on the server answers 409, and the replace confirm names both versions.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import type { PluginInstallOutcome } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  CopiedStatus,
  CopyCheckGlyph,
  HiddenFileInput,
  ICONS,
  Input,
  Modal,
  Textarea,
  buttonClass,
  toastSuccess,
  useCopied,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { useAiBridge } from "../ai-create";
import {
  buildPluginImportPrompt,
  isDirectPluginSource,
  readReplaceQuestion,
  type ReplaceQuestion,
} from "./plugin-import-prompt";

const UPLOAD_LABEL_CLASS = buttonClass("secondary", "sm");

/** The toast for what an install put on the server. */
export function installedToastText(outcome: PluginInstallOutcome): string {
  return outcome.unchanged === true
    ? S.plugins.importUnchangedToast(outcome.name, outcome.version)
    : S.plugins.importedToast(outcome.name, outcome.version);
}

/** What one zip upload came to: installed, a question about replacing another version, or a refusal to show. */
export type PluginUploadResult =
  | { kind: "installed"; outcome: PluginInstallOutcome | null }
  | { kind: "replace"; question: ReplaceQuestion }
  | { kind: "refused"; message: string };

/** Posts one zip to the import route and reads the answer (the 409's question from its message). */
export async function uploadPluginArchive(
  projectId: string,
  dataBase64: string,
  overwrite: boolean,
): Promise<PluginUploadResult> {
  try {
    const res = await api.importPluginArchive(projectId, {
      dataBase64,
      ...(overwrite ? { overwrite: true } : {}),
    });
    return { kind: "installed", outcome: res.installed ?? null };
  } catch (e) {
    const question =
      e instanceof ApiError && e.status === 409 && e.code === "plugin_exists"
        ? readReplaceQuestion(e.message)
        : null;
    return question !== null
      ? { kind: "replace", question }
      : { kind: "refused", message: apiErrorText(e) };
  }
}

export interface ImportPluginModalProps {
  open: boolean;
  projectId: string;
  /** The Agent the chat path opens a draft with — the Project's default; null leaves the path disabled. */
  agentId: string | null;
  onClose: () => void;
  /** After an install landed: the page reads the library and the Project's list again. */
  onInstalled: () => void;
}

export function ImportPluginModal({
  open,
  projectId,
  agentId,
  onClose,
  onInstalled,
}: ImportPluginModalProps) {
  const { openAiChat } = useAiBridge();
  const [specifier, setSpecifier] = useState("");
  const [installing, setInstalling] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Non-null shows the replace confirm (the upload answered 409 plugin_exists).
  const [replacing, setReplacing] = useState<{
    dataBase64: string;
    question: ReplaceQuestion;
  } | null>(null);
  // Copy feedback lives at the button: its glyph flips to the check while copied.
  const promptCopy = useCopied();

  const trimmedSpecifier = specifier.trim();
  const direct = isDirectPluginSource(trimmedSpecifier);
  const trimmedSource = source.trim();
  const prompt = buildPluginImportPrompt(trimmedSource || S.plugins.importSourceToken, projectId);

  const landed = (outcome: PluginInstallOutcome | null, fallbackName: string) => {
    toastSuccess(
      outcome === null
        ? S.plugins.deploymentInstalledToast(fallbackName)
        : installedToastText(outcome),
    );
    onInstalled();
    onClose();
  };

  const installDirect = async () => {
    if (!direct || installing) return;
    setInstalling(true);
    setDirectError(null);
    try {
      const res = await api.installPlugin(projectId, trimmedSpecifier);
      landed(res.installed ?? null, trimmedSpecifier);
    } catch (e) {
      setDirectError(apiErrorText(e));
    } finally {
      setInstalling(false);
    }
  };

  const openChat = () => {
    if (trimmedSource === "" || agentId === null) return;
    openAiChat({ agentId, text: buildPluginImportPrompt(trimmedSource, projectId) });
    onClose();
  };

  const upload = async (dataBase64: string, overwrite: boolean, fallbackName: string) => {
    setUploading(true);
    setUploadError(null);
    const result = await uploadPluginArchive(projectId, dataBase64, overwrite);
    setUploading(false);
    if (result.kind === "installed") {
      setReplacing(null);
      landed(result.outcome, fallbackName);
    } else if (result.kind === "replace") {
      setReplacing({ dataBase64, question: result.question });
    } else {
      setReplacing(null);
      setUploadError(result.message);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const fallbackName = file.name.replace(/\.zip$/i, "");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the `data:…;base64,` prefix.
      void upload(dataUrl.slice(dataUrl.indexOf(",") + 1), false, fallbackName);
    };
    reader.onerror = () => setUploadError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <>
      <Modal open={open} title={S.plugins.importPlugin} onClose={onClose} widthClass="sm:max-w-lg">
        <div className="space-y-4">
          <p className="text-sm">{S.plugins.importServerWide}</p>
          <section>
            <p className="text-sm font-medium">{S.plugins.importDirectTitle}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{S.plugins.importDirectWhy}</p>
            <div className="mt-2.5 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  size="sm"
                  aria-label={S.plugins.importSpecifierLabel}
                  value={specifier}
                  onChange={(e) => setSpecifier(e.target.value)}
                  placeholder={S.plugins.importSpecifierPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  {...(trimmedSpecifier !== "" && !direct
                    ? { error: S.plugins.importSpecifierInvalid }
                    : {})}
                />
              </div>
              <Button
                size="sm"
                variant="primary"
                className="shrink-0"
                disabled={!direct || installing}
                aria-busy={installing}
                onClick={() => void installDirect()}
              >
                {installing ? S.plugins.installing : S.plugins.install}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-fg-muted">{S.plugins.importCost}</p>
            {directError !== null && (
              <p className={`mt-1.5 text-xs ${toneInk.danger}`}>{directError}</p>
            )}

            <p className="mt-4 text-sm font-medium">{S.plugins.importAgentTitle}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{S.plugins.importAgentWhy}</p>
            <div className="mt-2.5 space-y-3">
              <Input
                size="sm"
                label={S.plugins.importSourceLabel}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={S.plugins.importSourcePlaceholder}
                autoComplete="off"
              />
              <Textarea
                label={S.plugins.importPromptLabel}
                size="sm"
                rows={5}
                readOnly
                value={prompt}
                className="text-gray-600 dark:text-gray-300"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={trimmedSource === ""}
                  onClick={() =>
                    promptCopy.flash(buildPluginImportPrompt(trimmedSource, projectId))
                  }
                >
                  <CopyCheckGlyph copied={promptCopy.copied} size={12} />
                  {S.skills.importCopyPrompt}
                </Button>
                <CopiedStatus copied={promptCopy.copied} />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={trimmedSource === "" || agentId === null}
                  onClick={openChat}
                >
                  {S.skills.importOpenChat}
                </Button>
              </div>
            </div>
          </section>

          <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <p className="text-sm font-medium">{S.plugins.importUploadTitle}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{S.plugins.importUploadDesc}</p>
            <label
              className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept=".zip" disabled={uploading} onChange={onPickFile} />
              {uploading ? S.plugins.installing : S.plugins.importUploadAction}
            </label>
            {uploadError !== null && (
              <p className={`mt-1.5 text-xs ${toneInk.danger}`}>{uploadError}</p>
            )}
          </section>
        </div>
      </Modal>

      {/* Replace confirm: the import dialog stays beneath, so cancel returns to it; confirm
          sends the same zip again with overwrite. */}
      <ConfirmModal
        open={replacing !== null}
        title={S.plugins.replaceTitle}
        tone="primary"
        glyph={ICONS.download}
        confirmLabel={S.plugins.replaceAction}
        cancelLabel={S.common.cancel}
        busy={uploading}
        onClose={() => setReplacing(null)}
        onConfirm={() => {
          if (replacing !== null) {
            void upload(replacing.dataBase64, true, replacing.question.name);
          }
        }}
      >
        <div className="space-y-2 text-sm">
          <p>
            {replacing !== null
              ? S.plugins.replaceBody(
                  replacing.question.name,
                  replacing.question.installed,
                  replacing.question.incoming,
                )
              : ""}
          </p>
          <p className="text-xs text-fg-muted">{S.plugins.importCost}</p>
        </div>
      </ConfirmModal>
    </>
  );
}
