import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router";
import { useWindowShown } from "@prismshadow/penguin-ui";
import type { ModelRefDto, ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import {
  CHAT_MODEL_MESSAGE,
  CHAT_MODEL_REPLY,
  OPEN_MODEL_SETTINGS_MESSAGE,
} from "../../lib/workbench-tabs";
import { sameModelRef } from "../../lib/model-grouping";
import { rememberProject } from "../../state/project";
import { S } from "../../lib/strings";
import {
  effectiveThinkingLevel,
  ModelPickerModal,
  modelLabel,
  SELECTABLE_THINKING_LEVELS,
} from "@prismshadow/penguin-web/internal";

type Choice = ModelRefDto & { label: string };
type Request = { id: string; op: "choose" | "get"; current: ModelRefDto | null };
type ThinkingOptions = {
  defaultLevel: string;
  title: string;
  names: Readonly<Record<string, string>>;
  options: Array<{ value: string; label: string }>;
};
type Answer =
  | { thinking: ThinkingOptions }
  | { opened: true }
  | { accepted: true }
  | { model: Choice | null }
  | { error: string };

const choiceOf = (row: ModelRefDto & Parameters<typeof modelLabel>[0]): Choice => ({
  provider: row.provider,
  modelId: row.modelId,
  label: modelLabel(row),
});

/** The `{ provider, modelId }` a page named, or null for anything else. */
function modelRefOf(value: unknown): ModelRefDto | null {
  const ref = value as { provider?: unknown; modelId?: unknown } | null;
  return typeof ref?.provider === "string" && typeof ref.modelId === "string"
    ? { provider: ref.provider, modelId: ref.modelId }
    : null;
}

/**
 * Answers the page SDK's `chooseChatModel()` and `getChatModel()` for this frame alone: a
 * `penguin:chat-model` request the page posts to its parent, taken only from this frame's window
 * (as `penguin:fill-app` is), acknowledged at once and answered on its id. Only the chosen model's
 * public identity leaves the dialog.
 */
export function WorkbenchModelPicker({
  frame,
  agentId,
  projectId,
  machineId,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  agentId: string;
  projectId: string;
  machineId: string | null;
}) {
  const navigate = useNavigate();
  const shown = useWindowShown();
  const open = useRef<Request | null>(null);
  const [picker, setPicker] = useState<{ catalog: ModelsResponse; request: Request } | null>(null);
  const answer = useCallback(
    (id: string, reply: Answer) =>
      // The frame is this app's own origin; the answer names a model, nothing more.
      frame.current?.contentWindow?.postMessage({ type: CHAT_MODEL_REPLY, id, ...reply }, "*"),
    [frame],
  );
  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    /** An open picker answers as dismissed when its page reloads, or a newer request replaces it. */
    const dismiss = () => {
      if (open.current) answer(open.current.id, { model: null });
      open.current = null;
      setPicker(null);
    };
    let catalogRead: Promise<ModelsResponse> | undefined;
    const catalog = (refresh: boolean) => {
      if (!catalogRead || refresh) {
        const read = api.getModels(projectId, machineId);
        catalogRead = read;
        void read.catch(() => {
          if (catalogRead === read) catalogRead = undefined;
        });
      }
      return catalogRead;
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== iframe.contentWindow) return;
      const data = event.data as { type?: unknown; id?: unknown; op?: unknown; current?: unknown };
      if (typeof data?.id !== "string") return;
      if (data.type === OPEN_MODEL_SETTINGS_MESSAGE) {
        if (event.origin !== window.location.origin) return;
        if (!shown || machineId !== null) {
          answer(data.id, {
            error:
              machineId !== null
                ? S.workbenches.configureOnMachine
                : S.workbenches.openBeforeConfiguring,
          });
          return;
        }
        rememberProject(projectId);
        answer(data.id, { opened: true });
        void navigate("/models");
        return;
      }
      if (data.type !== CHAT_MODEL_MESSAGE) return;
      if (data.op === "thinking") {
        const id = data.id;
        answer(id, { accepted: true });
        void Promise.all([
          api.getAgentConfig(projectId, agentId, machineId),
          api.getChatDefaults(projectId, machineId),
        ]).then(
          ([agent, defaults]) => {
            const names = S.chat.thinkingLevelNames;
            answer(id, {
              thinking: {
                defaultLevel: effectiveThinkingLevel(
                  agent.config.model?.thinkingLevel ?? "",
                  defaults.thinkingLevel,
                ),
                title: S.chat.thinkingLevel,
                names,
                options: SELECTABLE_THINKING_LEVELS.map((value) => ({
                  value,
                  label: S.chat.thinkingLevelMenuName(names[value] ?? value, value),
                })),
              },
            });
          },
          (error: Error) => answer(id, { error: error.message }),
        );
        return;
      }
      const request: Request = {
        id: data.id,
        op: data.op === "choose" ? "choose" : "get",
        current: modelRefOf(data.current),
      };
      answer(request.id, { accepted: true });
      const failed = (error: Error) => answer(request.id, { error: error.message });
      if (request.op === "get") {
        void catalog(false).then((models) => {
          const ref = request.current ?? models.defaultModel;
          const row = ref ? models.models.find((model) => sameModelRef(model, ref)) : undefined;
          answer(request.id, { model: row ? choiceOf(row) : null });
        }, failed);
        return;
      }
      dismiss();
      open.current = request;
      void catalog(true).then(
        (models) => {
          if (open.current === request) setPicker({ catalog: models, request });
        },
        (error: Error) => {
          if (open.current !== request) return;
          open.current = null;
          failed(error);
        },
      );
    };
    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", dismiss);
    return () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", dismiss);
      dismiss();
    };
  }, [frame, agentId, projectId, machineId, answer, navigate, shown]);
  if (!picker) return null;
  const { catalog, request } = picker;
  const finish = (choice: Choice | null) => {
    open.current = null;
    setPicker(null);
    answer(request.id, { model: choice });
  };
  return (
    <ModelPickerModal
      open
      title={S.chat.chooseModel}
      projectId={projectId}
      value={request.current ?? catalog.defaultModel ?? null}
      models={catalog.models}
      {...(catalog.defaultModel ? { defaultModel: catalog.defaultModel } : {})}
      onClose={() => finish(null)}
      onPick={(model) => finish(choiceOf(model))}
    />
  );
}
