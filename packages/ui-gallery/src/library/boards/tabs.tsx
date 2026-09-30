/** 标签页: the app's Tabs, plain and with an update badge on one tab. */
import { useState } from "react";
import { Tabs } from "../../../../web/src/components/ui/tabs";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function TabsBoard() {
  const { S } = useGallery();
  const t = S.library.tabs;
  const items = t.items.map((label) => ({ key: label, label }));
  const [active, setActive] = useState(items[0]?.key ?? "");
  const [badgedActive, setBadgedActive] = useState(items[0]?.key ?? "");
  const badged = items.map((item, index) =>
    index === items.length - 1 ? { ...item, badge: t.badgeText } : item,
  );
  return (
    <div className="gf-board">
      <BoardGroup title={t.basic}>
        <div className="lib-box">
          <Tabs items={items} active={active} onChange={setActive} />
          <p className="p-4 text-sm">{t.body(active)}</p>
        </div>
      </BoardGroup>
      <BoardGroup title={t.badged}>
        <div className="lib-box">
          <Tabs items={badged} active={badgedActive} onChange={setBadgedActive} />
          <p className="p-4 text-sm">{t.body(badgedActive)}</p>
        </div>
      </BoardGroup>
    </div>
  );
}
