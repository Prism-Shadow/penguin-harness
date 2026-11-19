import { useEffect, useRef, useState, type RefObject } from "react";
import type { ModelRefDto, ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { sameModelRef } from "../../lib/model-grouping";
import { S } from "../../lib/strings";
import { ModelPickerModal, modelLabel } from "../model-picker";

type Choice = ModelRefDto & { label: string };
type Request = {
  current: ModelRefDto | null;
  resolve: (choice: Choice | null) => void;
  reject: (error: Error) => void;
};

/** Serves chooseChatModel() on this frame alone. Only the chosen public model identity leaves the dialog. */
export function WorkbenchModelPicker({
  frame,
  projectId,
  machineId,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  projectId: string;
  machineId: string | null;
}) {
  const latest = useRef<Request | null>(null);
  const [picker, setPicker] = useState<{ catalog: ModelsResponse; request: Request } | null>(null);
  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    let target: Window | null = null;
    const cancel = () => {
      latest.current?.resolve(null);
      latest.current = null;
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
    const handle = (event: Event) => {
      const request = (event as CustomEvent<Request>).detail;
      if (!request || typeof request.resolve !== "function" || typeof request.reject !== "function")
        return;
      event.preventDefault();
      if (event.type === "penguin:get-chat-model") {
        void catalog(false).then((models) => {
          const ref = request.current ?? models.defaultModel;
          const row = models.models.find((model) => sameModelRef(model, ref));
          request.resolve(
            row ? { provider: row.provider, modelId: row.modelId, label: modelLabel(row) } : null,
          );
        }, request.reject);
        return;
      }
      cancel();
      latest.current = request;
      void catalog(true).then(
        (catalog) => {
          if (latest.current === request) setPicker({ catalog, request });
        },
        (error: Error) => {
          if (latest.current === request) {
            latest.current = null;
            request.reject(error);
          }
        },
      );
    };
    const listen = () => {
      cancel();
      target?.removeEventListener("penguin:choose-chat-model", handle);
      target?.removeEventListener("penguin:get-chat-model", handle);
      target = iframe.contentDocument?.defaultView ?? null;
      target?.addEventListener("penguin:choose-chat-model", handle);
      target?.addEventListener("penguin:get-chat-model", handle);
    };
    listen();
    iframe.addEventListener("load", listen);
    return () => {
      iframe.removeEventListener("load", listen);
      target?.removeEventListener("penguin:choose-chat-model", handle);
      target?.removeEventListener("penguin:get-chat-model", handle);
      cancel();
    };
  }, [frame, projectId, machineId]);
  if (!picker) return null;
  const { catalog, request } = picker;
  const finish = (choice: Choice | null) => {
    latest.current = null;
    setPicker(null);
    request.resolve(choice);
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
      onPick={(model) =>
        finish({ provider: model.provider, modelId: model.modelId, label: modelLabel(model) })
      }
    />
  );
}
