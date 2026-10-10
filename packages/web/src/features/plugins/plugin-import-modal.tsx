/**
 * The Plugins page's import dialog — an admin's: the page shows its button to admins alone, and
 * the server refuses anyone else. A plugin goes on the whole server, shared by every Project, and
 * the dialog says so above its tabs: one per way in, each holding only its own form, its hint and,
 * where installing runs the package's scripts, the line that says so. It opens on npm.
 *
 * - From npm / From a link: a package name, or an https link to a git repository or a tarball
 *   (each checked here the way the server reads it, plugin-import-prompt.ts), installed by the
 *   server itself through the Project's plugin route; what it may cost the runs in progress sits
 *   under the button in small type. A value the tab does not take is said so at the field and
 *   never sent.
 * - Upload a zip: the package directory, what another server's Export downloads. Another version
 *   on the server answers 409, and the replace confirm names both versions.
 * - Ask an agent: anything else — a page, a repository, a description — becomes a prompt
 *   (previewed read-only) for the Project's default Agent, which reviews the package and installs
 *   it with `penguin plugin install`; nothing is sent until the user sends it.
 *
 * The tabs and their fields live in the dialog's body, so every opening starts on the npm tab
 * with nothing typed.
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
  Tabs,
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
  isNpmPluginName,
  isPluginLink,
  readReplaceQuestion,
  type ReplaceQuestion,
} from "./plugin-import-prompt";

const UPLOAD_LABEL_CLASS = buttonClass("secondary", "sm");

/** The dialog's tabs, in order; the first is the one it opens on. */
export const IMPORT_TABS = ["npm", "link", "zip", "agent"] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];
/** The tabs whose source the server installs as it is. */
export type DirectTab = Extract<ImportTab, "npm" | "link">;

/** Whether the npm tab (a package name) or the link tab (an https link) takes `input`. */
export function tabTakes(tab: DirectTab, input: string): boolean {
  return tab === "npm" ? isNpmPluginName(input) : isPluginLink(input);
}

/** The toast for what an install put on the server. */
export function installedToastText(outcome: PluginInstallOutcome): string {
  return outcome.unchanged === true
    ? S.plugins.importUnchangedToast(outcome.name, outcome.version)
    : S.plugins.importedToast(outcome.name, outcome.version);
}

/** What one install from the npm or the link tab came to: installed, or the server's refusal to show. */
export type DirectInstallResult =
  | { kind: "installed"; outcome: PluginInstallOutcome | null }
  | { kind: "refused"; message: string };

/**
 * Installs what the npm or the link tab holds through the Project's plugin route. A value that
 * tab does not take is never sent: the answer is null.
 */
