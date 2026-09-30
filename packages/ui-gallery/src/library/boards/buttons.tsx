/** 按钮: the app's Button in its four variants, two sizes and the icon form, disabled and busy. */
import { Button } from "../../../../web/src/components/ui/button";
import { PlusIcon } from "../../../../web/src/components/ui/icons";
import { StatusIcon } from "../../../../web/src/components/ui/status-icon";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function ButtonsBoard() {
  const { S } = useGallery();
  const t = S.library.buttons;
  return (
    <div className="gf-board">
      <BoardGroup title={t.variants}>
        <div className="lib-row">
          <Button variant="primary">{t.primary}</Button>
          <Button variant="secondary">{t.secondary}</Button>
          <Button variant="danger">{t.danger}</Button>
          <Button variant="ghost">{t.ghost}</Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.sizes}>
        <div className="lib-row">
          <Button variant="primary" size="md">
            {t.md}
          </Button>
          <Button variant="primary" size="sm">
            {t.sm}
          </Button>
          <Button variant="secondary" size="icon" aria-label={t.icon} data-tooltip={t.icon}>
            <PlusIcon />
          </Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.states}>
        <div className="lib-row">
          <Button variant="primary" disabled>
            {t.disabled}
          </Button>
          <Button variant="secondary" disabled>
            {t.disabled}
          </Button>
          <Button variant="primary" disabled aria-busy>
            <StatusIcon state="running" />
            <span>{t.busy}</span>
          </Button>
        </div>
      </BoardGroup>
    </div>
  );
}
