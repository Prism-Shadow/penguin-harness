/**
 * A group's connection in its header (groups whose key comes from an authorization flow:
 * TokenDance, Penguin Go, ModelScope), as one control:
 *
 * - not connected, for the owner: one flat button — the muted dot and "Not connected" — that
 *   starts the group's connect flow, so the status is also the way to change it;
 * - connected, for the owner: one flat trigger — the success dot, "Connected" and a chevron —
 *   opening a menu with Sync models (Penguin Go only: it reads the platform's catalog with the
 *   group key), Reconnect (the group's flow again, for a fresh key or another account) and
 *   Disconnect, in the danger tone;
 * - for a member, either way: the status as plain text, with nothing to press.
 *
 * "Connected" is the group holding a key of its own, however it got there (group-header.ts).
 * Disconnect clears that key (`PUT …/models/providers/:id { clearApiKey: true }`) behind a danger
 * confirmation, and the table the server answers with is adopted, so the status turns back to
 * "Not connected" without a reload.
 */
import { useState } from "react";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import {
  ChevronDown,
  ConfirmModal,
  Dropdown,
  Menu,
  MenuItem,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot } from "../../lib/tone";
import { HEADER_TEXT, connectedMenuItems } from "./group-header";
import type { ConnectedMenuItem } from "./group-header";

/** What a menu row runs; the page supplies each. */
export interface ConnectionActions {
  /** Starts the group's connect flow (the Not connected button, and Reconnect from the menu). */
  onConnect: () => void;
  /** Penguin Go's platform sync. */
  onSyncModels: () => void;
  /** Opens the Disconnect confirmation. */
  onDisconnect: () => void;
}

/**
 * The status dot and words, shared by every state of the control. Where a chevron or plain text
 * carries the state, the words give way on a narrow header (they stay for assistive technology;
 * the dot and the tooltip on its container stay). The Not connected button keeps them at every
 * width (`keepWords`): a grey dot alone does not read as something to press.
 */
function Status({ connected, keepWords = false }: { connected: boolean; keepWords?: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? toneDot.success : toneDot.muted}`}
      />
      <span className={keepWords ? undefined : "sr-only @2xl:not-sr-only"}>
        {connected ? S.models.connectedStatus : S.models.notConnectedStatus}
      </span>
    </>
  );
}

/** The Connected menu's rows, in connectedMenuItems' order; Disconnect in the danger tone. */
export function ConnectionMenu({
  provider,
  onSelect,
}: {
  provider: ModelProviderInfo;
  onSelect: (item: ConnectedMenuItem) => void;
}) {
  const label: Record<ConnectedMenuItem, string> = {
    syncModels: S.models.syncModels,
    reconnect: S.models.reconnect,
    disconnect: S.models.disconnect,
  };
  return (
    <Menu density="sm">
      {connectedMenuItems(provider).map((item) => (
        <MenuItem
          key={item}
          label={label[item]}
          danger={item === "disconnect"}
          onSelect={() => onSelect(item)}
        />
      ))}
    </Menu>
  );
}

const STATUS_CLASS = `${HEADER_TEXT} gap-1 whitespace-nowrap text-gray-500 dark:text-gray-400`;
const PRESSABLE =
  "rounded-control transition-colors duration-150 hover:text-gray-800 disabled:opacity-50 dark:hover:text-gray-200";

/**
 * The owner's control while the group holds no key: the status itself, as a flat button that
 * starts the group's connect flow. Its name starts with the words it shows, then says what
 * pressing does; the tooltip says the latter.
 */
export function NotConnectedButton({
  provider,
  busy,
  onConnect,
}: {
  provider: ModelProviderInfo;
  busy: boolean;
  onConnect: () => void;
}) {
  const connect = `${S.models.oauthKey} ${provider.label}`;
  return (
    <button
      type="button"
      aria-label={`${S.models.notConnectedStatus} · ${connect}`}
      data-tooltip={connect}
      disabled={busy}
      onClick={onConnect}
      className={`${STATUS_CLASS} ${PRESSABLE}`}
    >
      <Status connected={false} keepWords />
    </button>
  );
}

export function GroupConnection({
  provider,
  connected,
  isOwner,
  busy,
  actions,
}: {
  provider: ModelProviderInfo;
  /** The group holds a key of its own (groupKeyStored). */
  connected: boolean;
  isOwner: boolean;
  /** The page is writing: the controls wait. */
  busy: boolean;
  actions: ConnectionActions;
}) {
  const [open, setOpen] = useState(false);

  // A member reads the state; only the owner can act on it.
  if (!isOwner) {
    const status = connected ? S.models.connectedStatus : S.models.notConnectedStatus;
    return (
      <span className={STATUS_CLASS} data-tooltip={status}>
        <Status connected={connected} />
      </span>
    );
  }

  if (!connected) {
    return <NotConnectedButton provider={provider} busy={busy} onConnect={actions.onConnect} />;
  }

  const run: Record<ConnectedMenuItem, () => void> = {
    syncModels: actions.onSyncModels,
    reconnect: actions.onConnect,
    disconnect: actions.onDisconnect,
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="flex shrink-0"
      menuClass="w-44 max-w-[calc(100vw-2rem)] origin-top-right"
      portal={{ direction: "down", align: "right" }}
      button={
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${S.models.connectedStatus} ${provider.label}`}
          data-tooltip={S.models.connectedStatus}
          disabled={busy}
          onClick={() => setOpen(!open)}
          className={`${STATUS_CLASS} ${PRESSABLE}`}
        >
          <Status connected />
          <ChevronDown size={10} />
        </button>
      }
    >
      <ConnectionMenu
        provider={provider}
        onSelect={(item) => {
          setOpen(false);
          run[item]();
        }}
      />
    </Dropdown>
  );
}

/** What Disconnect needs from the page: the Project, the table setter and the busy flag. */
export interface DisconnectHost {
  projectId: string;
  /** Takes in the table the server answered with, whole. */
  adopt: (res: ModelsResponse) => void;
  setBusy: (busy: boolean) => void;
}

/**
 * Clears the group key and adopts the table the server answers with, which carries the group
 * without its key — so the header reads "Not connected" from that answer, not from a guess.
 * Models with a key of their own keep it; the server clears nothing else. Reports in a toast.
 */
export async function disconnectGroup(
  host: DisconnectHost,
  provider: ModelProviderInfo,
): Promise<void> {
  host.setBusy(true);
  try {
    const res = await api.putProviderConnection(host.projectId, provider.id, {
      clearApiKey: true,
    });
    host.adopt(res);
    toastSuccess(S.models.disconnected(provider.label));
  } catch (e) {
    toastError(apiErrorText(e));
  } finally {
    host.setBusy(false);
  }
}

/**
 * The Disconnect confirmation, in the danger tone: it deletes the group key, which every model
 * without one of its own uses. Confirming runs the clear and closes once the request settles.
 */
export function DisconnectConfirm({
  host,
  provider,
  busy,
  onClose,
}: {
  host: DisconnectHost;
  provider: ModelProviderInfo;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <ConfirmModal
      open
      title={S.models.disconnect}
      tone="danger"
      confirmLabel={S.models.disconnect}
      cancelLabel={S.common.cancel}
      busy={busy}
      onClose={onClose}
      onConfirm={() => {
        void disconnectGroup(host, provider).finally(onClose);
      }}
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {S.models.disconnectConfirm(provider.label)}
      </p>
    </ConfirmModal>
  );
}
