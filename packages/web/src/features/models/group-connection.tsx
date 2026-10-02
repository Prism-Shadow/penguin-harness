/**
 * A group's connection in its header (groups whose key comes from an authorization flow:
 * TokenDance, Penguin Go, ModelScope), as one control:
 *
 * - not connected: the status "Not connected" and, for the owner, the Connect button;
 * - connected, for the owner: one flat trigger — the success dot, "Connected" and a chevron —
 *   opening a menu with Sync models (Penguin Go only: it reads the platform's catalog with the
 *   group key), Reconnect (the group's flow again, for a fresh key or another account) and
 *   Disconnect, in the danger tone;
 * - connected, for a member: the same status as plain text, with no menu.
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
  Button,
  ChevronDown,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot } from "../../lib/tone";
import { HEADER_BUTTON, HEADER_LABEL, HEADER_TEXT, connectedMenuItems } from "./group-header";
import type { ConnectedMenuItem } from "./group-header";

/** What a menu row runs; the page supplies each. */
export interface ConnectionActions {
  /** Starts the group's connect flow (Connect, and Reconnect from the menu). */
  onConnect: () => void;
  /** Penguin Go's platform sync. */
  onSyncModels: () => void;
  /** Opens the Disconnect confirmation. */
  onDisconnect: () => void;
}

/**
 * The status dot and words, shared by every state of the control. The words give way on a narrow
 * header (they stay for assistive technology); the dot and the tooltip on its container stay.
 */
function Status({ connected }: { connected: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? toneDot.success : toneDot.muted}`}
      />
      <span className="sr-only @2xl:not-sr-only">
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
  const statusClass = `${HEADER_TEXT} gap-1 whitespace-nowrap text-gray-500 dark:text-gray-400`;

  if (!connected) {
    return (
      <span className="flex shrink-0 items-center gap-2">
        <span className={statusClass} data-tooltip={S.models.notConnectedStatus}>
          <Status connected={false} />
        </span>
        {isOwner && (
          <Button
            size="icon"
            variant="ghost"
            className={HEADER_BUTTON}
            disabled={busy}
            aria-label={`${S.models.oauthKey} ${provider.label}`}
            title={S.models.oauthKey}
            onClick={actions.onConnect}
          >
            <GlyphIcon d={ICONS.chainLink} size={ICON_SIZE.groupHeaderAction} />
            <span className={HEADER_LABEL}>{S.models.oauthKey}</span>
          </Button>
        )}
      </span>
    );
  }

  // A member reads the state; only the owner can act on it.
  if (!isOwner) {
    return (
      <span className={statusClass} data-tooltip={S.models.connectedStatus}>
        <Status connected />
      </span>
    );
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
          className={`${statusClass} rounded-control transition-colors duration-150 hover:text-gray-800 disabled:opacity-50 dark:hover:text-gray-200`}
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
