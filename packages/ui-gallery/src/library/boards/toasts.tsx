/**
 * 提示弹窗: the package's toast after an action completes, in its four kinds, and one carrying an
 * action after its text, fired from buttons (the Toaster is mounted by the frame).
 */
import {
  Button,
  toastAttention,
  toastError,
  toastInfo,
  toastSuccess,
} from "@prismshadow/penguin-ui";
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
          <Button
            onClick={() =>
              toastInfo(t.actionText, {
                action: { label: t.undo, onPress: () => toastSuccess(t.undone) },
              })
            }
          >
            {t.withAction}
          </Button>
        </div>
      </BoardGroup>
    </div>
  );
}
