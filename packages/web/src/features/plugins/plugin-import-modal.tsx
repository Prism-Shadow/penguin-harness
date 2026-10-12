/**
 * The Plugins page's import dialog — an admin's: the page shows its button to admins alone, and
 * the server refuses anyone else. A plugin goes on the whole server, shared by every Project, and
 * the dialog says so above its tabs: one per way in, each holding only its own form, its hint,
 * where installing runs the package's scripts, the line that says so, and the line saying what a
 * plugin's MCP servers are (a command run on this server, or an address it connects to). It
 * opens on npm.
 *
 * - From npm / From a link: a package name, or an https link to a git repository or a tarball
 *   (each checked here the way the server reads it, plugin-import-prompt.ts), installed by the
 *   server itself through the Project's plugin route; what it may cost the runs in progress sits
 *   under the button in small type. A value the tab does not take is said so at the field and
 *   never sent. A link to a folder or a file inside a repository, which npm cannot install, is
 *   said so with an "Ask an agent" action under the field: it moves to the agent tab with the
 *   link as the source.
 * - Upload a zip: the package directory, what another server's Export downloads. Another version
 *   on the server answers 409, and the replace confirm names both versions.
 * - Ask an agent: anything else — a page, a repository or a folder in one, a Codex or Claude Code
 *   plugin, a description — becomes a prompt (previewed read-only) for the Project's default
 *   Agent, which reviews the source, ports it into a PenguinHarness package first when it is not
 *   one (the `plugin-porting` skill), and installs it with `penguin plugin install`; nothing is
 *   sent until the user sends it.
 *
 * The tabs and their fields live in the dialog's body, so every opening starts on the npm tab
 * with nothing typed; the body can be opened on another tab holding a value instead, the state
 * the link tab's hand-off leaves it in.
 *
 * What the three fields hold is the dialog's draft under the settings commit model: a look at
 * another tab keeps it, and closing the dialog with anything typed (Esc, the ×, a press outside)
 * asks first. Nothing closes it while an install or an upload is in flight. Opening the chat
 * hands the source over, so the draft is forgotten before the page moves to the conversation.
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
  discardUnsaved,
  toastSuccess,
  useCopied,
  useFormDraft,
  useGuardedClose,
  useSaving,
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
  isRepoSubpathLink,
  readReplaceQuestion,
  type ReplaceQuestion,
} from "./plugin-import-prompt";

const UPLOAD_LABEL_CLASS = buttonClass("secondary", "sm");

/** The import dialog's typed fields: what its close asks about, and what an install in flight holds. */
const PLUGIN_IMPORT_SCOPE = "plugin-import";

/** The dialog's draft: the npm and the link tab's values, and the agent tab's source. */
interface ImportDraft {
  npm: string;
  link: string;
  source: string;
}

/** What the fields hold as the dialog reads them: without the spaces around them. */
const trimmedDraft = (draft: ImportDraft): ImportDraft => ({
  npm: draft.npm.trim(),
  link: draft.link.trim(),
  source: draft.source.trim(),
});

/** The dialog's tabs, in order; the first is the one it opens on. */
export const IMPORT_TABS = ["npm", "link", "zip", "agent"] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];
/** The tabs whose source the server installs as it is. */
export type DirectTab = Extract<ImportTab, "npm" | "link">;

/** Whether the npm tab (a package name) or the link tab (an https link) takes `input`. */
export function tabTakes(tab: DirectTab, input: string): boolean {
  return tab === "npm" ? isNpmPluginName(input) : isPluginLink(input);
}

/**
 * What the link field says of `input`: nothing (null) while it is empty or a link the tab takes;
 * `subpath` for a folder or a file inside a repository, which an Agent can port instead; and
 * `invalid` for anything else the tab does not take.
 */
