/**
 * The plugin library's two import actions — a local zip upload and a remote download — with the
 * Modal and the overwrite confirmation they need, kept out of plugins-page.tsx so the page
 * keeps describing the library rather than the dialogs.
 *
 * Both are the same import twice: one carries the archive in the request, the other a URL the
 * server fetches, and everything after the POST is shared — a 409 `plugin_exists` opens the
 * overwrite confirmation, whose confirm resends THAT request with `overwrite: true` (so the
 * user never picks the file twice, nor retypes the name), and any other failure rolls back to a
 * toast. The library list and the directory line are re-read on success, which is how the new
 * card appears.
 *
 * Each dialog carries the same optional name field, for the one case the archive cannot answer
 * itself: plugin.json at the very root of the zip has no directory to take a name from. Left
 * empty — the normal case — nothing is sent, and the server names the plugin after the
 * directory inside the archive that carries plugin.json. The field is held to the server's own
 * name rule while it is typed, so a name the route would answer 400 for cannot reach the
 * submit button.
 *
 * Both dialogs end with the same panel of rules (see PluginRules), in two lists: what the import
 * takes — which sources, where the plugin root is found, the precedence the plugin NAME is
 * decided by, the size caps, and what happens on a name collision — and what a plugin has to be,
 * for whoever is about to publish one. It sits at the foot so the reader meets each rule just
 * after the control it governs, and it is identical in both dialogs because it describes the
 * shape a plugin has to arrive in rather than one source's mechanics.
 *
 * Admin-only by the server's own rule: the plugin directory is a server-level resource shared
 * by every Project, so a member cannot write into it — the caller (plugins-page) renders this
 * component only for an admin, and the routes answer 403 `admin_required` regardless.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import {
  Button,
  ConfirmModal,
  HiddenFileInput,
  Input,
  Modal,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { UPLOAD_LABEL_CLASS } from "../agents/skills-tab";
import {
  PLUGIN_ZIP_LIMIT_MB,
  pluginImportErrorText,
  pluginNameBody,
  pluginNameFromError,
  pluginNameFromUrl,
  pluginNameInvalid,
  pluginZipTooLarge,
} from "./plugin-import";

/**
 * One import request, in the shape the retry needs: repeatable exactly as it was sent, `name`
 * included — the confirmation resends it, so what the user typed goes out once and once only.
 * Two variants because the two flows carry different things — the uploaded bytes cannot be
 * recovered from anywhere else once the POST is gone, while a download re-fetches from its URL.
 * `name` is empty whenever the user left the field alone; pluginNameBody is what decides
 * whether it travels.
 */
type ImportRequest =
  | { source: "upload"; dataBase64: string; name: string }
  | { source: "download"; url: string; name: string };

/** An import that answered 409 `plugin_exists`: its request, plus the plugin name the overwrite confirmation's copy names. */
type PendingOverwrite = ImportRequest & { pluginName: string };

/** Which import is in flight; the header label and the dialog's confirm button both read it. */
type Busy = "upload" | "download" | null;

/** A picked zip already read into the request body, with the names the flow needs: the file as the user sees it, and the stem a nameless import falls back to. */
interface PickedArchive {
  dataBase64: string;
  fileName: string;
  stem: string;
}

/**
 * The plugin rules, the same two numbered blocks at the foot of both dialogs: what an import
 * takes (importRules), then what a plugin has to be (authoringRules). Read from the strings
 * rather than written into the JSX, so they follow the locale like every other line on this
 * surface.
 *
 * The import list is ORDERED because its last two entries are a precedence rather than a set of
 * facts: the plugin name is typed name first, then the name the source carries, then the
 * archive's own layout — and a GitHub REPOSITORY url is a source that carries the repository's
 * name, which is how a plugin can install under a name nobody asked for. That is the rule this
 * panel exists to put in front of the reader, at the moment they are about to name the thing.
 *
 * The authoring list is here for the same reason the panel is not in any one plugin repository:
 * a plugin outlives the repository it was published in, and the rules it states — no account
 * details, no credentials inside a plugin — are the ones its own author breaks, while looking at
 * this surface rather than at that repository's README.
 *
 * Exported for its own test (test/plugin-import-rules.test.ts): the dialogs around it render
 * through a portal and cannot be mounted in the suite's node environment, while this panel can.
 */
