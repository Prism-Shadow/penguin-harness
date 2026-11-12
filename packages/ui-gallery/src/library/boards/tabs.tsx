/**
 * 标签页: the app's Tabs, plain and with an update badge on one tab; and a tab's sub-page switch
 * under the strip, once with a button as its sub-page's control and once with a search box and a
 * button.
 */
import { useState } from "react";
import { Button, SearchInput, SubPageBar, Tabs } from "@prismshadow/penguin-ui";
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
  const subPages = t.subPageItems.map((label) => ({ key: label, label }));
  const [buttonPage, setButtonPage] = useState(subPages[1]?.key ?? "");
  const [searchPage, setSearchPage] = useState(subPages[0]?.key ?? "");
  const [query, setQuery] = useState("");
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
      <BoardGroup title={t.subPages} aside={t.subPagesHint}>
        <div className="lib-stack lib-stack-wide">
          <span className="lib-caption">{t.withButton}</span>
          <div className="lib-box">
            <Tabs items={items} active={items[1]?.key ?? ""} onChange={() => {}} />
            <div className="space-y-4 p-4">
              <SubPageBar
                label={t.subPagesLabel}
                items={subPages}
                active={buttonPage}
                onChange={setButtonPage}
                actions={
                  <Button size="sm" variant="primary">
                    {t.subPageImport}
                  </Button>
                }
              />
              <p className="text-sm">{t.subPageBody(buttonPage)}</p>
            </div>
          </div>
          <span className="lib-caption">{t.withSearch}</span>
          <div className="lib-box">
            <Tabs items={items} active={items[1]?.key ?? ""} onChange={() => {}} />
            <div className="space-y-4 p-4">
              <SubPageBar
                label={t.subPagesLabel}
                items={subPages}
                active={searchPage}
                onChange={setSearchPage}
                actions={
                  <>
                    <div className="w-full sm:w-52">
                      <SearchInput
                        size="sm"
                        value={query}
                        onChange={setQuery}
                        placeholder={t.subPageSearch}
                        aria-label={t.subPageSearch}
                      />
                    </div>
                    <Button size="sm">{t.subPageMarket}</Button>
                  </>
                }
              />
              <p className="text-sm">{t.subPageBody(searchPage)}</p>
            </div>
          </div>
        </div>
      </BoardGroup>
    </div>
  );
}