export function linkFieldFault(input: string): "subpath" | "invalid" | null {
  if (input.trim() === "" || isPluginLink(input)) return null;
  return isRepoSubpathLink(input) ? "subpath" : "invalid";
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

/** Where the dialog's body opens: a tab, and what its field holds — the npm or the link tab's value, or the agent tab's source. */
export interface ImportOpening {
  tab: ImportTab;
  value?: string;
}

export interface ImportPluginTabsProps {
  projectId: string;
  /** Where the body opens; the npm tab with nothing typed when absent. */
  initial?: ImportOpening;
  /** Opens a new chat draft holding the prompt; null when there is no Agent to send it to. */
  onOpenChat: ((text: string) => void) | null;
  /** After an install landed: what the server says it installed (null when it did not), and the name to fall back on. */
  onLanded: (outcome: PluginInstallOutcome | null, fallbackName: string) => void;
}

/** The dialog's body: the server-wide line, then the tabs with the active one's form. */
export function ImportPluginTabs({
  projectId,
  initial = { tab: IMPORT_TABS[0] },
  onOpenChat,
  onLanded,
}: ImportPluginTabsProps) {
  const opened = (at: ImportTab) => (initial.tab === at ? (initial.value ?? "") : "");
  const [tab, setTab] = useState<ImportTab>(initial.tab);
  // What each tab holds survives a look at another tab.
  const form = useFormDraft<ImportDraft>(
    { npm: opened("npm"), link: opened("link"), source: opened("agent") },
    { scope: PLUGIN_IMPORT_SCOPE, normalize: trimmedDraft },
  );
  const typed = form.draft;
  const source = form.draft.source;
  const [installing, setInstalling] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // An install or an upload in flight holds the dialog's close until it answers.
  useSaving(installing || uploading, PLUGIN_IMPORT_SCOPE);
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

  /** The link tab's way out for a repository folder: the agent tab, the link as its source. */
  const askAgentWith = (link: string) => {
    form.patch({ source: link.trim() });
    setTab("agent");
    setDirectError(null);
  };

  const directPanel = (from: DirectTab) => {
    const value = typed[from];
    const npm = from === "npm";
    const fault = !npm
      ? linkFieldFault(value)
      : value.trim() === "" || tabTakes("npm", value)
        ? null
        : "invalid";
    // A folder link is a valid URL npm cannot install, not a malformed one: it reads as a muted
    // field hint with the way out beside it, not as a red error. Red (the `error` prop) stays for
    // a value the field rejects as wrong — a name on the link tab, an http: link.
    const error =
      fault === "invalid" ? (npm ? S.plugins.importNpmInvalid : S.plugins.importLinkInvalid) : null;
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
              onChange={(e) => form.setDraft((d) => ({ ...d, [from]: e.target.value }))}
              placeholder={npm ? S.plugins.importNpmPlaceholder : S.plugins.importLinkPlaceholder}
              autoComplete="off"
              spellCheck={false}
              {...(error !== null ? { error } : {})}
            />
            {fault === "subpath" && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                <span>{S.plugins.importLinkSubpath}</span>
                <Button size="sm" variant="link" onClick={() => askAgentWith(value)}>
                  {S.plugins.importLinkAskAgent}
                </Button>
              </p>
            )}
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
        <p className="mt-1 text-xs text-fg-muted">{S.plugins.importMcpNote}</p>
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
      <p className="mt-1 text-xs text-fg-muted">{S.plugins.importMcpNote}</p>
      {uploadError !== null && <p className={`mt-1.5 text-xs ${toneInk.danger}`}>{uploadError}</p>}
    </>
  );

  const agentPanel = (
    <>
      <p className="text-xs text-fg-muted">{S.plugins.importAgentWhy}</p>
      <p className="mt-1 text-xs text-fg-muted">{S.plugins.importMcpNote}</p>
      <div className="mt-2.5 space-y-3">
        <Input
          size="sm"
          label={S.plugins.importSourceLabel}
          value={source}
          onChange={(e) => form.patch({ source: e.target.value })}
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
  const requestClose = useGuardedClose(onClose, PLUGIN_IMPORT_SCOPE);

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
    <Modal
      open={open}
      title={S.plugins.importPlugin}
      onClose={requestClose}
      widthClass="sm:max-w-lg"
    >
      <ImportPluginTabs
        projectId={projectId}
        onOpenChat={
          agentId === null
            ? null
            : (text) => {
                // The source goes with the chat, so nothing typed is left to lose; forgotten
                // first, or the leave guard would hold the move to the conversation.
                discardUnsaved(PLUGIN_IMPORT_SCOPE);
                openAiChat({ agentId, text });
                onClose();
              }
        }
        onLanded={landed}
      />
    </Modal>
  );
}
