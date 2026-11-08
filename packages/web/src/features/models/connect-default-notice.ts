/**
 * The notice after connecting a group moved the Project's default model (TokenDance's or Penguin
 * Go's DeepSeek V4.1 Flash). The server moves it in the same write that stores the group's first
 * key and answers with `defaultSwitch`; this says so and offers Undo, which puts the previous
 * default back. A Project that had no default gets no Undo: the default can be pointed at another
 * model, never cleared.
 *
 * Both models are named from the table the page holds. The server only moves the default to a
 * row the table held before the key landed, and the previous default named a row of that table
 * too, so neither is missing from it.
 */
import type { DefaultModelSwitch, ModelRefDto } from "@prismshadow/penguin-server/api";
import { providerInfo } from "@prismshadow/penguin-server/model-catalog";
import { toastInfo, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";

/** What the notice acts on: the Project, and the page that holds its default. */
export interface DefaultSwitchHost {
  projectId: string;
  /**
   * Takes in the default now in force, the switched one and then the one Undo put back: the
   * page's pointer, and whatever follows the default (a draft chat's model pick).
   */
  defaultChanged: (ref: ModelRefDto) => void;
}

/** A row as far as naming it goes. */
interface NamedRow {
  provider: string;
  modelId: string;
  displayName?: string | undefined;
}

/** A model with its group, since several groups sell the same model under the same name. */
function modelName(ref: ModelRefDto, rows: readonly NamedRow[]): string {
  const row = rows.find((r) => r.provider === ref.provider && r.modelId === ref.modelId);
  const group = providerInfo(ref.provider)?.label ?? ref.provider;
  return S.models.modelInGroup(row?.displayName?.trim() || ref.modelId, group);
}

/** Says the default moved, with Undo where there is a previous default to put back. */
export function announceDefaultSwitch(
  host: DefaultSwitchHost,
  change: DefaultModelSwitch,
  rows: readonly NamedRow[],
): void {
  host.defaultChanged(change.defaultModel);
  const text = S.models.connectDefaultSwitched(modelName(change.defaultModel, rows));
  const previous = change.previousDefault;
  if (previous === undefined) {
    toastInfo(text);
    return;
  }
  const previousName = modelName(previous, rows);
  toastInfo(text, {
    action: {
      label: S.common.undo,
      onPress: () => void restoreDefault(host, previous, previousName),
    },
  });
}

/** Undo: the previous default back, through the narrow default write; a refusal is a toast. */
async function restoreDefault(
  host: DefaultSwitchHost,
  previous: ModelRefDto,
  name: string,
): Promise<void> {
  try {
    const res = await api.putDefaultModel(host.projectId, previous);
    host.defaultChanged(res.defaultModel);
    toastSuccess(S.models.connectDefaultRestored(name));
  } catch (e) {
    toastApiError(e);
  }
}
