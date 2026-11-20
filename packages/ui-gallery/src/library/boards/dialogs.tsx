/**
 * 对话框: Modal, ConfirmModal in both tones, PagedDialog (a page longer than the dialog, with its
 * foot), Drawer, Sheet, the Lightbox and the
 * CommandPalette, each opened from a button (the lightbox from its thumbnail) and closed as the app
 * closes it. The palette's actions open the board's other dialogs, the way an app action opens its
 * own overlay once the palette has gone. Last, the UnfoldSurface: three folders in a short scroll
 * area, each unfolding in place from its icon, its apps travelling out of the previews.
 */
import { useState } from "react";
import {
  AppIconShape,
  Button,
  CommandPalette,
  ConfirmModal,
  Drawer,
  ImageIcon,
  Input,
  Modal,
  PagedDialog,
  PagedDialogFoot,
  Sheet,
  UnfoldSurface,
  ZoomableImage,
} from "@prismshadow/penguin-ui";
import type { PagedDialogGroup, PaletteAction, SheetSnap } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { BASE } from "../../lib/location";
import { useGallery } from "../../state";
import { sampleAppArt } from "../app-art";

type Page = "general" | "appearance" | "account";

/** A folder icon's previews: inset and gap inside the 56px square, and each preview's edge. */
const FOLDER_INSET = 6;
const FOLDER_GAP = 4;
const PREVIEW = 20;
/** Each sample folder holds six apps. */
const appsOf = (folder: number) => Array.from({ length: 6 }, (_, i) => folder * 6 + i);

/**
 * Three folders in a scroll area shorter than its content, as the App Center's grid sits in its
 * page: open one near the bottom and the surface stays inside what is visible.
 */
function UnfoldDemo() {
  const { S } = useGallery();
  const t = S.library.dialogs;
  const [open, setOpen] = useState<number | null>(null);
  // The surface stays mounted while it folds back, then goes.
  const [shown, setShown] = useState<number | null>(null);
  if (open !== null && shown !== open) setShown(open);
  const triggerId = (folder: number) => `unfold-demo-${folder}`;
  const surfaceId = (folder: number) => `unfold-demo-${folder}-surface`;
  return (
    <div className="h-72 w-full max-w-lg overflow-y-auto rounded-md border border-line">
      <div className="relative min-h-[28rem] p-4">
        <ul className="grid grid-cols-3 gap-4">
          {t.unfoldFolders.map((name, folder) => (
            <li key={name}>
              <button
                id={triggerId(folder)}
                type="button"
                aria-expanded={open === folder}
                aria-controls={open === folder ? surfaceId(folder) : undefined}
                data-unfold-demo-folder
                onClick={() => setOpen(open === folder ? null : folder)}
                className="flex w-full flex-col items-center gap-2 rounded-md p-2 text-sm text-fg hover:bg-fg/5"
              >
                <AppIconShape
                  data-unfold-from
                  className="grid grid-cols-2 content-start bg-fg/10"
                  style={{ padding: FOLDER_INSET, gap: FOLDER_GAP }}
                >
                  {appsOf(folder)
                    .slice(0, 4)
                    .map((app) => (
                      <span key={app} data-unfold-source={app} className="flex">
                        <AppIconShape size={PREVIEW}>
                          <ImageIcon icon={sampleAppArt(app)} size={PREVIEW} fallback={null} />
                        </AppIconShape>
                      </span>
                    ))}
                </AppIconShape>
                {name}
              </button>
            </li>
          ))}
        </ul>
        {shown !== null && (
          <UnfoldSurface
            key={shown}
            id={surfaceId(shown)}
            open={open === shown}
            triggerId={triggerId(shown)}
            title={t.unfoldFolders[shown]}
            backLabel={t.unfoldBack}
            onClose={() => setOpen(null)}
            onExited={() => setShown(null)}
            keepOpenWithin="[data-unfold-demo-folder]"
          >
            <ul className="grid grid-cols-3 gap-2 p-3">
              {appsOf(shown).map((app) => (
                <li key={app} className="flex flex-col items-center gap-2 p-2">
                  <AppIconShape clip={false} data-unfold-art={app}>
                    <span className="block">
                      <AppIconShape>
                        <ImageIcon icon={sampleAppArt(app)} size={56} fallback={null} />
                      </AppIconShape>
                    </span>
                  </AppIconShape>
                  <span data-unfold-fade className="text-sm text-fg">
                    {t.unfoldItem(app + 1)}
                  </span>
                </li>
              ))}
            </ul>
          </UnfoldSurface>
        )}
      </div>
    </div>
  );
}

