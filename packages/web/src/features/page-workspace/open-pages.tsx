import { useRef, useState, type KeyboardEvent } from "react";
import {
  AppRow,
  Fold,
  MoreRow,
  Modal,
  SearchInput,
  GroupHeader,
  GlyphIcon,
  GlyphAppIcon,
  ICONS,
  APP_ROW_ICON_PX,
  type RowActionItem,
} from "@prismshadow/penguin-ui";
import { useRunningAppRecords } from "../../lib/running-apps";
import { useSystemApps } from "../../lib/system-apps";
import { glyphOf } from "../../lib/nav-icons";
import { S } from "../../lib/strings";
import { TileIcon } from "../app-center";
import { usePageWorkspace } from "../../lib/page-workspace";

import { PAGE_DRAG_TYPE, inlinePages, type OpenPage } from "../../lib/page-layout";
export function OpenPages({ onNavigate }: { onNavigate?: () => void }) {
  const workspace = usePageWorkspace();
  const records = useRunningAppRecords();
  const systems = useSystemApps();
  const [folded, setFolded] = useState(false);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const list = useRef<HTMLUListElement>(null);
  if (!workspace || !workspace.layout.pages.length) return null;
  const {
    layout,
    current,
    minimize,
    fullScreen,
    focus,
    place,
    close,
    whole,
    swap,
    separate,
    reorder,
  } = workspace;
  const words = S.pageWorkspace;
  const rows = inlinePages(layout);
  const search = query.trim().toLocaleLowerCase();
  const matches = all
    ? layout.pages.filter((p) => p.title.toLocaleLowerCase().includes(search))
    : [];
  function keyboard(event: KeyboardEvent, fromInput: boolean) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>("button[data-app-row]") ?? [],
    );
    if (!buttons.length) return;
    if (fromInput && event.key === "Enter") {
      event.preventDefault();
      buttons[0]?.click();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (!fromInput && index < 0) return;
    event.preventDefault();
    buttons[
      index < 0
        ? event.key === "ArrowDown"
          ? 0
          : buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus();
  }
  function row(page: OpenPage) {
    const index = layout.pages.indexOf(page);
    const app = records.find((record) => "app:" + record.key === page.id);
    const sys = systems.find((system) => "app:system_agent/" + system.key === page.id);
    const act = (fn: () => void) => () => {
      setAll(false);
      fn();
      onNavigate?.();
    };
    const side = layout.visible.indexOf(page.id);
    const pane =
      layout.visible.length === 2 && side >= 0
        ? side === 0
          ? words.leftPane
          : words.rightPane
        : undefined;
    const actions: RowActionItem[] = [
      side >= 0
        ? {
            id: "minimize",
            label: S.appCenter.windowMinimize,
            glyph: ICONS.minus,
            onSelect: act(() => minimize(page.id)),
          }
        : {
            id: "restore",
            label: words.restore,
            glyph: ICONS.appWindow,
            onSelect: act(() => focus(page)),
          },
      ...(app
        ? [
            {
              id: "fullscreen",
              label: S.appCenter.windowFullScreen,
              glyph: ICONS.square,
              onSelect: act(() => fullScreen(page)),
            },
          ]
        : []),
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
      <AppRow
        key={page.id}
        drag={{
          draggable: true,
          onDragStart(event) {
            event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id);
            event.dataTransfer.effectAllowed = "move";
          },
          onDragOver(event) {
            if (event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) event.preventDefault();
          },
          onDrop(event) {
            const id = event.dataTransfer.getData(PAGE_DRAG_TYPE);
            if (id) {
              event.preventDefault();
              reorder(id, page.id);
            }
          },
        }}
        appKey={page.id}
        name={page.title}
        {...(pane
          ? {
              label: page.title + " · " + pane,
              hint: pane,
              suffix: <GlyphIcon d={side === 0 ? ICONS.panelLeft : ICONS.panelRight} size={14} />,
            }
          : {})}
        active={current?.id === page.id}
        icon={
          app ? (
            <TileIcon shortcut={app.shortcut} title={page.title} size={APP_ROW_ICON_PX} />
          ) : sys ? (
            <GlyphAppIcon appKey={sys.key} d={glyphOf(sys.icon)} size={APP_ROW_ICON_PX} />
          ) : (
            <GlyphIcon
              d={page.kind === "session" ? ICONS.bubbleLines : ICONS.tiles}
              size={APP_ROW_ICON_PX}
            />
          )
        }
        onOpen={act(() => focus(page))}
        moreLabel={words.actions + " · " + page.title}
        menuActions={actions}
      />
    );
  }
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
        <ul aria-label={words.open}>{rows.map(row)}</ul>
      </Fold>
      <MoreRow
        label={words.count(layout.pages.length)}
        ariaLabel={words.count(layout.pages.length)}
        onClick={() => {
          setQuery("");
          setAll(true);
        }}
      />
      <Modal open={all} onClose={() => setAll(false)} title={words.all}>
        <SearchInput
          autoFocus
          value={query}
          onChange={setQuery}
          aria-label={words.search}
          placeholder={words.search}
          onKeyDown={(event) => keyboard(event, true)}
        />
        <ul
          ref={list}
          aria-label={words.all}
          className="mt-2 max-h-[55dvh] overflow-y-auto"
          onKeyDown={(event) => keyboard(event, false)}
        >
          {matches.map(row)}
        </ul>
        {!matches.length && (
          <p role="status" className="p-3 text-sm text-fg-muted">
            {words.noMatches}
          </p>
        )}
      </Modal>
    </nav>
  );
}
