/** 空状态: the page placeholder with and without an action, and the settings one. */
import { Button } from "../../../../web/src/components/ui/button";
import { EmptyState, SettingsEmpty } from "../../../../web/src/components/ui/empty-state";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function EmptyBoard() {
  const { S } = useGallery();
  const t = S.library.empty;
  return (
    <div className="gf-board">
      <BoardGroup title={t.page}>
        <div className="lib-box">
          <EmptyState
            title={t.title}
            description={t.description}
            action={<Button variant="primary">{t.action}</Button>}
          />
        </div>
        <div className="lib-box">
          <EmptyState title={t.title} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.settings}>
        <div className="lib-box">
          <SettingsEmpty>{t.settingsText}</SettingsEmpty>
        </div>
      </BoardGroup>
    </div>
  );
}
