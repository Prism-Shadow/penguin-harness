/**
 * The organization handbook — `handbook/` in the organization directory, the company's
 * knowledge base — as two panes. Left, the file list: the index (`README.md`, the page every
 * trigger makes the employee read first) pinned at the top, then the documents beside it and
 * one group per top-level folder, each row with its file name and when it was last written.
 * Right, the selected document rendered as Markdown (anything else preformatted), edited in
 * place through a monospace textarea with save and cancel, and — for every document but the
 * index — deleted behind the shared confirmation. The new-document dialog refuses a path the
 * server would, then creates the file with a one-line title and selects it. A relative link
 * inside a document opens the document it names in the same pane, so the index works as the
 * handbook's own navigation.
 *
 * Loading discipline: the skeleton stands only until the first listing or its failure; a
 * failed refresh keeps the list on screen under one error line with its retry; a document
 * that fails to load says so inside its pane with the list still usable. The selection is
 * component state — the URL stays at the page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { OrgHandbookFile, OrgHandbookFileResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes, formatDateTime, formatRelativeShort } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { useLocale } from "../../state/locale";
import type { Locale } from "../../state/locale";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { FILE_ICON, NAV_ICONS } from "../../components/ui/icons";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Md } from "../chat/md";
import { OrgEmptyLine, OrgPage, OrgSection, useOrg } from "./org-layout";
import { ErrorLine } from "./shared";
import {
  HANDBOOK_INDEX,
  buildHandbookTree,
  completeHandbookPath,
  isHandbookPath,
  isMarkdownPath,
  newDocumentBody,
  resolveHandbookLink,
} from "./handbook-tree";

/** The two panes: a fixed list column beside the document, stacked on a narrow screen. */
const PANES_CLASS = "grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[17rem_minmax(0,1fr)]";

/** The size a listing row would report for content just written, before the listing is re-read. */
const byteLength = (text: string) => new TextEncoder().encode(text).length;

