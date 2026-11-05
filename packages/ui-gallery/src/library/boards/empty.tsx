/** 空状态: the page placeholder with and without an action, and the dashed slot form. */
import { Button, EmptyState, SettingsEmpty } from "@prismshadow/penguin-ui";
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
        <div className="lib-stack">
          <SettingsEmpty>{t.settingsText}</SettingsEmpty>
          <EmptyState dashed title={t.title} description={t.description} />
        </div>
      </BoardGroup>
    </div>
  );
}
