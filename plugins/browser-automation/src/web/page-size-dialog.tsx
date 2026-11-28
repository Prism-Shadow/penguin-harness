/**
 * Custom page size: a width and a height in CSS px for the tab on screen. Apply (or Enter) is live
 * once both fields hold a size the server takes (page-size.ts's bounds); it asks the server and
 * closes once the page took the size, and stays open with the entry when the request fails.
 *
 * Mounted for one opening at a time (the menu renders it only while it is open), so every opening
 * starts from the tab's fixed size, or the common laptop size while it fits the panel.
 */
import { useState, type KeyboardEvent } from "react";
import { Button, Input, Modal } from "@prismshadow/penguin-ui";
import type { Size } from "./geometry";
import { PAGE_SIZE_PRESETS, pageEdge, resizeTab } from "./page-size";
import { S } from "./strings";

export function PageSizeDialog({
  tabId,
  initial,
  onClose,
}: {
  tabId: number;
  /** The tab's fixed size; null while it fits the panel. */
  initial: Size | null;
  onClose: () => void;
}) {
  const start = initial ?? PAGE_SIZE_PRESETS[0]!;
  const [width, setWidth] = useState(String(start.width));
  const [height, setHeight] = useState(String(start.height));
  const [saving, setSaving] = useState(false);
  const size = (() => {
    const w = pageEdge(width);
    const h = pageEdge(height);
    return w === null || h === null ? null : { width: w, height: h };
  })();

  const apply = async () => {
    if (saving || size === null) return;
    setSaving(true);
    if (await resizeTab(tabId, size)) onClose();
    else setSaving(false);
  };
  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void apply();
  };

  return (
    <Modal
      open
      title={S.builtinBrowser.customSizeTitle}
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={saving}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void apply()}
            disabled={saving || size === null}
          >
            {S.builtinBrowser.sizeApply}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">{S.builtinBrowser.customSizeIntro}</p>
        <div className="flex items-start gap-3">
          <Input
            size="sm"
            autoFocus
            inputMode="numeric"
            data-testid="builtin-browser-size-width"
            label={S.builtinBrowser.sizeWidth}
            hint={S.builtinBrowser.sizeHint}
            value={width}
            disabled={saving}
            onChange={(e) => setWidth(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={submitOnEnter}
          />
          <Input
            size="sm"
            inputMode="numeric"
            data-testid="builtin-browser-size-height"
            label={S.builtinBrowser.sizeHeight}
            hint={S.builtinBrowser.sizeHint}
            value={height}
            disabled={saving}
            onChange={(e) => setHeight(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={submitOnEnter}
          />
        </div>
      </div>
    </Modal>
  );
}
