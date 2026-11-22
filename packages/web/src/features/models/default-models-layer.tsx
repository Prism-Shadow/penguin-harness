/**
 * The Default model settings dialog and the first-run guide before it, mounted once beside every
 * page (`WebAppModule.layers`).
 *
 * - The dialog opens on a request (lib/default-models-request.ts): the Models page's header, the
 *   composer's reminder, a connect flow that left the Project with keys and no default.
 * - On its own, when the current Project has no default chat model and its owner has not closed
 *   the guide in this browser (lib/model-onboarding.ts): the dialog straight away when some chat
 *   model already has a key (one the server's environment holds counts), else the guide to
 *   connecting a provider (TokenDance, Penguin Go) or adding a key.
 * - The guide's buttons lead to the Models page and step aside; the layer keeps watching the
 *   Project's models (a change in this window, or the window shown again — a connect flow runs
 *   in another tab), and opens the dialog as soon as a chat model has a key.
 * - What the onboarding opens on its own when a Project is opened shows over the chat pages only
 *   — where the app opens, and where a model is needed — never over a terminal or a settings
 *   page; it waits until the reader is on one. The dialog a request opens, and the one that
 *   follows a key landing while the reader is on the Models page, show where the reader is.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { MODEL_PROVIDERS, PENGUIN_GO_PROVIDER_ID } from "@prismshadow/penguin-server/model-catalog";
import { ModelSetupGuide } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { onDefaultModelsRequest, onModelsChanged } from "../../lib/default-models-request";
import {
  dismissOnboarding,
  onboardingDismissed,
  onboardingStep,
  usableChatModel,
} from "../../lib/model-onboarding";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { ProjectDefaultModelsDialog } from "./default-models";
import { connectPath } from "./connect-link";
import { TOKENDANCE_PROVIDER_ID } from "./tokendance-banner";

/** The providers the guide offers to connect: each hands the Project a key through its own flow. */
const GUIDE_PROVIDERS = [TOKENDANCE_PROVIDER_ID, PENGUIN_GO_PROVIDER_ID] as const;

/**
 * Where the layer is: nothing on screen; the guide; waiting for a key while the reader is on the
 * Models page; the dialog, opened by the onboarding or by a request.
 */
type Phase = "idle" | "guide" | "waiting" | "dialog";

export function DefaultModelsLayer() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /** The chat pages, the only ones the onboarding opens anything over on its own. */
  const onChat = pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/");
  const { user } = useAuth();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const owner = currentProject?.role === "owner";
  const [phase, setPhase] = useState<Phase>("idle");
  /** The dialog was opened by the onboarding: its sentence says why. */
  const [fromOnboarding, setFromOnboarding] = useState(false);
  /** What is open shows on any page, not only over the chat pages (see the header). */
  const [anywhere, setAnywhere] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // A Project switch starts over: the next Project asks its own question.
  useEffect(() => {
    setPhase("idle");
    setFromOnboarding(false);
    setAnywhere(false);
  }, [projectId]);

  /** Reads the Project's models and moves the onboarding on: the first question, or a key landing. */
  const check = useCallback(
    async (first: boolean) => {
      if (!projectId || !owner) return;
      let models;
      try {
        models = await api.getModels(projectId, null);
      } catch {
        return;
      }
      const now = phaseRef.current;
      if (first && now === "idle") {
        const step = onboardingStep({
          defaultModel: models.defaultModel,
          models: models.models,
          owner,
          dismissed: onboardingDismissed(projectId),
        });
        if (step === "none") return;
        setFromOnboarding(true);
        setAnywhere(false);
        setPhase(step);
      } else if (
        (now === "guide" || now === "waiting") &&
        models.defaultModel === undefined &&
        usableChatModel(models.models)
      ) {
        setFromOnboarding(true);
        setAnywhere(now === "waiting");
        setPhase("dialog");
      }
    },
    [projectId, owner],
  );

  useEffect(() => {
    if (!projectId) return;
    void check(true);
    const stop = onModelsChanged((changed) => {
      if (changed === projectId) void check(false);
    });
    const shown = () => {
      if (document.visibilityState === "visible") void check(false);
    };
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("focus", shown);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("focus", shown);
    };
  }, [projectId, check]);

  useEffect(
    () =>
      onDefaultModelsRequest(() => {
        setFromOnboarding(phaseRef.current === "waiting");
        setAnywhere(true);
        setPhase("dialog");
      }),
    [],
  );

  if (!projectId) return null;
  const close = () => {
    // The onboarding asked once: from now on the composer's reminder is the only prompt.
    if (fromOnboarding) dismissOnboarding(projectId);
    setFromOnboarding(false);
    setAnywhere(false);
    setPhase("idle");
  };
  const toModels = (path: string) => {
    setPhase("waiting");
    void navigate(path);
  };
  const label = (id: string) => MODEL_PROVIDERS.find((p) => p.id === id)?.label ?? id;
  return (
    <>
      <ModelSetupGuide
        open={phase === "guide" && (onChat || anywhere)}
        title={S.defaultModels.guideTitle}
        body={S.defaultModels.guideBody}
        providers={GUIDE_PROVIDERS.map((id) => ({
          id,
          label: label(id),
          description:
            id === TOKENDANCE_PROVIDER_ID ? S.defaultModels.tokendance : S.defaultModels.penguinGo,
          connectLabel: S.defaultModels.connect,
          onConnect: () => toModels(connectPath(id)),
        }))}
        keyText={S.defaultModels.keyText}
        keyAction={{ label: S.defaultModels.keyAction, onClick: () => toModels("/models") }}
        laterLabel={S.defaultModels.later}
        onClose={close}
        closeLabel={S.common.close}
      />
      <ProjectDefaultModelsDialog
        // A fresh read each time it opens, and nothing held across Projects.
        key={projectId}
        projectId={projectId}
        userId={user?.userId ?? null}
        owner={owner}
        open={phase === "dialog" && (onChat || anywhere)}
        {...(fromOnboarding ? { intro: S.defaultModels.introOnboarding } : {})}
        onClose={close}
        onOpenModels={() => {
          close();
          void navigate("/models");
        }}
      />
    </>
  );
}
