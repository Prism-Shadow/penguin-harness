/**
 * The Project's 「默认模型」 dialog, wired to the server: the UI package draws the dialog
 * (DefaultModelsDialog), this module fills its rows.
 *
 * - **Chat**: the default chat model (`PUT /models/default`), a picker over the chat models.
 * - **Multimodal**: text generation, image generation, image understanding, video generation,
 *   speech recognition and speech synthesis. Image understanding is the Project's vision model
 *   (written with the whole table, its only write path); the rest are the multimodal tools
 *   plugin's bindings (`PATCH /models/tool-bindings`).
 * - **Tools**, quieter: every other binding the enabled plugins declare — the plugin's web search
 *   and page reading, and any binding another plugin adds — so a new binding gets a row here
 *   unchanged.
 *
 * Each picker lists only the models that can serve its row, and commits its pick at once; a row
 * nothing can serve says so and points at the Models page, where a provider is connected. A
 * member sees the same rows, read-only.
 */
import { useCallback, useEffect, useState } from "react";
import type { ModelInfo, ModelRefDto, ModelsResponse } from "@prismshadow/penguin-server/api";
import { DefaultModelsDialog, toastError } from "@prismshadow/penguin-ui";
import type { DefaultModelRow, DefaultModelSection } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { MULTIMODAL_TOOLS_PACKAGE, type ToolBinding } from "../../api/tool-types";
import { apiErrorText } from "../../lib/api-error";
import { notifyModelsChanged } from "../../lib/default-models-request";
import { sameModelRef } from "../../lib/model-grouping";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useToolBindings } from "../../state/use-tool-bindings";
import { clearDraftModelRef, dispatchChatDefaultsChanged } from "../chat";
import { ModelCatalogSelect, modelLabel } from "../model-picker";
import { putVisionModel } from "./vision-model";

/** Image understanding's row: the vision model. No binding key has a colon, so none collides. */
export const VISION_ROW = ":vision";

/** Text generation's row: with nothing bound it follows the default chat model. */
const TEXT_ROW = "t2t";

/**
 * The multimodal rows, in the dialog's order: the multimodal tools plugin's bindings and the
 * vision model. Its web search and page reading are tools, not multimodal, and go to the quieter
 * group with every other plugin's bindings.
 */
export const MULTIMODAL_ROWS = ["t2t", "t2i", VISION_ROW, "t2v", "s2t", "t2s"] as const;

/** Whether a binding is one of the multimodal rows (else it is a tool row). */
export function isMultimodalBinding(binding: ToolBinding): boolean {
  return (
    binding.package === MULTIMODAL_TOOLS_PACKAGE &&
    (MULTIMODAL_ROWS as readonly string[]).includes(binding.key)
  );
}

/** Whether a model can read images for another: the vision model's candidates. */
export function servesVision(model: Pick<ModelInfo, "vision" | "chatEligible">): boolean {
  return model.vision !== false && model.chatEligible !== false;
}

/** One multimodal default a model can take: its row, its name, and whether it already holds it. */
export interface MultimodalTarget {
  key: string;
  title: string;
  current: boolean;
}

/**
 * The multimodal defaults a model can serve, in the dialog's order: image understanding when it
 * can read images for another model, and each multimodal binding that accepts it. What
 * 「设为默认多模态模型」 sets, and what its confirmation names.
 */
export function multimodalTargets(
  model: ModelRefDto & Pick<ModelInfo, "vision" | "chatEligible">,
  bindings: readonly ToolBinding[] | null | undefined,
  visionModel: ModelRefDto | undefined,
  locale: "zh" | "en",
): MultimodalTarget[] {
  const out: MultimodalTarget[] = [];
  for (const key of MULTIMODAL_ROWS) {
    if (key === VISION_ROW) {
      if (servesVision(model)) {
        out.push({
          key,
          title: S.voice.imageUnderstanding,
          current: sameModelRef(visionModel, model),
        });
      }
      continue;
    }
    const binding = bindings?.find((b) => b.key === key && isMultimodalBinding(b));
    if (binding?.candidates.some((c) => sameModelRef(c, model))) {
      out.push({
        key,
        title: binding.title[locale],
        current: sameModelRef(binding.model, model),
      });
    }
  }
  return out;
}

const refKey = (model: ModelRefDto) => JSON.stringify([model.provider, model.modelId]);

