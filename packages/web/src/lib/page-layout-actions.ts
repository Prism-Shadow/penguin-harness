import { ICONS, type RowActionItem } from "@prismshadow/penguin-ui";
import type { OpenPage } from "./page-layout";
import type { Workspace } from "./page-workspace";
import { S } from "./strings";

export function layoutActions(
  workspace: Workspace,
  page: OpenPage,
  onNavigate?: () => void,
): RowActionItem[] {
  const apply = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };
  const words = S.pageWorkspace;
  return [
    {
      id: "left",
      label: words.left,
      glyph: ICONS.panelLeft,
      onSelect: apply(() => workspace.place(page, 0)),
    },
    {
      id: "right",
      label: words.right,
      glyph: ICONS.panelRight,
      onSelect: apply(() => workspace.place(page, 1)),
    },
    ...(workspace.layout.visible.length === 2
      ? [
          {
            id: "whole",
            label: words.whole,
            glyph: ICONS.square,
            onSelect: apply(() => workspace.whole(page)),
          },
          {
            id: "swap",
            label: words.swap,
            glyph: ICONS.arrowUpDown,
            onSelect: apply(workspace.swap),
          },
        ]
      : []),
    {
      id: "separate",
      label: words.separate,
      glyph: ICONS.externalLink,
      onSelect: () => workspace.separate(page),
    },
  ];
}
