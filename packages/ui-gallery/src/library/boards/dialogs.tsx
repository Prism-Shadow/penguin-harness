/**
 * 对话框: Modal, ConfirmModal in both tones, PagedDialog, Drawer, Sheet and the Lightbox, each
 * opened from a button (the lightbox from its thumbnail) and closed as the app closes it.
 */
import { useState } from "react";
import {
  Button,
  ConfirmModal,
  Drawer,
  Input,
  Modal,
  PagedDialog,
  Sheet,
  ZoomableImage,
} from "@prismshadow/penguin-ui";
import type { PagedDialogGroup, SheetSnap } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { BASE } from "../../lib/location";
import { useGallery } from "../../state";

type Page = "general" | "appearance" | "account";

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
          <p className="text-sm">{t.pageBody}</p>
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
    </div>
  );
}
