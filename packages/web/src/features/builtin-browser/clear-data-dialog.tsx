/**
 * Clear browsing data: which of the built-in browser's stores to empty — sign-ins, the cache,
 * site storage, history — in the app's compact confirmation card. Every kind starts checked
 * on each opening; the confirm stays disabled while none is.
 */
import { useEffect, useState } from "react";
import { Checkbox, ConfirmModal, toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import type { BuiltinBrowserStorage } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";

type ClearKind = BuiltinBrowserStorage | "history";

const KINDS: readonly ClearKind[] = ["cookies", "cache", "storage", "history"];

function kindLabel(kind: ClearKind): string {
  switch (kind) {
    case "cookies":
      return S.builtinBrowser.clearCookies;
    case "cache":
      return S.builtinBrowser.clearCache;
    case "storage":
      return S.builtinBrowser.clearStorage;
    case "history":
      return S.builtinBrowser.clearHistory;
  }
}

export function ClearDataDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [chosen, setChosen] = useState<ReadonlySet<ClearKind>>(() => new Set(KINDS));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setChosen(new Set(KINDS));
  }, [open]);

  const toggle = (kind: ClearKind, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(kind);
      else next.delete(kind);
      return next;
    });

  const run = async () => {
    const storages = KINDS.filter(
      (kind): kind is BuiltinBrowserStorage => kind !== "history" && chosen.has(kind),
    );
    setBusy(true);
    try {
      if (storages.length > 0) await api.clearBuiltinBrowserData(storages);
      if (chosen.has("history")) await api.clearBuiltinBrowserHistory();
      toastSuccess(S.builtinBrowser.clearDone);
      onClose();
    } catch (err) {
      toastError(S.builtinBrowser.clearFailed(apiErrorText(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmModal
      open={open}
      title={S.builtinBrowser.clearTitle}
      onClose={onClose}
      onConfirm={() => void run()}
      confirmLabel={S.builtinBrowser.clearConfirm}
      cancelLabel={S.common.cancel}
      confirmDisabled={chosen.size === 0}
      busy={busy}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">{S.builtinBrowser.clearBody}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {KINDS.map((kind) => (
          <Checkbox
            key={kind}
            checked={chosen.has(kind)}
            disabled={busy}
            onChange={(on) => toggle(kind, on)}
            label={kindLabel(kind)}
            className="text-gray-700 dark:text-gray-300"
          />
        ))}
      </div>
    </ConfirmModal>
  );
}
