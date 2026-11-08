/**
 * An Agent's own picture, changed at the head of its settings page the way a person changes
 * theirs: the profile row's two controls (the shared AvatarPicker), in its order — Change avatar
 * opens the crop dialog and the crop is saved on confirm; Restore default asks first, since it
 * deletes the picture. A machine's Agent is written through that machine.
 *
 * Every surface shows what is stored: a write that lands has the Agent list the picture is looked
 * up in (lib/agent-avatar.ts) read again — this server's, or the machine's — so the header, the
 * Agents list and every row that draws the Agent change together. A write that fails says why in
 * a toast and leaves the picture as it was.
 */
import { useState } from "react";

import { USER_AVATAR_SIZE, toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { AvatarPicker } from "../../components/ui/avatar-picker";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";

/**
 * The header avatar's edge: the profile row's preview, for the same reason — the avatar is the
 * subject of the controls beside it, one step above them, not a hero.
 */
export const AGENT_HEADER_AVATAR_PX = USER_AVATAR_SIZE.preview;

export function AgentAvatarControls({
  projectId,
  agentId,
  machineId,
  hasPicture,
  onChanged,
}: {
  projectId: string;
  agentId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
  /** The Agent has a picture of its own: Restore default is live only then. */
  hasPicture: boolean;
  /** A write landed: reads again the Agent list the picture is looked up in. */
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const save = async (avatar: string | null): Promise<void> => {
    try {
      await api.putAgentAvatar(projectId, agentId, avatar, machineId);
    } catch (e) {
      toastApiError(e);
      return;
    }
    toastSuccess(S.common.saved);
    await onChanged();
  };

  return (
    <AvatarPicker
      hasPicture={hasPicture}
      busy={busy}
      run={run}
      save={save}
      onError={(message) => {
        if (message !== null) toastError(message);
      }}
      confirmRestore
    />
  );
}
