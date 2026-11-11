/**
 * The question after connecting a group offered its model as the Project's default (TokenDance's
 * or Penguin Go's DeepSeek V4.1 Flash). The server reports the offer (`defaultOffer`) on the write
 * that stored the group's first key, when the Project's default sits outside that group or is
 * unset, and changes nothing else; this asks. Yes writes the default through the narrow default
 * write and says it saved, as setting a default from a model's dialog does; No writes nothing.
 * A refused write is a toast and leaves the question open, so it can be retried or declined.
 *
 * Both models are named from the table the page holds: the server only offers a row the table
 * held before the key landed, and the current default names a row of that table too.
 */
import { useState } from "react";
import type { DefaultModelOffer, ModelRefDto } from "@prismshadow/penguin-server/api";
import { providerInfo } from "@prismshadow/penguin-server/model-catalog";
import { ConfirmModal, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";

/** A row as far as naming it goes. */
interface NamedRow {
  provider: string;
  modelId: string;
  displayName?: string | undefined;
}

const groupLabel = (provider: string): string => providerInfo(provider)?.label ?? provider;

function displayName(ref: ModelRefDto, rows: readonly NamedRow[]): string {
  const row = rows.find((r) => r.provider === ref.provider && r.modelId === ref.modelId);
  return row?.displayName?.trim() || ref.modelId;
}

export function ConnectDefaultOfferConfirm({
  projectId,
  offer,
  rows,
  onClose,
  onAccepted,
}: {
  projectId: string;
  offer: DefaultModelOffer;
  rows: readonly NamedRow[];
  onClose: () => void;
  /** The default now stored: the page's pointer, and whatever follows it (a draft chat's model pick). */
  onAccepted: (ref: ModelRefDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const group = groupLabel(offer.model.provider);
  const model = displayName(offer.model, rows);
  const { current } = offer;
  const accept = async () => {
    setBusy(true);
    try {
      const res = await api.putDefaultModel(projectId, offer.model);
      onAccepted(res.defaultModel);
      toastSuccess(S.common.saved);
      onClose();
    } catch (e) {
      toastApiError(e);
      setBusy(false);
    }
  };
  return (
    <ConfirmModal
      open
      title={
        current !== undefined ? S.models.connectDefaultSwitchTitle : S.models.confirmDefaultTitle
      }
      tone="primary"
      confirmLabel={
        current !== undefined ? S.models.connectDefaultSwitch : S.models.connectDefaultSet
      }
      cancelLabel={
        current !== undefined ? S.models.connectDefaultKeep : S.models.connectDefaultNotNow
      }
      busy={busy}
      onClose={onClose}
      onConfirm={() => void accept()}
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {current !== undefined
          ? S.models.connectDefaultOffer(
              group,
              S.models.modelInGroup(displayName(current, rows), groupLabel(current.provider)),
              model,
            )
          : S.models.connectDefaultOfferUnset(group, model)}
      </p>
    </ConfirmModal>
  );
}