export function HandbookPage() {
  const { projectId, orgId, org } = useOrg();
  const { locale } = useLocale();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.handbook}` : S.nav.org.handbook);
  const [files, setFiles] = useState<OrgHandbookFile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState(HANDBOOK_INDEX);
  const [doc, setDoc] = useState<OrgHandbookFileResponse | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  /** Bumped to re-read the selected document (its retry) without changing the selection. */
  const [docAttempt, setDocAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Another organization's handbook must not linger while this one loads.
  useEffect(() => {
    setFiles(null);
    setListError(null);
    setSelected(HANDBOOK_INDEX);
    setEditing(false);
  }, [projectId, orgId]);

  const loadList = useCallback(async () => {
    try {
      const res = await api.listOrgHandbookFiles(projectId, orgId);
      setFiles(res.files);
      setListError(null);
    } catch (e) {
      setListError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // The pane follows the selection. A response for a document the user has already left
  // must not land in it, hence the cancellation.
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setDocError(null);
    setEditing(false);
    api
      .getOrgHandbookFile(projectId, orgId, selected)
      .then((res) => {
        if (cancelled) return;
        setDoc(res);
        setDocError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setDocError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, orgId, selected, docAttempt]);

  // A document that vanished from the listing (deleted elsewhere) gives way to the index.
  useEffect(() => {
    if (files !== null && selected !== HANDBOOK_INDEX && !files.some((f) => f.path === selected)) {
      setSelected(HANDBOOK_INDEX);
    }
  }, [files, selected]);

  /** A write's effect on the listing, ahead of the re-read that confirms it. */
  const upsertFile = (file: OrgHandbookFile) =>
    setFiles((prev) =>
      prev === null ? [file] : [...prev.filter((f) => f.path !== file.path), file],
    );

  const startEdit = () => {
    if (doc === null) return;
    setDraft(doc.content);
    setEditing(true);
  };

  const save = async () => {
    if (doc === null || saving) return;
    setSaving(true);
    try {
      const res = await api.putOrgHandbookFile(projectId, orgId, doc.path, draft);
      setDoc(res);
      setEditing(false);
      upsertFile({
        path: res.path,
        size: byteLength(res.content),
        updatedAt: new Date().toISOString(),
      });
      toastSuccess(S.common.saved);
      void loadList();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  const create = async (path: string) => {
    const res = await api.putOrgHandbookFile(projectId, orgId, path, newDocumentBody(path));
    upsertFile({
      path: res.path,
      size: byteLength(res.content),
      updatedAt: new Date().toISOString(),
    });
    setCreateOpen(false);
    setSelected(res.path);
    toastSuccess(S.company.handbook.documentCreated);
    void loadList();
  };

  const remove = async () => {
    if (doc === null || deleting) return;
    const path = doc.path;
    setDeleting(true);
    try {
      await api.deleteOrgHandbookFile(projectId, orgId, path);
      setDeleteOpen(false);
      setFiles((prev) => (prev === null ? prev : prev.filter((f) => f.path !== path)));
      setSelected(HANDBOOK_INDEX);
      toastSuccess(S.company.handbook.documentDeleted);
      void loadList();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeleting(false);
    }
  };

  // A relative link inside the rendered document is another document of the handbook: it
  // opens in this pane rather than in the new tab the Markdown renderer's links default to.
  const onBodyClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (doc === null) return;
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor === null) return;
    const target = resolveHandbookLink(doc.path, anchor.getAttribute("href") ?? "");
    if (target === null) return;
    e.preventDefault();
    setSelected(target);
  };

  const onEditorKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };

  const tree = useMemo(() => (files === null ? null : buildHandbookTree(files)), [files]);
  const existing = useMemo(() => new Set((files ?? []).map((f) => f.path)), [files]);
  const selectedFile = files?.find((f) => f.path === selected) ?? null;
  const isIndex = selected === HANDBOOK_INDEX;

  const title = S.nav.org.handbook;
  const info = S.company.handbook.info;

  if (tree === null) {
    return (
      <OrgPage title={title} info={info}>
        {listError !== null ? (
          <EmptyState
            title={S.company.handbook.loadFailed}
            description={listError}
            action={<Button onClick={() => void loadList()}>{S.common.retry}</Button>}
          />
        ) : (
          <HandbookSkeleton />
        )}
      </OrgPage>
    );
  }

  const rowOf = (file: OrgHandbookFile, label: string) => (
    <li key={file.path}>
      <FileRow
        label={label}
        icon={FILE_ICON}
        file={file}
        selected={selected === file.path}
        locale={locale}
        onClick={() => setSelected(file.path)}
      />
    </li>
  );

  return (
    <OrgPage title={title} info={info}>
      {listError !== null && (
        <ErrorLine
          message={S.company.handbook.loadFailed}
          detail={listError}
          onRetry={() => void loadList()}
          className="mb-4"
        />
      )}
      <div className={PANES_CLASS}>
        {/* The create button sits in the section's action slot rather than the page's: it
            is the list's own action, and a button in both headers keeps their rules level. */}
        <OrgSection
          title={S.company.handbook.documents}
          count={files?.length ?? 0}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {S.company.handbook.newDocument}
            </Button>
          }
        >
          <ul className="space-y-0.5">
            <li>
              <FileRow
                label={HANDBOOK_INDEX}
                sublabel={S.company.handbook.indexLabel}
                icon={NAV_ICONS.orgHandbook}
                file={tree.index}
                selected={isIndex}
                locale={locale}
                onClick={() => setSelected(HANDBOOK_INDEX)}
              />
            </li>
            {tree.root.map((d) => rowOf(d, d.label))}
          </ul>
          {tree.folders.map((folder) => (
            <div key={folder.name} className="mt-3">
              <p
                className={`flex items-center ${ICON_GAP.row} px-2 pb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400`}
              >
                <GlyphIcon d={FOLDER_ICON} size={ICON_SIZE.inlineGlyph} />
                <span className="min-w-0 truncate">{folder.name}</span>
                <span className="tabular-nums text-gray-400 dark:text-gray-500">
                  {folder.docs.length}
                </span>
              </p>
              <ul className="space-y-0.5">{folder.docs.map((d) => rowOf(d, d.label))}</ul>
            </div>
          ))}
          {tree.root.length === 0 && tree.folders.length === 0 && (
            <OrgEmptyLine>{S.company.handbook.noOtherDocuments}</OrgEmptyLine>
          )}
        </OrgSection>

        <section className="min-w-0" aria-label={selected}>
          {/* The document's own header: its path (a file name, not a heading, so no
              uppercase), the index mark, when it was written, and the pane's controls. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-200 pb-2 dark:border-gray-800">
            <div className={`flex min-w-0 items-center ${ICON_GAP.row}`}>
              <span className="truncate font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">
                {selected}
              </span>
              {isIndex && (
                <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {S.company.handbook.indexLabel}
                </span>
              )}
              {selectedFile !== null && (
                <span
                  className="hidden shrink-0 text-[11px] text-gray-400 sm:inline dark:text-gray-500"
                  title={S.company.handbook.updatedAt(
                    formatDateTime(selectedFile.updatedAt),
                    formatBytes(selectedFile.size),
                  )}
                >
                  {formatRelativeShort(selectedFile.updatedAt, locale)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {editing ? (
                <>
                  <span className="hidden text-[11px] text-gray-400 sm:inline dark:text-gray-500">
                    {S.company.handbook.editorHint}
                  </span>
                  <Button size="sm" disabled={saving} onClick={() => setEditing(false)}>
                    {S.common.cancel}
                  </Button>
                  <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? S.common.saving : S.common.save}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" disabled={doc === null} onClick={startEdit}>
                    {S.common.edit}
                  </Button>
                  {!isIndex && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={doc === null}
                      onClick={() => setDeleteOpen(true)}
                    >
                      {S.common.delete}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          {docError !== null ? (
            <EmptyState
              title={S.company.handbook.documentLoadFailed}
              description={docError}
              action={<Button onClick={() => setDocAttempt((n) => n + 1)}>{S.common.retry}</Button>}
            />
          ) : doc === null ? (
            <DocumentSkeleton />
          ) : editing ? (
            <Textarea
              mono
              size="sm"
              aria-label={selected}
              value={draft}
              rows={24}
              spellCheck={false}
              autoFocus
              disabled={saving}
              className="min-h-[50vh]"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onEditorKey}
            />
          ) : doc.content.trim() === "" ? (
            <OrgEmptyLine>{S.company.handbook.emptyDocument}</OrgEmptyLine>
          ) : isMarkdownPath(doc.path) ? (
            <div
              className="md-body text-sm leading-relaxed text-gray-800 dark:text-gray-100"
              onClick={onBodyClick}
            >
              <Md text={doc.content} />
            </div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              {doc.content}
            </pre>
          )}
        </section>
      </div>

      <NewDocumentDialog
        open={createOpen}
        existing={existing}
        onClose={() => setCreateOpen(false)}
        onCreate={create}
      />
      <ConfirmModal
        open={deleteOpen}
        title={S.company.handbook.deleteDocument}
        confirmLabel={S.common.delete}
        busy={deleting}
        onClose={() => (deleting ? undefined : setDeleteOpen(false))}
        onConfirm={() => void remove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.handbook.deleteConfirm(selected)}
        </p>
      </ConfirmModal>
    </OrgPage>
  );
}

/**
 * One row of the list: the glyph, the name (with the index's reason for being pinned under
 * it), and how long ago the file was written; the whole path (a long name truncates), the
 * exact time and the size ride in the tooltip. The selected row is filled rather than merely
 * bold, so the pane beside it reads as that row's.
 */
function FileRow({
  label,
  sublabel,
  icon,
  file,
  selected,
  locale,
  onClick,
}: {
  label: string;
  sublabel?: string;
  icon: string;
  /** The listing's entry, or null for the index while the listing lacks it. */
  file: OrgHandbookFile | null;
  selected: boolean;
  locale: Locale;
  onClick: () => void;
}) {
  const tooltip =
    file === null
      ? label
      : `${file.path} · ${S.company.handbook.updatedAt(formatDateTime(file.updatedAt), formatBytes(file.size))}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      title={tooltip}
      className={`flex w-full items-center ${ICON_GAP.menu} rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
        selected
          ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          : "hover:bg-gray-100 dark:hover:bg-gray-800"
      }`}
    >
      <span
        className={`shrink-0 ${selected ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500"}`}
      >
        <GlyphIcon d={icon} size={ICON_SIZE.rowLead} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sublabel !== undefined && (
          <span className="block truncate text-[11px] font-normal text-gray-500 dark:text-gray-400">
            {sublabel}
          </span>
        )}
      </span>
      {file !== null && (
        <span className="shrink-0 text-[11px] font-normal tabular-nums text-gray-400 dark:text-gray-500">
          {formatRelativeShort(file.updatedAt, locale)}
        </span>
      )}
    </button>
  );
}

