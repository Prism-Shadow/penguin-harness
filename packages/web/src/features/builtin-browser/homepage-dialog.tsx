/**
 * Set homepage: the page a new tab opens and the toolbar's Home button goes to. The field
 * reads an entry the way the address bar does (address.ts) — a bare domain gets https, other
 * words become a search — and its hint shows the page the entry will open. "Use current page"
 * takes the page on screen and "Clear" empties the field; saving an empty field removes the
 * homepage, so new tabs open blank again and the Home button goes away.
 *
 * Mounted for one opening at a time (the panel renders it only while it is open), so every
 * opening starts from the homepage as saved.
 */
import { useState } from "react";
import { Button } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastError } from "../../components/ui/toast";
import { homepageFromInput } from "./address";
import { dispatchBrowser } from "./browser-store";

export function HomepageDialog({
  homepage,
  currentPage,
  onClose,
}: {
  /** The homepage as saved; null for none. */
  homepage: string | null;
  /** The web page on screen, which "Use current page" takes; null when there is none. */
  currentPage: string | null;
  onClose: () => void;
}) {
  const [text, setText] = useState(homepage ?? "");
  const [saving, setSaving] = useState(false);
  const target = homepageFromInput(text);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await api.putBuiltinBrowserSettings({ homepage: target });
      dispatchBrowser({ type: "settings", settings: saved });
      onClose();
    } catch (err) {
      // The dialog stays open with the entry, so the save can be tried again.
      toastError(S.builtinBrowser.homepageFailed(apiErrorText(err)));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={S.builtinBrowser.homepageTitle}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={saving}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? S.common.saving : S.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.builtinBrowser.homepageIntro}</p>
        <Input
          size="sm"
          autoFocus
          data-testid="builtin-browser-homepage-input"
          label={S.builtinBrowser.homepageAddress}
          hint={
            target === null
              ? S.builtinBrowser.homepageHintEmpty
              : S.builtinBrowser.homepageHintOpens(target)
          }
          placeholder={S.builtinBrowser.homepagePlaceholder}
          spellCheck={false}
          value={text}
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void save();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={currentPage === null || saving}
            onClick={() => {
              if (currentPage !== null) setText(currentPage);
            }}
          >
            {S.builtinBrowser.homepageUseCurrent}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={text === "" || saving}
            onClick={() => setText("")}
          >
            {S.builtinBrowser.homepageClear}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
