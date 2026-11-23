import { useState } from "react";
import {
  AppRow,
  Fold,
  GroupHeader,
  GlyphIcon,
  ICONS,
  APP_ROW_ICON_PX,
  type RowActionItem,
} from "@prismshadow/penguin-ui";
import { useRunningAppRecords } from "../../lib/running-apps";
import { useSystemApps } from "../../lib/system-apps";
import { glyphOf } from "../../lib/nav-icons";
import { S } from "../../lib/strings";
import { TileIcon } from "../app-center";
import { usePageWorkspace } from "./context";

import { PAGE_DRAG_TYPE } from "./pages";
export function OpenPages({ onNavigate }: { onNavigate?: () => void }) {
  const workspace = usePageWorkspace();
  const records = useRunningAppRecords();
  const systems = useSystemApps();
  const [folded, setFolded] = useState(false);
  if (!workspace || !workspace.layout.pages.length) return null;
  const { layout, focus, place, close, whole, swap, separate, reorder } = workspace;
  const words = S.pageWorkspace;
  return (
    <nav aria-label={words.open} className="pt-2.5">
      <GroupHeader
        label={words.open}
        glyph={ICONS.appWindow}
        uppercase
        open={!folded}
        onToggle={() => setFolded(!folded)}
      />
      <Fold open={!folded}>
        <ul aria-label={words.open}>
          {layout.pages.map((page, index) => {
            const app = records.find((record) => "app:" + record.key === page.id);
            const sys = systems.find((system) => "app:system_agent/" + system.key === page.id);
            const act = (fn: () => void) => () => {
              fn();
              onNavigate?.();
            };
            const actions: RowActionItem[] = [
              {
                id: "left",
                label: words.left,
                glyph: ICONS.panelLeft,
                onSelect: act(() => place(page, 0)),
              },
              {
                id: "right",
                label: words.right,
                glyph: ICONS.panelRight,
                onSelect: act(() => place(page, 1)),
              },
              {
                id: "whole",
                label: words.whole,
                glyph: ICONS.appWindow,
                onSelect: act(() => whole(page)),
              },
              ...(layout.visible.length === 2
                ? [{ id: "swap", label: words.swap, glyph: ICONS.arrowUpDown, onSelect: act(swap) }]
                : []),
              {
                id: "separate",
                label: words.separate,
                glyph: ICONS.externalLink,
                onSelect: () => separate(page),
              },
              ...(index
                ? [
                    {
                      id: "up",
                      label: words.up,
                      glyph: ICONS.arrowUpDown,
                      onSelect: () => reorder(page.id, layout.pages[index - 1]!.id),
                    },
                  ]
                : []),
              ...(index < layout.pages.length - 1
                ? [
                    {
                      id: "down",
                      label: words.down,
                      glyph: ICONS.arrowUpDown,
                      onSelect: () => reorder(layout.pages[index + 1]!.id, page.id),
                    },
                  ]
                : []),
              {
                id: "close",
                label: S.common.close,
                glyph: ICONS.cross,
                onSelect: () => close(page.id),
              },
            ];
            return (
              <li
                key={page.id}
                data-open-page={page.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) event.preventDefault();
                }}
                onDrop={(event) => {
                  const id = event.dataTransfer.getData(PAGE_DRAG_TYPE);
                  if (id) {
                    event.preventDefault();
                    reorder(id, page.id);
                  }
                }}
              >
                <AppRow
                  appKey={page.id}
                  name={page.title}
                  active={workspace.current?.id === page.id}
                  icon={
                    app ? (
                      <TileIcon shortcut={app.shortcut} title={page.title} size={APP_ROW_ICON_PX} />
                    ) : (
                      <GlyphIcon
                        d={
                          sys
                            ? glyphOf(sys.icon)
                            : page.kind === "session"
                              ? ICONS.bubbleLines
                              : ICONS.tiles
                        }
                        size={APP_ROW_ICON_PX}
                      />
                    )
                  }
                  onOpen={act(() => focus(page))}
                  moreLabel={words.actions + " · " + page.title}
                  menuActions={actions}
                />
              </li>
            );
          })}
        </ul>
      </Fold>
    </nav>
  );
}
