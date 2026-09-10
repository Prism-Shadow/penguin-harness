/**
 * Agent settings page "Hooks" tab: the hook packages installed on this Agent
 * (agent_state/hooks/<name>/ — a manifest plus the scripts the harness runs at the loop's
 * hook points, e.g. after every Task). The files are the single source of truth, so the list
 * is re-fetched from the API after every mutation instead of trusting client state, the way
 * the Skills tab does. Rows lead with the icon of the plugin the package came from (the hook
 * glyph when it has none), then the package name with the hook points it answers at right
 * beside it (one bare chip each — `stop`, `user_prompt` — wrapping with the name), its
 * localized description below, and the trailing slot: the version, the enable switch, export
 * and uninstall. The switch is the owner's (members see a "disabled" badge on a switched-off
 * row instead); it writes `enabled: false` into the package's hooks.json, and a Session
 * created from then on skips the package. Export downloads the installed directory as a zip;
 * the "Import hook" modal offers the Skills tab's two paths: the recommended chat import (a
 * source field taking a URL / repo / local path / description / another tool's hooks config,
 * whose generated review-then-install prompt — hook-import.ts — can be copied or prefilled
 * into a new chat with this Agent) and a zip upload that takes such a package back (409
 * hook_exists asks before overwriting). Read, import/export and uninstall are member-level,
 * matching the hooks routes.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { HookItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { CopiedStatus, CopyCheckGlyph, useCopied } from "../../components/ui/copy-button";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HelpFold } from "../../components/ui/help-fold";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { DownloadIcon, HOOK_ICON } from "../../components/ui/icons";
import { Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { localizedText } from "../chat/skill-use";
import { SkillTile } from "../skills/skill-icon-view";
import { useAiBridge } from "../ai-create";
import { downloadArchive } from "./archive-download";
import { buildHookImportPrompt } from "./hook-import";
import { TRASH_ICON, UPLOAD_LABEL_CLASS } from "./skills-tab";

/** Zip pending an overwrite confirmation: the payload to resend with overwrite: true plus the package name for the confirm copy. */
interface PendingOverwrite {
  dataBase64: string;
  name: string;
}

