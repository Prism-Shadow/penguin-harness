/**
 * An Agent's own picture, changed in its Overview tab the way a person changes theirs: a field
 * above the name holding the avatar's preview and the profile row's two controls (the shared
 * AvatarPicker), in its order — Change avatar opens the crop dialog and the crop is saved on
 * confirm; Restore default asks first, since it deletes the picture. A machine's Agent is written
 * through that machine.
 *
 * The field sits in the tab's form but outside its draft. A picture is direct manipulation, with
 * nothing to review before committing, so it is written the moment the crop is confirmed, while
 * the name and description beside it wait for the tab's Save. A write here therefore leaves the
 * form's typed text, its Save and Reset, and the leave guard exactly as they were.
 *
 * Every surface shows what is stored: a write that lands has the Agent list the picture is looked
 * up in (lib/agent-avatar.ts) read again — this server's, or the machine's — so the preview, the
 * page's header, the Agents list and every row that draws the Agent change together. A write
 * that fails says why in a toast and leaves the picture as it was.
 */
import { useState } from "react";

import {
  AgentAvatar,
  FieldLegend,
  USER_AVATAR_SIZE,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { AvatarPicker } from "../../components/ui/avatar-picker";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";

/**
 * The avatar's edge, in the field and in the page's header: the profile row's preview, for the
 * same reason — the avatar is the subject of what stands beside it, one step above it, not a hero.
 */
export const AGENT_AVATAR_PREVIEW_PX = USER_AVATAR_SIZE.preview;

export function AgentAvatarField({
  projectId,
  agentId,
  machineId,
  picture,
  onChanged,
}: {
  projectId: string;
  agentId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
  /** The Agent's own picture as a URL; undefined draws the default, and holds Restore default. */
  picture: string | undefined;
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
    // A fieldset names the group for assistive technology, so the preview and both controls are
    // read as the avatar's. The row wraps where a phone-width column cannot hold it, and a button
    // keeps its label whole rather than shrink (the picker's buttons carry `shrink-0`).
    <fieldset className="min-w-0">
      <FieldLegend>{S.profile.avatar}</FieldLegend>
      <div className="flex flex-wrap items-center gap-3">
        <AgentAvatar
          id={agentId}
          size={AGENT_AVATAR_PREVIEW_PX}
          src={picture}
          className="shrink-0"
        />
        <div className="flex flex-wrap items-center gap-2">
          <AvatarPicker
            hasPicture={picture !== undefined}
            busy={busy}
            run={run}
            save={save}
            onError={(message) => {
              if (message !== null) toastError(message);
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}
