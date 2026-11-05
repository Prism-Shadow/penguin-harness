/**
 * Settings › Personal › Browser: the user's agent browser.
 *
 * - Which browser the agents drive, Built-in or System Chrome — only in the desktop app, where
 *   the server offers both (GET /backend's `choices`). It applies on the click, like the Browser
 *   panel's own choice; an agent at work refuses it with a toast.
 * - The Chromes paired to the account: the extension's name, its version, when it was last
 *   connected, and a dot for whether it is connected now. Revoke asks first — the agents lose
 *   that Chrome and it has to be paired again — and the list follows the server's word on the
 *   user's Chrome as it arrives.
 * - Connect another Chrome (Connect your Chrome while none is paired): the pairing dialog. While
 *   the admin's switch is off a line says so instead.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type {
  BrowserBackend,
  BrowserBackendResponse,
  BrowserExtensionRecord,
  BrowserExtensionsResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  Dot,
  PrefRow,
  Segmented,
  SettingRow,
  SettingsEmpty,
  SettingsGroup,
  SettingsSection,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { switchBrowserBackend } from "../builtin-browser/browser-actions";
import { browserState, subscribeBrowser } from "../builtin-browser/browser-store";
import { PairingDialog } from "../builtin-browser/pairing-dialog";

/** Forgets a paired Chrome on the server; true once it is gone. Reached only through the confirm. */
const revokeChrome = async (record: BrowserExtensionRecord): Promise<boolean> => {
  try {
    await api.revokeBrowserExtension(record.id);
  } catch (err) {
    toastError(S.browserSettings.revokeFailed(apiErrorText(err)));
    return false;
  }
  toastSuccess(S.browserSettings.revoked(record.name));
  return true;
};

/**
 * The question before a revoke: the danger tone, the Chrome by name, and what follows — the
 * agents lose it and it must be paired again. Open while `record` is set.
 */
export function RevokeConfirm({
  record,
  onClose,
  onRevoked,
}: {
  record: BrowserExtensionRecord | null;
  onClose: () => void;
  onRevoked: () => void;
}) {
  return (
    <ConfirmModal
      open={record !== null}
      title={S.browserSettings.revokeTitle}
      onClose={onClose}
      onConfirm={() => {
        if (record === null) return;
        onClose();
        void revokeChrome(record).then((gone) => {
          if (gone) onRevoked();
        });
      }}
      confirmLabel={S.browserSettings.revoke}
      cancelLabel={S.common.cancel}
    >
      <p className="text-sm text-fg-muted">
        {record !== null ? S.browserSettings.revokeBody(record.name) : null}
      </p>
    </ConfirmModal>
  );
}

/**
 * The paired Chromes, one ruled row each: the state dot and the name, the version and when it
 * was last connected under it, Revoke at the end (which only asks). Null while loading.
 */
export function PairedChromes({
  list,
  onRevoke,
}: {
  list: BrowserExtensionsResponse | null;
  onRevoke: (record: BrowserExtensionRecord) => void;
}) {
  if (list === null) return null;
  return (
    <SettingsGroup title={S.browserSettings.paired}>
      {list.paired.length === 0 ? (
        <SettingsEmpty>{S.browserSettings.pairedNone}</SettingsEmpty>
      ) : (
        list.paired.map((record) => (
          <SettingRow
            key={record.id}
            title={
              <span data-testid="paired-chrome" className="flex items-center gap-1.5">
                <Dot
                  tone={record.connected ? "success" : "neutral"}
                  label={
                    record.connected ? S.browserSettings.connected : S.browserSettings.notConnected
                  }
                />
                <span className="min-w-0 truncate">{record.name}</span>
              </span>
            }
            description={S.browserSettings.pairedLine(
              record.version,
              record.lastSeenAt !== null ? formatDateTime(record.lastSeenAt) : null,
            )}
          >
            <Button size="sm" onClick={() => onRevoke(record)}>
              {S.browserSettings.revoke}
            </Button>
          </SettingRow>
        ))
      )}
    </SettingsGroup>
  );
}

export function BrowserSection() {
  const [choice, setChoice] = useState<BrowserBackendResponse | null>(null);
  const [list, setList] = useState<BrowserExtensionsResponse | null>(null);
  const [revoking, setRevoking] = useState<BrowserExtensionRecord | null>(null);
  const [pairing, setPairing] = useState(false);
  // The server's word on the user's Chrome, and the backend as this window follows it.
  const readNews = () => browserState().extension.seq;
  const readBackend = () => browserState().backend;
  const news = useSyncExternalStore(subscribeBrowser, readNews, readNews);
  const backend = useSyncExternalStore(subscribeBrowser, readBackend, readBackend);

  const loadList = useCallback(() => {
    api
      .getBrowserExtensions()
      .then(setList)
      .catch((err: unknown) => toastError(S.browserSettings.loadFailed(apiErrorText(err))));
  }, []);
  useEffect(() => loadList(), [loadList, news]);
  useEffect(() => {
    api
      .getBrowserBackend()
      .then(setChoice)
      .catch(() => setChoice(null));
  }, [backend]);

  const choosable =
    choice !== null && choice.choices.includes("builtin") && choice.choices.includes("chrome");
  const pick = (next: BrowserBackend) => {
    if (choice === null || next === choice.backend) return;
    void switchBrowserBackend(next);
  };

  return (
    <SettingsSection>
      {choosable && (
        <SettingsGroup>
          <PrefRow label={S.browserSettings.backend} info={S.browserSettings.backendInfo}>
            <Segmented
              cols={2}
              options={[
                { value: "builtin", label: S.builtinBrowser.backendBuiltin },
                { value: "chrome", label: S.builtinBrowser.backendChrome },
              ]}
              value={choice.backend}
              onChange={pick}
            />
          </PrefRow>
        </SettingsGroup>
      )}
      <PairedChromes list={list} onRevoke={setRevoking} />
      {list !== null &&
        (list.enabled ? (
          <div>
            <Button size="sm" onClick={() => setPairing(true)}>
              {list.paired.length === 0
                ? S.browserSettings.connectFirst
                : S.browserSettings.connectAnother}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-fg-muted">{S.browserSettings.disabledNote}</p>
        ))}
      <RevokeConfirm record={revoking} onClose={() => setRevoking(null)} onRevoked={loadList} />
      <PairingDialog
        open={pairing}
        onClose={() => {
          setPairing(false);
          loadList();
        }}
      />
    </SettingsSection>
  );
}