export function ProjectDefaultModelsDialog({
  projectId,
  userId,
  owner,
  open,
  intro,
  onClose,
  onOpenModels,
}: {
  projectId: string;
  userId: string | null;
  owner: boolean;
  open: boolean;
  /** Replaces the dialog's own sentence (the onboarding says why it opened). */
  intro?: string;
  onClose: () => void;
  /** Where a row nothing can serve sends the reader: the Models page. */
  onOpenModels: () => void;
}) {
  const { locale } = useLocale();
  const tools = useToolBindings(open ? projectId : null, null);
  const [table, setTable] = useState<ModelsResponse | null>(null);
  const [writing, setWriting] = useState(false);
  const load = useCallback(() => {
    api.getModels(projectId, null).then(setTable, (e: unknown) => toastError(apiErrorText(e)));
  }, [projectId]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const busy = writing || tools.busy || !owner;
  const adopt = (next: ModelsResponse) => {
    setTable(next);
    notifyModelsChanged(projectId);
  };
  const chooseChat = async (model: ModelRefDto) => {
    if (!table || sameModelRef(model, table.defaultModel)) return;
    setWriting(true);
    try {
      const res = await api.putDefaultModel(projectId, model);
      if (userId) clearDraftModelRef(userId, projectId);
      dispatchChatDefaultsChanged({
        projectId,
        ...(res.defaultModel ? { defaultModel: res.defaultModel } : {}),
      });
      adopt({ ...table, defaultModel: res.defaultModel });
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setWriting(false);
    }
  };
  const chooseVision = async (model: ModelRefDto) => {
    if (!table || sameModelRef(model, table.visionModel)) return;
    setWriting(true);
    try {
      adopt(await putVisionModel(projectId, model));
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setWriting(false);
    }
  };

  const models = table?.models ?? [];
  const byKey = new Map(models.map((m) => [refKey(m), m]));
  const empty: DefaultModelRow["empty"] = {
    text: S.defaultModels.empty,
    action: { label: S.defaultModels.emptyAction, onClick: onOpenModels },
  };
  const pickerRow = (
    key: string,
    title: string,
    choices: ModelInfo[],
    value: ModelRefDto | undefined,
    onPick: (model: ModelRefDto) => void,
    options: {
      hint?: string;
      purpose?: "chat" | "tool";
      onClear?: () => void;
      /** What the picker reads while nothing is chosen (the default: 「未指定」). */
      emptyLabel?: string;
      clearLabel?: string;
      /** Something serves the row while nothing is chosen: the picker shows even with no candidate. */
      covered?: boolean;
    } = {},
  ): DefaultModelRow => ({
    key,
    title,
    ...(options.hint !== undefined ? { hint: options.hint } : {}),
    ...(choices.length === 0 && value === undefined && options.covered !== true
      ? { empty }
      : {
          control: (
            <ModelCatalogSelect
              variant="form"
              purpose={options.purpose ?? "tool"}
              title={title}
              models={choices}
              value={value ?? null}
              emptyLabel={options.emptyLabel ?? S.voice.unbound}
              disabled={busy}
              onChange={onPick}
              {...(options.onClear && owner ? { onClear: options.onClear } : {})}
              {...(options.clearLabel !== undefined ? { clearLabel: options.clearLabel } : {})}
            />
          ),
        }),
  });

  // Text generation with nothing bound runs on the default chat model (the plugin's fallback),
  // which its row names; clearing a bound model goes back to following it.
  const defaultChat = table?.defaultModel
    ? models.find((m) => sameModelRef(m, table.defaultModel))
    : undefined;
  const bindingRow = (binding: ToolBinding): DefaultModelRow => {
    const follows = binding.key === TEXT_ROW && isMultimodalBinding(binding);
    return pickerRow(
      binding.key,
      binding.title[locale],
      binding.candidates.flatMap((ref) => byKey.get(refKey(ref)) ?? []),
      binding.model,
      (model) => {
        if (!sameModelRef(model, binding.model)) void tools.bind(binding.key, model);
      },
      {
        ...(binding.model ? { onClear: () => void tools.bind(binding.key, null) } : {}),
        ...(follows && defaultChat
          ? {
              emptyLabel: S.defaultModels.followsDefault(modelLabel(defaultChat)),
              clearLabel: S.defaultModels.followDefault,
              covered: true,
            }
          : {}),
      },
    );
  };

  const bindings = tools.bindings ?? [];
  const multimodal: DefaultModelRow[] = MULTIMODAL_ROWS.flatMap((key): DefaultModelRow[] => {
    if (key === VISION_ROW) {
      return [
        pickerRow(
          VISION_ROW,
          S.voice.imageUnderstanding,
          models.filter(servesVision),
          table?.visionModel,
          (model) => void chooseVision(model),
          { purpose: "chat" },
        ),
      ];
    }
    const binding = bindings.find((b) => b.key === key && isMultimodalBinding(b));
    return binding ? [bindingRow(binding)] : [];
  });
  const sections: DefaultModelSection[] = table
    ? [
        {
          key: "chat",
          title: S.defaultModels.chat,
          rows: [
            pickerRow(
              "chat",
              S.defaultModels.chatModel,
              models.filter((m) => m.chatEligible !== false),
              table.defaultModel,
              (model) => void chooseChat(model),
              { hint: S.defaultModels.chatHint, purpose: "chat" },
            ),
          ],
        },
        { key: "multimodal", title: S.defaultModels.multimodal, rows: multimodal },
        {
          key: "tools",
          title: S.defaultModels.tools,
          quiet: true,
          rows: bindings.filter((b) => !isMultimodalBinding(b)).map(bindingRow),
        },
      ]
    : [];
  return (
    <DefaultModelsDialog
      open={open}
      title={S.defaultModels.title}
      intro={intro ?? (owner ? S.defaultModels.intro : S.defaultModels.introMember)}
      sections={sections}
      doneLabel={S.defaultModels.done}
      onClose={onClose}
      closeLabel={S.common.close}
    />
  );
}
