/**
 * The Project's Default model settings dialog, wired to the server: the UI package draws the dialog
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
 *
 * The rows come from one builder, `useDefaultModelRows`: the dialog shows all three groups, and
 * Project settings › Multimodal models shows the multimodal and tool groups, so the two lists
 * cannot differ in order, names, candidates or empty states.
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
import {
  clearDraftModelRef,
  dispatchChatDefaultsChanged,
} from "@prismshadow/penguin-library-session/web";
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

/** One binding a model can serve: its key, its name, and whether the model is bound to it. */
export interface UsageTarget {
  key: string;
  title: string;
  current: boolean;
}

/**
 * The bindings a model can serve, in the dialog's order — the multimodal rows first, then every
 * tool binding (web search, page reading, any plugin's) — each marked when the model is bound to
 * it: what a tool model's "Use model" binds, what its confirmation names, and what its In use tag
 * lists. Image understanding is not among them: the vision model has its own Proxy vision tag.
 */
export function usageTargets(
  model: ModelRefDto,
  bindings: readonly ToolBinding[] | null | undefined,
  locale: "zh" | "en",
): UsageTarget[] {
  const all = bindings ?? [];
  const ordered = [
    ...MULTIMODAL_ROWS.flatMap((key) => all.filter((b) => b.key === key && isMultimodalBinding(b))),
    ...all.filter((b) => !isMultimodalBinding(b)),
  ];
  return ordered
    .filter((b) => b.candidates.some((c) => sameModelRef(c, model)))
    .map((b) => ({ key: b.key, title: b.title[locale], current: sameModelRef(b.model, model) }));
}

const refKey = (model: ModelRefDto) => JSON.stringify([model.provider, model.modelId]);

/** The rows of the Project's default models, by group. */
export interface DefaultModelGroups {
  chat: DefaultModelSection;
  multimodal: DefaultModelSection;
  /** Web search, page reading and other plugins' bindings: shown quieter. */
  tools: DefaultModelSection;
}

/**
 * The Project's default models as rows, read from the server while `active`: the chat default,
 * the multimodal defaults and the tool defaults, each a section of `DefaultModelSections`. Null
 * sections until the table is read; the tool rows join once the bindings are.
 */
export function useDefaultModelRows({
  projectId,
  userId,
  owner,
  active,
  onOpenModels,
}: {
  projectId: string;
  /** Whose new-chat draft pin a chat default releases; null leaves drafts alone. */
  userId: string | null;
  owner: boolean;
  active: boolean;
  /** Where a row nothing can serve sends the reader: the Models page. */
  onOpenModels: () => void;
}) {
  const { locale } = useLocale();
  const tools = useToolBindings(active ? projectId : null, null);
  const [table, setTable] = useState<ModelsResponse | null>(null);
  const [tableError, setTableError] = useState("");
  const [writing, setWriting] = useState(false);
  const load = useCallback(() => {
    setTableError("");
    api.getModels(projectId, null).then(setTable, (e: unknown) => setTableError(apiErrorText(e)));
  }, [projectId]);
  useEffect(() => {
    if (active) load();
  }, [active, load]);

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
              onOpenModels={onOpenModels}
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
  const sections: DefaultModelGroups | null = table
    ? {
        chat: {
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
        multimodal: { key: "multimodal", title: S.defaultModels.multimodal, rows: multimodal },
        tools: {
          key: "tools",
          title: S.defaultModels.tools,
          quiet: true,
          rows: bindings.filter((b) => !isMultimodalBinding(b)).map(bindingRow),
        },
      }
    : null;
  return {
    table,
    /** The bindings the enabled plugins declare; null until read. */
    bindings: tools.bindings,
    tableError,
    toolsError: tools.error,
    /** A write is in flight. */
    saving: writing || tools.busy,
    reload: () => {
      tools.reload();
      load();
    },
    sections,
  };
}

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
  /** A sentence kept over the rows: why the dialog opened by itself (the onboarding). */
  intro?: string;
  onClose: () => void;
  /** Where a row nothing can serve sends the reader: the Models page. */
  onOpenModels: () => void;
}) {
  const { sections, tableError } = useDefaultModelRows({
    projectId,
    userId,
    owner,
    active: open,
    onOpenModels,
  });
  useEffect(() => {
    if (tableError) toastError(tableError);
  }, [tableError]);
  return (
    <DefaultModelsDialog
      open={open}
      title={S.defaultModels.title}
      info={owner ? S.defaultModels.intro : S.defaultModels.introMember}
      {...(intro !== undefined ? { intro } : {})}
      sections={sections ? [sections.chat, sections.multimodal, sections.tools] : []}
      doneLabel={S.defaultModels.done}
      onClose={onClose}
      closeLabel={S.common.close}
    />
  );
}