export function DialogsBoard() {
  const { S } = useGallery();
  const t = S.library.dialogs;
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saveConfirm, setSaveConfirm] = useState(false);
  const [paged, setPaged] = useState(false);
  const [page, setPage] = useState<Page>("general");
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [palette, setPalette] = useState(false);
  const [name, setName] = useState(t.modalTitle);
  const groups: PagedDialogGroup<Page>[] = [
    {
      key: "app",
      label: t.pagedGroups.app,
      items: [
        { key: "general", label: t.pages.general },
        { key: "appearance", label: t.pages.appearance, info: t.appearanceInfo },
      ],
    },
    { key: "you", label: t.pagedGroups.you, items: [{ key: "account", label: t.pages.account }] },
  ];
  const actions: PaletteAction[] = [
    { id: "modal", label: t.modalTitle, run: () => setModal(true) },
    { id: "paged", label: t.openPaged, run: () => setPaged(true) },
    { id: "drawer", label: t.openDrawer, run: () => setDrawer(true) },
    { id: "sheet", label: t.openSheet, run: () => setSheet(true) },
  ];
  return (
    <div className="gf-board">
      <BoardGroup title={t.modal}>
        <div className="lib-row">
          <Button variant="primary" onClick={() => setModal(true)}>
            {t.openModal}
          </Button>
        </div>
        <Modal
          open={modal}
          title={t.modalTitle}
          onClose={() => setModal(false)}
          footer={
            <>
              <Button size="sm" onClick={() => setModal(false)}>
                {t.cancel}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setModal(false)}>
                {t.save}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm">{t.modalBody}</p>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Modal>
      </BoardGroup>
      <BoardGroup title={t.confirm}>
        <div className="lib-row">
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {t.openConfirm}
          </Button>
          <Button onClick={() => setSaveConfirm(true)}>{t.openSaveConfirm}</Button>
        </div>
        <ConfirmModal
          open={confirm}
          title={t.confirmTitle}
          confirmLabel={t.confirmLabel}
          cancelLabel={t.cancel}
          onClose={() => setConfirm(false)}
          onConfirm={() => setConfirm(false)}
        >
          {t.confirmBody}
        </ConfirmModal>
        <ConfirmModal
          open={saveConfirm}
          title={t.saveConfirmTitle}
          tone="primary"
          confirmLabel={t.save}
          cancelLabel={t.cancel}
          onClose={() => setSaveConfirm(false)}
          onConfirm={() => setSaveConfirm(false)}
        >
          {t.saveConfirmBody}
        </ConfirmModal>
      </BoardGroup>
      <BoardGroup title={t.paged}>
        <div className="lib-row">
          <Button onClick={() => setPaged(true)}>{t.openPaged}</Button>
        </div>
        <PagedDialog
          open={paged}
          onClose={() => setPaged(false)}
          title={t.pagedTitle}
          groups={groups}
          active={page}
          onSelect={setPage}
        >
          {page === "general" ? (
            // A page longer than the dialog: the pane scrolls under its heading while the rail
            // stays put, and the foot keeps Save at the dialog's bottom edge.
            <>
              <ul className="divide-y divide-line-muted text-sm">
                {Array.from({ length: 24 }, (_, i) => (
                  <li key={i} className="py-2.5">
                    {t.pageRow(i + 1)}
                  </li>
                ))}
              </ul>
              <PagedDialogFoot className="flex justify-end">
                <Button size="sm" variant="primary" onClick={() => setPaged(false)}>
                  {t.save}
                </Button>
              </PagedDialogFoot>
            </>
          ) : (
            <p className="text-sm">{t.pageBody}</p>
          )}
        </PagedDialog>
      </BoardGroup>
      <BoardGroup title={t.drawer}>
        <div className="lib-row">
          <Button onClick={() => setDrawer(true)}>{t.openDrawer}</Button>
        </div>
        <Drawer open={drawer} title={t.drawerTitle} onClose={() => setDrawer(false)}>
          <p className="p-4 text-sm">{t.drawerBody}</p>
        </Drawer>
      </BoardGroup>
      <BoardGroup title={t.sheet}>
        <div className="lib-row">
          <Button onClick={() => setSheet(true)}>{t.openSheet}</Button>
        </div>
        <Sheet
          open={sheet}
          snap={snap}
          onSnapChange={setSnap}
          title={t.sheetTitle}
          onClose={() => setSheet(false)}
        >
          <p className="p-4 text-sm">{t.sheetBody}</p>
        </Sheet>
      </BoardGroup>
      <BoardGroup title={t.lightbox} aside={t.lightboxHint}>
        <div className="lib-row">
          <ZoomableImage
            src={`${BASE}/penguin-logo.svg`}
            alt={t.lightboxAlt}
            className="h-16 w-16"
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.palette} aside={t.paletteAside}>
        <div className="lib-row">
          <Button onClick={() => setPalette(true)}>{t.openPalette}</Button>
        </div>
        <CommandPalette
          open={palette}
          onClose={() => setPalette(false)}
          actions={actions}
          title={t.palette}
          placeholder={t.palettePlaceholder}
          emptyText={t.paletteEmpty}
          hint={t.paletteHint}
        />
      </BoardGroup>
      <BoardGroup title={t.unfold} aside={t.unfoldAside}>
        <UnfoldDemo />
      </BoardGroup>
    </div>
  );
}