export function HooksTab({ agentId }: { agentId: string }) {
  const { locale } = useLocale();
  const { currentProject, agents, reloadAgents } = useProject();
  const { openAiChat } = useAiBridge();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";

  const [hooks, setHooks] = useState<HookItem[] | null>(null);
  // Tab-level error is only the initial list load failure; row actions report via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Package whose switch is being written (its Switch is held meanwhile).
  const [switching, setSwitching] = useState<string | null>(null);
  // Package name pending uninstall confirmation (non-null shows the confirm modal).
  const [removing, setRemoving] = useState<string | null>(null);
  // Import modal: the source for the chat-import prompt + upload state travel with the modal.
  const [importOpen, setImportOpen] = useState(false);
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Non-null shows the overwrite confirm (the archive POST answered 409 hook_exists).
  const [overwriting, setOverwriting] = useState<PendingOverwrite | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setHooks(null);
    setError(null);
    try {
      const res = await api.getAgentHooks(projectId, agentId);
      setHooks(res.hooks);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Display name of this Agent for toasts / confirm copy (falls back to the raw id). */
  const agent = agents.find((a) => a.agentId === agentId);
  const agentName = agent ? agentDisplayName(agent) : agentId;

  /**
   * The switch: PATCH, then swap the returned item into the list in place — the list is not
   * re-fetched here, so the row keeps its place and the skeleton never flashes on a flip.
   */
  const toggle = async (hook: HookItem, enabled: boolean) => {
    if (!projectId) return;
    setSwitching(hook.name);
    try {
      const updated = await api.setAgentHookEnabled(projectId, agentId, hook.name, enabled);
      setHooks((prev) => prev?.map((h) => (h.name === updated.name ? updated : h)) ?? prev);
      toastSuccess(enabled ? S.hooks.enabledToast(hook.name) : S.hooks.disabledToast(hook.name));
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSwitching(null);
    }
  };

  /** "Export as zip": the shared archive download (archive-download.ts); a failure surfaces as a toast. */
  const exportHook = async (name: string) => {
    if (!projectId) return;
    try {
      await downloadArchive(api.agentHookArchiveUrl(projectId, agentId, name), name);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** Confirm modal's "Confirm": uninstall, then always re-fetch the list from disk. */
  const confirmRemove = async () => {
    if (!projectId || removing === null) return;
    setBusy(true);
    try {
      await api.uninstallAgentHook(projectId, agentId, removing);
      toastSuccess(S.hooks.uninstalledToast(removing, agentName));
      await load();
      // The agent card's hook count (and its plugin-update marks) changed; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  /** Open the import modal (reset the form and upload state). */
  const openImport = () => {
    setSource("");
    setUploadError(null);
    setOverwriting(null);
    setImportOpen(true);
  };

  /**
   * POST the zip to the archive endpoint. A 409 hook_exists pops the overwrite confirm (the
   * package name is read from the server's fixed message tail, pinned by the route tests;
   * `fallbackName` — the picked file's stem — covers a parse miss). Success closes the modal
   * and re-fetches the list.
   */
  const upload = async (dataBase64: string, fallbackName: string, overwrite: boolean) => {
    if (!projectId) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.installAgentHookArchive(projectId, agentId, {
        dataBase64,
        ...(overwrite ? { overwrite: true } : {}),
      });
      setOverwriting(null);
      setImportOpen(false);
      toastSuccess(S.hooks.importDoneToast);
      await load();
      // The agent card's hook count changed; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "hook_exists") {
        const name = /:\s*([A-Za-z0-9_-]+)$/.exec(e.message)?.[1] ?? fallbackName;
        setOverwriting({ dataBase64, name });
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
    const fallbackName = file.name.replace(/\.zip$/i, "");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      void upload(dataUrl.slice(dataUrl.indexOf(",") + 1), fallbackName, false); // strip the data:...;base64, prefix
    };
    reader.onerror = () => setUploadError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  // A URL / repo / path source gets an import lead sentence, free text is the lead itself (see
  // hook-import.ts); the preview substitutes a placeholder token until something is entered.
  const trimmedSource = source.trim();
  const chatPrompt =
    projectId !== null
      ? buildHookImportPrompt(trimmedSource || S.hooks.importSourceToken, projectId, agentId)
      : "";
  // Copy feedback lives at the button (the shared copy convention): its glyph flips to the
  // check while copied — no toast, and the button label never changes.
  const promptCopy = useCopied();

  /**
   * "Open a new chat" with this Agent: the AI bridge prefills the composer with the generated
   * import prompt (parking typed-but-unsent draft text first) and clears a stale handoff
   * target and skill pre-selection along with it.
   */
  const openChat = () => {
    if (projectId === null || trimmedSource === "") return;
    openAiChat({ agentId, text: buildHookImportPrompt(trimmedSource, projectId, agentId) });
    setImportOpen(false);
  };

  if (!projectId) return null;

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabHooks}>
        {S.hooks.agentTabDesc}
        {!isOwner && <span className="mt-1.5 block">{S.hooks.readOnlyHint}</span>}
      </HelpFold>

      {/* Import entry point at the head of the installed list, right-aligned — the Skills tab's
          slot. It renders in every list state so the action never shifts. */}
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={hooks === null} onClick={openImport}>
          {S.hooks.importHook}
        </Button>
      </div>

      {hooks === null ? (
        <SkeletonList rows={3} />
      ) : hooks.length === 0 ? (
        <SettingsEmpty>{S.hooks.agentTabEmpty}</SettingsEmpty>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {hooks.map((hook) => {
            const description = localizedText(locale, hook.description, hook.descriptionZh);
            return (
              <div
                key={hook.name}
                className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
              >
                <SkillTile
                  icon={hook.icon}
                  name={hook.name}
                  fallback={HOOK_ICON}
                  size={36}
                  glyph={20}
                />
                {/* A switched-off package reads dimmed for everyone; the switch or badge names the state. */}
                <div className={`min-w-0 flex-1 ${hook.enabled ? "" : "opacity-60"}`}>
                  {/* Title row: the name with the hook points it answers at right beside it — bare
                      point names, wrapping onto a second line rather than truncating. */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span
                      className="max-w-full truncate font-mono text-[13px] font-semibold"
                      title={hook.name}
                    >
                      {hook.name}
                    </span>
                    {hook.events.map((event) => (
                      <Badge key={event}>{event}</Badge>
                    ))}
                  </div>
                  {/* Description truncates to one line (the full text goes into title for hover reading). */}
                  <p
                    className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400"
                    title={description}
                  >
                    {description}
                  </p>
                </div>
                {hook.version !== "" && (
                  <span
                    className="hidden shrink-0 text-[11px] text-gray-400 sm:block dark:text-gray-500"
                    title={hook.version}
                  >
                    {hook.version}
                  </span>
                )}
                {isOwner ? (
                  <Switch
                    checked={hook.enabled}
                    disabled={busy || switching === hook.name}
                    title={S.hooks.enableSwitch(hook.name)}
                    aria-label={S.hooks.enableSwitch(hook.name)}
                    onChange={(checked) => void toggle(hook, checked)}
                  />
                ) : (
                  !hook.enabled && <Badge>{S.hooks.disabledBadge}</Badge>
                )}
                {/* Icon-only row actions (the Skills tab's pair: neutral bordered icon for export,
                    danger variant with red text/hover for delete); the tooltip + aria-label carry the wording. */}
                <Button
                  size="icon"
                  title={S.hooks.exportHook}
                  aria-label={`${S.hooks.exportHook} ${hook.name}`}
                  disabled={busy}
                  onClick={() => void exportHook(hook.name)}
                >
                  <DownloadIcon size={14} className="text-gray-600 dark:text-gray-300" />
                </Button>
                <Button
                  size="icon"
                  variant="danger"
                  title={S.skills.uninstall}
                  aria-label={`${S.skills.uninstall} ${hook.name}`}
                  disabled={busy}
                  onClick={() => setRemoving(hook.name)}
                >
                  <GlyphIcon d={TRASH_ICON} size={14} />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Import modal: recommended chat import on top, zip upload below (the Skills tab's shape). */}
      <Modal
        open={importOpen}
        title={S.hooks.importHook}
        onClose={() => setImportOpen(false)}
        widthClass="sm:max-w-lg"
      >
        <div className="space-y-4">
          <section>
            <p className="text-sm font-medium">{S.hooks.importChatTitle}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {S.hooks.importChatWhy}
            </p>
            <div className="mt-2.5 space-y-2.5">
              {/* A source may be a whole pasted hooks config block, so the field is multi-line. */}
              <Textarea
                label={S.hooks.importSourceLabel}
                hint={S.hooks.importSourceHint}
                size="sm"
                rows={3}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={S.hooks.importSourcePlaceholder}
              />
              <Textarea
                label={S.hooks.importPromptLabel}
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
                  onClick={() =>
                    promptCopy.flash(buildHookImportPrompt(trimmedSource, projectId, agentId))
                  }
                >
                  <CopyCheckGlyph copied={promptCopy.copied} size={12} />
                  {S.hooks.importCopyPrompt}
                </Button>
                <CopiedStatus copied={promptCopy.copied} />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={trimmedSource === ""}
                  onClick={openChat}
                >
                  {S.hooks.importOpenChat}
                </Button>
              </div>
            </div>
          </section>

          <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <p className="text-sm font-medium">{S.hooks.importUploadTitle}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {S.hooks.importUploadDesc}
            </p>
            <label
              className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept=".zip" disabled={uploading} onChange={onPickFile} />
              {uploading ? S.hooks.importUploading : S.hooks.importUploadAction}
            </label>
            {uploadError && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{uploadError}</p>
            )}
          </section>
        </div>
      </Modal>

      {/* Overwrite confirmation: the import modal stays underneath, so cancel returns to it; confirm resends the same zip with overwrite: true. */}
      <ConfirmModal
        open={overwriting !== null}
        title={S.hooks.importOverwriteTitle}
        confirmLabel={S.hooks.importOverwriteAction}
        busy={uploading}
        onClose={() => setOverwriting(null)}
        onConfirm={() => {
          if (overwriting !== null) void upload(overwriting.dataBase64, overwriting.name, true);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {overwriting !== null ? S.hooks.importOverwriteBody(overwriting.name) : ""}
        </p>
      </ConfirmModal>

      {/* Uninstall confirmation (shared ConfirmModal, the Skills tab's pattern). */}
      <ConfirmModal
        open={removing !== null}
        title={removing !== null ? S.hooks.uninstallConfirmTitle(removing) : ""}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removing !== null ? S.hooks.uninstallConfirmBody(removing, agentName) : ""}
        </p>
      </ConfirmModal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
