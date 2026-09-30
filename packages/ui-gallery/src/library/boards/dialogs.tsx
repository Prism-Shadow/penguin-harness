/** 对话框: Modal, ConfirmModal, Drawer and Sheet, each opened from a button and closed as the app closes it. */
import { useState } from "react";
import { Button } from "../../../../web/src/components/ui/button";
import { ConfirmModal } from "../../../../web/src/components/ui/confirm-modal";
import { Drawer } from "../../../../web/src/components/ui/drawer";
import { Input } from "../../../../web/src/components/ui/input";
import { Modal } from "../../../../web/src/components/ui/modal";
import { Sheet } from "../../../../web/src/components/ui/sheet";
import type { SheetSnap } from "../../../../web/src/components/ui/sheet";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function DialogsBoard() {
  const { S } = useGallery();
  const t = S.library.dialogs;
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [name, setName] = useState(t.modalTitle);
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
        </div>
        <ConfirmModal
          open={confirm}
          title={t.confirmTitle}
          confirmLabel={t.confirmLabel}
          onClose={() => setConfirm(false)}
          onConfirm={() => setConfirm(false)}
        >
          {t.confirmBody}
        </ConfirmModal>
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
    </div>
  );
}
