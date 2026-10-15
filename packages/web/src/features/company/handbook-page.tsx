/**
 * The organization handbook — `handbook/` in the organization directory, the company's
 * knowledge base — in the Workspace Files panel's frame (the UI package's `FilesToolbar` and
 * `FilesPanes`), so a reader who knows one knows the other.
 *
 * Left, the tree pane: a box that filters the documents by path, the new-document and
 * collapse-all actions, and the app's shared file tree over the directory (handbook-explorer.tsx)
 * — the index (`README.md`, the page every trigger makes the employee read first) leading the
 * rows, then folders and documents nested as they are on disk. Above both panes, the toolbar:
 * the tree's toggle, the path of the open document, the index mark, when it was written, and
 * what the document offers (delete, or while editing: cancel and save). Between them, the
 * divider sets the tree's width; too narrow for both, one column shows the tree or the document,
 * with a way back. The tree's visibility and width last as long as the page.
 *
 * Right, the open document: Markdown in the Markdown reader (its outline and its find, Edit in
 * its tool pill), anything else as source. Edit swaps in the Files panel's in-place editor; Save
 * writes the file and returns to reading. A relative link inside a document opens the document it
 * names in the same pane, so the index works as the handbook's own navigation. Every document but
 * the index can be deleted, behind the shared confirmation. The new-document dialog refuses a
 * path the server would, starts from the selected document's own folder so a document lands
 * beside its siblings, then creates the file with a one-line title and selects it.
 *
 * Loading discipline: the skeleton stands only until the first listing or its failure; a
 * failed refresh keeps the list on screen under one error line with its retry; a document
 * that fails to load says so inside its pane with the list still usable. The selection is
 * component state — the URL stays at the page.
 *
 * The editor follows the settings commit model: Save (or `editor.save`) is live only while the
 * text differs from the document as stored, and every way of leaving unsaved text asks first
 * through the app's one prompt — Cancel, another document, New document (all in-page, under the
 * handbook's own scope), and a route change, an organization switch or a reload (the app's
 * router blocker and unload guard, which find the editor registered).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { OrgHandbookFile, OrgHandbookFileResponse } from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  CloseIcon,
  ConfirmModal,
  EmptyState,
  FilesPanes,
  FilesToolbar,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Input,
  Modal,
  PreviewPane,
  SkeletonList,
  Spinner,
  Tooltip,
  TreePane,
  WorkspaceFileEditor,
  filesActionClass,
  guardLeave,
  languageForFileName,
  toastError,
  toastSuccess,
  useFilesLayout,
  useFormDraft,
  useGuardedClose,
  useUnsavedChanges,
} from "@prismshadow/penguin-ui";
import type { PreviewView, TreeToggle } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes, formatDateTime, formatRelativeShort } from "../../lib/format";
import { useReaderFind } from "../../lib/reader-find";
import { isShortcut } from "../../lib/shortcuts/match";
import { currentPlatform } from "../../lib/shortcuts/platform";
import { keymap } from "../../lib/shortcuts/store";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { toneInk } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { OrgEmptyLine, OrgPage, useOrg } from "./org-layout";
import { ErrorLine } from "./shared";
import { COLLAPSE_ALL_ICON, HandbookExplorer } from "./handbook-explorer";
import {
  HANDBOOK_INDEX,
  ancestorFolders,
  buildHandbookTree,
  completeHandbookPath,
  filterHandbookTree,
  folderPaths,
  handbookTreeRows,
  isHandbookPath,
  isMarkdownPath,
  newDocumentBody,
  resolveHandbookLink,
} from "./handbook-tree";

/** The browser's box: the height under the page header, never so short that a document is a sliver. */
const BROWSER_CLASS =
  "relative flex min-h-[24rem] flex-1 flex-col overflow-hidden rounded-md border border-line";

/** The size a listing row would report for content just written, before the listing is re-read. */
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** The document editor's unsaved text: what the page's in-place leaves ask about. */
const HANDBOOK_SCOPE = "handbook";