export function PluginRules() {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-900/40">
      <RuleList title={S.plugins.importRulesTitle} rules={S.plugins.importRules} />
      <RuleList title={S.plugins.authoringRulesTitle} rules={S.plugins.authoringRules} />
    </div>
  );
}

/** One titled numbered list of the panel above. */
function RuleList({ title, rules }: { title: string; rules: readonly string[] }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{title}</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ol>
    </div>
  );
}

export function PluginImportActions({
  onImported,
}: {
  /** Called once an import landed and was toasted: re-read the library listing and the directory line, so the new plugin's card is on screen. */
  onImported: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  // The picked archive is held rather than posted from the picker's own callback: the dialog
  // collects the file and the name together, and the confirm sends both in one request.
  const [picked, setPicked] = useState<PickedArchive | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");
  // The 409 confirmation, and the only state both flows share.
  const [pending, setPending] = useState<PendingOverwrite | null>(null);

  const uploadNameInvalid = pluginNameInvalid(uploadName);
  const downloadNameInvalid = pluginNameInvalid(downloadName);

  /** Success path, shared by both flows: close what was open, toast, re-read the library. */
  const imported = async (name: string) => {
    setPending(null);
    setUploadOpen(false);
    setPicked(null);
    setUploadName("");
    setDownloadOpen(false);
    setUrl("");
    setDownloadName("");
    toastSuccess(S.plugins.importDoneToast(name));
    await onImported();
  };

  /**
   * Closing the upload dialog drops what was picked with it — unlike the download dialog's URL,
   * which survives a cancel (it is one pasted string the user would have to find again), the
   * archive is a base64 body held in memory, and a dialog opened to start over has no use for it.
   */
  const closeUpload = () => {
    setUploadOpen(false);
    setPicked(null);
    setUploadName("");
  };

  /**
   * A 409 lands in the overwrite confirmation instead of a toast — it is a question, not a
   * failure — and every other refusal (or a missing admin right) rolls back to one.
   */
  const failed = (e: unknown, request: ImportRequest, fallbackName: string) => {
    if (e instanceof ApiError && e.status === 409 && e.code === "plugin_exists") {
      setPending({ ...request, pluginName: pluginNameFromError(e, fallbackName) });
    } else {
      setPending(null);
      toastError(pluginImportErrorText(e));
    }
  };

  /** POST the archive body; `overwrite` only ever set by the confirmation's retry. */
  const upload = async (
    dataBase64: string,
    name: string,
    fallbackName: string,
    overwrite: boolean,
  ) => {
    setBusy("upload");
    try {
      const res = await api.importPluginArchive({
        dataBase64,
        // Absent, not empty, when the field was left alone: see pluginNameBody.
        ...pluginNameBody(name),
        ...(overwrite ? { overwrite: true } : {}),
      });
      await imported(res.plugin.name);
    } catch (e) {
      failed(e, { source: "upload", dataBase64, name }, fallbackName);
    } finally {
      setBusy(null);
    }
  };

  /** POST the URL; the server derives the name from it (and `subdir` from a tree URL). */
  const download = async (target: string, name: string, overwrite: boolean) => {
    setBusy("download");
    try {
      const res = await api.importPluginFromUrl({
        url: target,
        ...pluginNameBody(name),
        ...(overwrite ? { overwrite: true } : {}),
      });
      await imported(res.plugin.name);
    } catch (e) {
      failed(e, { source: "download", url: target, name }, pluginNameFromUrl(target));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Read the picked zip now, post it later: the dialog's confirm is what sends it, so the name
   * gets its say first. The fallback name is the picked file's stem, used only if the server's
   * 409 message does not name the plugin (see pluginNameFromError).
   */
  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the picker's value so picking the SAME file again after a refusal still fires a
    // change event (the Skills tab's import does the same, for the same reason).
    e.target.value = "";
    if (!file) return;
    // Refused before reading: see pluginZipTooLarge.
    if (pluginZipTooLarge(file.size)) {
      toastError(S.plugins.importTooLarge(PLUGIN_ZIP_LIMIT_MB));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the `data:…;base64,` prefix the FileReader adds.
      setPicked({
        dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        fileName: file.name,
        stem: file.name.replace(/\.zip$/i, ""),
      });
    };
    reader.onerror = () => toastError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  const submitUpload = () => {
    if (picked === null) return;
    void upload(picked.dataBase64, uploadName, picked.stem, false);
  };

  const confirmOverwrite = () => {
    if (pending === null) return;
    if (pending.source === "upload") {
      void upload(pending.dataBase64, pending.name, pending.pluginName, true);
    } else {
      void download(pending.url, pending.name, true);
    }
  };

  return (
    <>
      {/* Right-aligned in the title row, next to the page title. Each action opens its own
          dialog (both are a source plus the optional name), and both are disabled while either
          import runs, since one import at a time is what the confirmation's single pending slot
          can carry. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => setUploadOpen(true)}>
          {busy === "upload" ? S.plugins.importUploading : S.plugins.importUpload}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy !== null}
          onClick={() => setDownloadOpen(true)}
        >
          {busy === "download" ? S.plugins.importDownloading : S.plugins.importDownload}
        </Button>
      </div>

      {/* Local zip upload: the picker, and the name field that only matters when plugin.json
          sits at the archive's root. */}
      <Modal
        open={uploadOpen}
        title={S.plugins.importUpload}
        onClose={closeUpload}
        widthClass="sm:max-w-lg"
        footer={
          <>
            <Button size="sm" onClick={closeUpload}>
              {S.common.cancel}
            </Button>
            {/* Disabled until a file is picked, and while the typed name breaks the server's
                own rule (the field carries the message that says so). */}
            <Button
              size="sm"
              variant="primary"
              disabled={busy !== null || picked === null || uploadNameInvalid}
              onClick={submitUpload}
            >
              {busy === "upload" ? S.plugins.importUploading : S.plugins.uploadAction}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.uploadDesc}</p>
          <div className="flex items-center gap-2">
            <label
              className={`${UPLOAD_LABEL_CLASS} ${busy !== null ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept=".zip" disabled={busy !== null} onChange={onPickFile} />
              {S.plugins.uploadPickFile}
            </label>
            {/* Which file the next confirm will send: without it, picking one shows nothing. */}
            {picked !== null && (
              <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                {S.plugins.uploadPicked(picked.fileName)}
              </span>
            )}
          </div>
          <Input
            size="sm"
            label={S.plugins.pluginNameLabel}
            hint={S.plugins.pluginNameHint}
            placeholder={S.plugins.pluginNamePlaceholder}
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            error={uploadNameInvalid ? S.plugins.pluginNameInvalid : undefined}
            autoComplete="off"
          />
          <PluginRules />
        </div>
      </Modal>

      <Modal
        open={downloadOpen}
        title={S.plugins.downloadTitle}
        onClose={() => setDownloadOpen(false)}
        widthClass="sm:max-w-lg"
        footer={
          <>
            {/* Cancel stays live while the download runs (as in the Skills tab's import
                modal): the request is already on its way, and it still reports itself — a
                success through the toast and the refreshed list, a 409 through the overwrite
                confirmation, which is a dialog of its own. */}
            <Button size="sm" onClick={() => setDownloadOpen(false)}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy !== null || url.trim() === "" || downloadNameInvalid}
              onClick={() => void download(url.trim(), downloadName, false)}
            >
              {busy === "download" ? S.plugins.importDownloading : S.plugins.downloadAction}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">{S.plugins.downloadDesc}</p>
          <Input
            size="sm"
            label={S.plugins.downloadUrlLabel}
            hint={S.plugins.downloadUrlHint}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={S.plugins.downloadUrlPlaceholder}
            autoComplete="off"
            autoFocus
          />
          <Input
            size="sm"
            label={S.plugins.pluginNameLabel}
            hint={S.plugins.pluginNameHint}
            placeholder={S.plugins.pluginNamePlaceholder}
            value={downloadName}
            onChange={(e) => setDownloadName(e.target.value)}
            error={downloadNameInvalid ? S.plugins.pluginNameInvalid : undefined}
            autoComplete="off"
          />
          <PluginRules />
        </div>
      </Modal>

      {/* Overwrite confirmation: the dialog that asked stays underneath (its Cancel returns to
          it, file and name both intact), and confirm resends the same request with
          overwrite: true. */}
      {pending !== null && (
        <ConfirmModal
          open
          title={S.plugins.importOverwriteTitle}
          tone="primary"
          confirmLabel={S.plugins.importOverwriteAction}
          cancelLabel={S.common.cancel}
          busy={busy !== null}
          onClose={() => setPending(null)}
          onConfirm={confirmOverwrite}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.importOverwriteBody(pending.pluginName)}
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
