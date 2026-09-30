/** 提示弹窗: the toast after an action completes, in its four kinds, fired from buttons (the Toaster is mounted by the frame). */
import { Button } from "@prismshadow/penguin-ui";
import {
  toastAttention,
  toastError,
  toastInfo,
  toastSuccess,
} from "../../../../web/src/components/ui/toast";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function ToastsBoard() {
  const { S } = useGallery();
  const t = S.library.toasts;
  return (
    <div className="gf-board">
      <BoardGroup title={t.fire} aside={t.hint}>
        <div className="lib-row">
          <Button variant="primary" onClick={() => toastSuccess(t.successText)}>
            {t.success}
          </Button>
          <Button onClick={() => toastInfo(t.infoText)}>{t.info}</Button>
          <Button onClick={() => toastAttention(t.attentionText)}>{t.attention}</Button>
          <Button variant="danger" onClick={() => toastError(t.errorText)}>
            {t.error}
          </Button>
        </div>
      </BoardGroup>
    </div>
  );
}