export async function installFromTab(
  projectId: string,
  tab: DirectTab,
  input: string,
): Promise<DirectInstallResult | null> {
  const specifier = input.trim();
  if (!tabTakes(tab, specifier)) return null;
  try {
    const res = await api.installPlugin(projectId, specifier);
    return { kind: "installed", outcome: res.installed ?? null };
  } catch (e) {
    return { kind: "refused", message: apiErrorText(e) };
  }
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

export interface ImportPluginTabsProps {
  projectId: string;
  /** Opens a new chat draft holding the prompt; null when there is no Agent to send it to. */
  onOpenChat: ((text: string) => void) | null;
  /** After an install landed: what the server says it installed (null when it did not), and the name to fall back on. */
  onLanded: (outcome: PluginInstallOutcome | null, fallbackName: string) => void;
}

/** The dialog's body: the server-wide line, then the tabs with the active one's form. */
export function ImportPluginTabs({ projectId, onOpenChat, onLanded }: ImportPluginTabsProps) {
  const [tab, setTab] = useState<ImportTab>(IMPORT_TABS[0]);
  // What each direct tab holds survives a look at another tab.
  const [typed, setTyped] = useState<Record<DirectTab, string>>({ npm: "", link: "" });
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

  const trimmedSource = source.trim();
  const prompt = buildPluginImportPrompt(trimmedSource || S.plugins.importSourceToken, projectId);

  const installDirect = async (from: DirectTab) => {
    if (installing) return;
    setInstalling(true);
    setDirectError(null);
    const result = await installFromTab(projectId, from, typed[from]);
    setInstalling(false);
    if (result?.kind === "installed") onLanded(result.outcome, typed[from].trim());
    else if (result?.kind === "refused") setDirectError(result.message);
  };

  const upload = async (dataBase64: string, overwrite: boolean, fallbackName: string) => {
    setUploading(true);
    setUploadError(null);
    const result = await uploadPluginArchive(projectId, dataBase64, overwrite);
    setUploading(false);
    if (result.kind === "installed") {
      setReplacing(null);
      onLanded(result.outcome, fallbackName);
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

  const directPanel = (from: DirectTab) => {
    const value = typed[from];
    const refused = value.trim() !== "" && !tabTakes(from, value);
    const npm = from === "npm";
    return (
      <>
        <p className="text-xs text-fg-muted">
          {npm ? S.plugins.importNpmWhy : S.plugins.importLinkWhy}
        </p>
        <div className="mt-2.5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              size="sm"
              aria-label={npm ? S.plugins.importNpmLabel : S.plugins.importLinkLabel}
              value={value}
              onChange={(e) => setTyped({ ...typed, [from]: e.target.value })}
              placeholder={npm ? S.plugins.importNpmPlaceholder : S.plugins.importLinkPlaceholder}
              autoComplete="off"
              spellCheck={false}
              {...(refused
                ? { error: npm ? S.plugins.importNpmInvalid : S.plugins.importLinkInvalid }
                : {})}
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            className="shrink-0"
            disabled={!tabTakes(from, value) || installing}
            aria-busy={installing}
            onClick={() => void installDirect(from)}
          >
            {installing ? S.plugins.installing : S.plugins.install}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-fg-muted">{S.plugins.importCost}</p>
        <p className="mt-1 text-xs text-fg-muted">{S.plugins.importScriptsRun}</p>
        {directError !== null && (
          <p className={`mt-1.5 text-xs ${toneInk.danger}`}>{directError}</p>
        )}
      </>
    );
  };

  const zipPanel = (
    <>
      <p className="text-xs text-fg-muted">{S.plugins.importUploadDesc}</p>
      <label
        className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <HiddenFileInput accept=".zip" disabled={uploading} onChange={onPickFile} />
        {uploading ? S.plugins.installing : S.plugins.importUploadAction}
      </label>
      <p className="mt-1.5 text-xs text-fg-muted">{S.plugins.importScriptsRun}</p>
      {uploadError !== null && <p className={`mt-1.5 text-xs ${toneInk.danger}`}>{uploadError}</p>}
    </>
  );

  const agentPanel = (
    <>
      <p className="text-xs text-fg-muted">{S.plugins.importAgentWhy}</p>
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
            onClick={() => promptCopy.flash(buildPluginImportPrompt(trimmedSource, projectId))}
          >
            <CopyCheckGlyph copied={promptCopy.copied} size={12} />
            {S.skills.importCopyPrompt}
          </Button>
          <CopiedStatus copied={promptCopy.copied} />
          <Button
            size="sm"
            variant="primary"
            disabled={trimmedSource === "" || onOpenChat === null}
            onClick={() => onOpenChat?.(buildPluginImportPrompt(trimmedSource, projectId))}
          >
            {S.skills.importOpenChat}
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm">{S.plugins.importServerWide}</p>
      <div>
        <Tabs
          items={IMPORT_TABS.map((key) => ({ key, label: S.plugins.importTabs[key] }))}
          active={tab}
          onChange={(next) => {
            setTab(next);
            setDirectError(null);
          }}
        />
        <div role="tabpanel" aria-label={S.plugins.importTabs[tab]} className="pt-4">
          {tab === "npm" || tab === "link"
            ? directPanel(tab)
            : tab === "zip"
              ? zipPanel
              : agentPanel}
        </div>
      </div>

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
    </div>
  );
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

  const landed = (outcome: PluginInstallOutcome | null, fallbackName: string) => {
    toastSuccess(
      outcome === null
        ? S.plugins.deploymentInstalledToast(fallbackName)
        : installedToastText(outcome),
    );
    onInstalled();
    onClose();
  };

  return (
    <Modal open={open} title={S.plugins.importPlugin} onClose={onClose} widthClass="sm:max-w-lg">
      <ImportPluginTabs
        projectId={projectId}
        onOpenChat={
          agentId === null
            ? null
            : (text) => {
                openAiChat({ agentId, text });
                onClose();
              }
        }
        onLanded={landed}
      />
    </Modal>
  );
}