/**
 * The new-document dialog: one path field, checked here before the request — the server's
 * own rule, a name already taken — so the failure lands under the field; anything the server
 * still refuses lands in a strip above the footer with its retry.
 */
function NewDocumentDialog({
  open,
  existing,
  onClose,
  onCreate,
}: {
  open: boolean;
  /** Every path the listing holds, so a duplicate is refused before it overwrites. */
  existing: ReadonlySet<string>;
  onClose: () => void;
  /** Creates the file; a rejection is shown in the dialog. */
  onCreate: (path: string) => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [pathError, setPathError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // No draft is kept: the field starts empty every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setPath("");
    setPathError(undefined);
    setFormError(null);
  }, [open]);

  const submit = async () => {
    const rel = completeHandbookPath(path);
    if (rel === "") {
      setPathError(S.common.requiredField);
      return;
    }
    if (!isHandbookPath(rel)) {
      setPathError(S.company.handbook.pathInvalid);
      return;
    }
    if (existing.has(rel)) {
      setPathError(S.company.handbook.pathExists);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onCreate(rel);
    } catch (e) {
      setFormError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.company.handbook.newDocument}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? S.company.handbook.creating : S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label={S.company.handbook.pathField}
          required
          size="sm"
          value={path}
          error={pathError}
          hint={S.company.handbook.pathHint}
          placeholder={S.company.handbook.pathPlaceholder}
          className="font-mono"
          autoFocus
          disabled={busy}
          onChange={(e) => {
            setPath(e.target.value);
            setPathError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {formError !== null && <ErrorLine message={formError} onRetry={() => void submit()} />}
      </div>
    </Modal>
  );
}

/** The two panes as placeholder bands, until the first listing arrives. */
function HandbookSkeleton() {
  return (
    <div className={PANES_CLASS} aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
      <DocumentSkeleton />
    </div>
  );
}

/** The document pane's placeholder: a title band over three lines. */
function DocumentSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
