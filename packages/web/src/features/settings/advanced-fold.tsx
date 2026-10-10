/**
 * A settings card's Advanced fold: the fields a group marks `advanced`, collapsed by default
 * under one row, so the card leads with what most people change. It follows the WAI-ARIA
 * disclosure pattern like `HelpFold`: a real button carrying `aria-expanded` and
 * `aria-controls`, and a panel that stays in the DOM, `hidden` while collapsed, so the
 * reference always resolves. Inline flow, so no portal.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Chevron, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export function AdvancedFold({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className="border-t border-line-muted pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center rounded-md py-1 text-xs font-medium text-fg-muted transition-colors duration-150 hover:text-fg ${ICON_GAP.row}`}
      >
        <Chevron open={open} size={ICON_SIZE.chevronDense} />
        {S.settings.pluginAdvanced}
      </button>
      <div id={panelId} hidden={!open} className="space-y-3 pt-2">
        {children}
      </div>
    </div>
  );
}