export function HandbookPage() {
  const { projectId, orgId, org } = useOrg();
  const { locale } = useLocale();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.handbook}` : S.nav.org.handbook);
  const [files, setFiles] = useState<OrgHandbookFile[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState(HANDBOOK_INDEX);
  /** The open folders of the tree, by path: a folder starts closed and is opened by hand. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** The folder last opened or closed, so the tree animates that subtree and no other. */
  const [toggled, setToggled] = useState<TreeToggle | null>(null);
  /** The tree pane's filter over document paths. */
  const [query, setQuery] = useState("");
  /** The tree beside the document on a wide page; it stays as long as the page does. */
  const [treeVisible, setTreeVisible] = useState(true);
  /** The width the divider was dragged to, or null while it never was. */
  const [treeWidth, setTreeWidth] = useState<number | null>(null);
  /** One column: the document is what it shows (after a document is chosen), else the tree. */
  const [docShown, setDocShown] = useState(false);
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layout = useFilesLayout(rootRef, treeWidth);
  const readerFind = useReaderFind();
  const saveShortcut = useShortcutLabel("editor.save");
  const dirty = editing && doc !== null && draft !== doc.content;
  // While the editor holds unsaved text it is registered with the shared guard: "discard" closes
  // it, and an in-place step that would throw the text away asks first.
  useUnsavedChanges(dirty, { scope: HANDBOOK_SCOPE, discard: () => setEditing(false) });
  const guardDiscard = (go: () => void) => void guardLeave(go, HANDBOOK_SCOPE);

  // Another organization's handbook must not linger while this one loads.
  useEffect(() => {
    setFiles(null);
    setListError(null);
    setSelected(HANDBOOK_INDEX);
    setExpanded(new Set<string>());
    setToggled(null);
    setQuery("");
    setDocShown(false);
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

  // The selected document is always in view: whatever selects it — the first load, a link
  // followed inside another document, a document just created — opens the folders above it.
  // Collapsing them all afterwards is the reader's to do, and stays done.
  useEffect(() => {
    const parents = ancestorFolders(selected);
    if (parents.length === 0) return;
    setExpanded((prev) => {
      if (parents.every((p) => prev.has(p))) return prev;
      const next = new Set(prev);
      for (const p of parents) next.add(p);
      return next;
    });
  }, [selected]);

  const toggleFolder = (path: string) => {
    // The serial makes toggling the same folder again a new event for the tree to animate.
    setToggled((last) => ({
      dir: path,
      open: !expanded.has(path),
      serial: (last?.serial ?? 0) + 1,
    }));
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  /** Opens a document; in one column, the document then replaces the tree. */
  const openDocument = (path: string) => {
    if (path === selected) {
      setDocShown(true);
      return;
    }
    guardDiscard(() => {
      setSelected(path);
      setDocShown(true);
    });
  };

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
    if (doc === null || saving || !dirty) return;
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
    setDocShown(true);
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
    openDocument(target);
  };

  const tree = useMemo(() => (files === null ? null : buildHandbookTree(files)), [files]);
  const filtering = query.trim() !== "";
  const shownTree = useMemo(
    () => (tree === null ? null : filterHandbookTree(tree, query)),
    [tree, query],
  );
  // A filter opens every folder it keeps, so each match is in view; clearing it gives the reader
  // back the folders as they left them.
  const rows = useMemo(
    () =>
      shownTree === null
        ? []
        : handbookTreeRows(shownTree, filtering ? folderPaths(shownTree.nodes) : expanded),
    [shownTree, filtering, expanded],
  );
  const existing = useMemo(() => new Set((files ?? []).map((f) => f.path)), [files]);
  const selectedFile = files?.find((f) => f.path === selected) ?? null;
  const isIndex = selected === HANDBOOK_INDEX;
  // A new document starts in the selected one's folder: that is where its siblings are.
  const selectedFolders = ancestorFolders(selected);
  const newDocumentFolder =
    selectedFolders.length === 0 ? "" : `${selectedFolders[selectedFolders.length - 1]!}/`;

  const title = S.nav.org.handbook;
  const info = S.company.handbook.info;

  if (tree === null || shownTree === null) {
    return (
      <OrgPage title={title} info={info} fill>
        {listError !== null ? (
          <EmptyState
            title={S.company.handbook.loadFailed}
            description={listError}
            action={<Button onClick={() => void loadList()}>{S.common.retry}</Button>}
          />
        ) : (
          <div className={BROWSER_CLASS} aria-busy="true">
            <div className="h-10 shrink-0 border-b border-line" />
            <SkeletonList rows={8} />
          </div>
        )}
      </OrgPage>
    );
  }

  const treePane = (
    <TreePane
      search={{
        value: query,
        onChange: setQuery,
        placeholder: S.company.handbook.filterPlaceholder,
      }}
      actions={
        <>
          <Tooltip label={S.company.handbook.collapseAll} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.company.handbook.collapseAll}
              disabled={expanded.size === 0 || filtering}
              onClick={() => {
                // Every folder at once is not one subtree shrinking: nothing to animate.
                setToggled(null);
                setExpanded(new Set<string>());
              }}
              className={`${filesActionClass} disabled:opacity-40`}
            >
              <GlyphIcon d={COLLAPSE_ALL_ICON} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
          {/* A new document is selected once written, which closes the editor. */}
          <Tooltip label={S.company.handbook.newDocument} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.company.handbook.newDocument}
              onClick={() =>
                guardDiscard(() => {
                  setEditing(false);
                  setCreateOpen(true);
                })
              }
              className={filesActionClass}
            >
              <GlyphIcon d={ICONS.plus} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
        </>
      }
      note={
        listError !== null
          ? null
          : filtering || tree.nodes.length > 0
            ? null
            : S.company.handbook.noOtherDocuments
      }
    >
      {listError !== null && (
        <ErrorLine
          message={S.company.handbook.loadFailed}
          detail={listError}
          onRetry={() => void loadList()}
          className="m-2"
        />
      )}
      <HandbookExplorer
        rows={rows}
        selected={selected}
        locale={locale}
        // A filter redraws the rows from another set; nothing in it is one folder toggling.
        toggled={filtering ? null : toggled}
        className="min-h-0 flex-1 overflow-auto"
        onSelect={openDocument}
        onToggle={toggleFolder}
      >
        {filtering && (
          <p className="px-3 py-2 text-sm text-fg-subtle">{S.company.handbook.noMatch}</p>
        )}
      </HandbookExplorer>
    </TreePane>
  );

  /** What the document pane draws. */
  const view: PreviewView =
    docError !== null
      ? {
          kind: "embed",
          node: (
            <EmptyState
              title={S.company.handbook.documentLoadFailed}
              description={docError}
              action={
                <Button size="sm" onClick={() => setDocAttempt((n) => n + 1)}>
                  {S.common.retry}
                </Button>
              }
            />
          ),
        }
      : doc === null
        ? { kind: "opening" }
        : doc.content.trim() === ""
          ? { kind: "embed", node: <OrgEmptyLine>{S.company.handbook.emptyDocument}</OrgEmptyLine> }
          : isMarkdownPath(doc.path)
            ? { kind: "markdown", text: doc.content, docKey: doc.path }
            : {
                kind: "source",
                code: doc.content,
                language: languageForFileName(doc.path),
                wrap: true,
              };

  const documentPane = (
    <PreviewPane
      view={view}
      // Edit rides over the text it edits, in the reader's pill beside its outline and find.
      actions={
        !editing &&
        doc !== null &&
        docError === null && (
          <Tooltip label={S.common.edit} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={S.common.edit}
              onClick={startEdit}
              className={filesActionClass}
            >
              <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
        )
      }
      editor={
        editing &&
        doc !== null && (
          <WorkspaceFileEditor
            path={doc.path}
            value={draft}
            label={selected}
            wrap
            // The text stays as it was sent while the save is in flight.
            onChange={(next) => {
              if (!saving) setDraft(next);
            }}
            onSave={() => void save()}
            isSaveKey={(event) => isShortcut(event, keymap(), "editor.save", currentPlatform())}
          />
        )
      }
      bodyProps={{ onClick: onBodyClick }}
      isFindKey={readerFind.isFindKey}
      findShortcut={readerFind.findShortcut}
    />
  );

  return (
    <OrgPage title={title} info={info} fill>
      <div ref={rootRef} className={BROWSER_CLASS}>
        {/* The document's own row: the tree's toggle (or the way back to it), the path, the
            index mark, when it was written, and what the document offers. */}
        <FilesToolbar
          layout={layout}
          previewShown={docShown}
          onBack={() => setDocShown(false)}
          treeVisible={treeVisible}
          onTreeVisibleChange={setTreeVisible}
          labels={{
            back: S.files.backToList,
            showTree: S.files.showTree,
            hideTree: S.files.hideTree,
          }}
          crumbs={[title, ...selected.split("/")].map((label) => ({ label }))}
          crumbTitle={`${title}/${selected}`}
        >
          {/* The one place the index's reason for being pinned is on screen — it says what the
              document open in this pane is, so it belongs to the document, not to a row in a
              list of them. The explorer row carries the same sentence in its tooltip and its
              accessible name. */}
          {isIndex && (
            <span className="shrink-0">
              <Badge size="sm">{S.company.handbook.indexLabel}</Badge>
            </span>
          )}
          {selectedFile !== null && (
            <span
              className="hidden shrink-0 px-1 text-xs text-fg-subtle sm:inline"
              data-tooltip={S.company.handbook.updatedAt(
                formatDateTime(selectedFile.updatedAt),
                formatBytes(selectedFile.size),
              )}
              data-tooltip-extra
            >
              {formatRelativeShort(selectedFile.updatedAt, locale)}
            </span>
          )}
          {editing ? (
            <>
              {dirty && (
                <span className={`shrink-0 text-xs ${toneInk.attention}`}>{S.files.unsaved}</span>
              )}
              <Tooltip label={S.common.cancel} placement="bottom" className="shrink-0">
                <button
                  type="button"
                  aria-label={S.common.cancel}
                  disabled={saving}
                  onClick={() => guardDiscard(() => setEditing(false))}
                  className={`${filesActionClass} disabled:opacity-40`}
                >
                  <CloseIcon size={ICON_SIZE.iconButton} />
                </button>
              </Tooltip>
              <Tooltip
                label={
                  saving
                    ? S.common.saving
                    : `${S.common.save}${saveShortcut !== null ? ` (${saveShortcut})` : ""}`
                }
                placement="bottom"
                className="shrink-0"
              >
                <button
                  type="button"
                  aria-label={S.common.save}
                  disabled={saving || !dirty}
                  onClick={() => void save()}
                  className={`${filesActionClass} disabled:opacity-40`}
                >
                  {saving ? (
                    <Spinner size="sm" label={S.common.saving} />
                  ) : (
                    <GlyphIcon d={ICONS.check} size={ICON_SIZE.iconButton} />
                  )}
                </button>
              </Tooltip>
            </>
          ) : (
            !isIndex && (
              <Tooltip label={S.common.delete} placement="bottom" className="shrink-0">
                <button
                  type="button"
                  aria-label={S.common.delete}
                  disabled={doc === null}
                  onClick={() => setDeleteOpen(true)}
                  className={`${filesActionClass} disabled:opacity-40`}
                >
                  <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                </button>
              </Tooltip>
            )
          )}
        </FilesToolbar>
        <FilesPanes
          layout={layout}
          treeAlone={!docShown}
          treeVisible={treeVisible}
          tree={treePane}
          preview={documentPane}
          dividerLabel={S.files.treeWidth}
          onTreeWidthChange={setTreeWidth}
        />
      </div>

      <NewDocumentDialog
        open={createOpen}
        folder={newDocumentFolder}
        existing={existing}
        onClose={() => setCreateOpen(false)}
        onCreate={create}
      />
      <ConfirmModal
        open={deleteOpen}
        title={S.company.handbook.deleteDocument}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={deleting}
        onClose={() => (deleting ? undefined : setDeleteOpen(false))}
        onConfirm={() => void remove()}
      >
        <p className="text-sm text-fg-muted">{S.company.handbook.deleteConfirm(selected)}</p>
      </ConfirmModal>
    </OrgPage>
  );
}

interface NewDocumentDialogProps {
  open: boolean;
  /** What the field starts with: the selected document's folder as a `<folder>/` prefix, or "". */
  folder: string;
  /** Every path the listing holds, so a duplicate is refused before it overwrites. */
  existing: ReadonlySet<string>;
  onClose: () => void;
  /** Creates the file; a rejection is shown in the dialog. */
  onCreate: (path: string) => Promise<void>;
}

/**
 * The new-document dialog: one path field, checked here as it is typed — the server's own rule,
 * a name already taken — so the problem is said under the field and Create waits for a path
 * that names a document; anything the server still refuses lands in a strip above the footer
 * with its retry.
 */
function NewDocumentDialog({ open, ...props }: NewDocumentDialogProps) {
  // No draft is kept: the field starts from the selected document's folder every time the
  // dialog opens, so a document lands beside its siblings unless the path is typed over.
  return open ? <NewDocumentForm {...props} /> : null;
}

function NewDocumentForm({
  folder,
  existing,
  onClose,
  onCreate,
}: Omit<NewDocumentDialogProps, "open">) {
  const form = useFormDraft(folder);
  const path = form.draft;
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const rel = completeHandbookPath(path);
  // A path that is only a folder names no document: the field starts as one, and completing
  // `decisions/` to `decisions.md` would create a file beside the folder rather than in it. That
  // holds Create quietly (the field is required); a path the rule refuses, or one taken, says so.
  const namesDocument = rel !== "" && !path.trim().endsWith("/");
  const pathError = !namesDocument
    ? undefined
    : !isHandbookPath(rel)
      ? S.company.handbook.pathInvalid
      : existing.has(rel)
        ? S.company.handbook.pathExists
        : undefined;
  const valid = namesDocument && pathError === undefined;

  const submit = async () => {
    if (!valid || busy) return;
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
      open
      title={S.company.handbook.newDocument}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
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
          onChange={(e) => form.setDraft(e.target.value)}
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
