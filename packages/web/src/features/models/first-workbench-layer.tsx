import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button, ConfirmModal } from "@prismshadow/penguin-ui";
import { usePageAgent, type PageAgent } from "../../lib/page-agent";
import {
  GUIDE_MODEL_SELECTED,
  GUIDE_START,
  useFirstWorkbench,
} from "../../lib/first-workbench-entry";
import {
  conversationForGuide,
  loadGuideProgress,
  persistGuideProgress,
  closeGuide,
  guideLocation,
  freshGuideKey,
  guideStorage,
  installGuideBoard,
  readGuide,
  verifyGuideBoard,
  supportsConversation,
  type Guide,
  type GuideProgress,
} from "../../lib/first-workbench-tour";
import { machineForSession } from "../../lib/session-machines";
import { appWindowPath, locatedAppKey } from "../../lib/app-center-path";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { installWithModules } from "../../lib/agent-plugin-install";
import { GuideCallout } from "./guide-callout";
import { getModels } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { usableChatModel } from "../../lib/model-onboarding";
import { onModelsChanged } from "../../lib/default-models-request";
import { useSessionsIfAny } from "../../state/sessions";
import { defaultChatModel, hasConfiguredKey } from "../../lib/model-grouping";
import { useLocale } from "../../state/locale";

export function FirstWorkbenchLayer() {
  const { user, sessionVia } = useAuth();
  const { currentProject } = useProject();
  const { state, pathname, search } = useLocation();
  const navigate = useNavigate();
  const [request, setRequest] = useState<{
    scope: PageAgent;
    user: string;
    automatic: boolean;
  } | null>(null);
  const project = currentProject?.projectId,
    viewer = user?.userId;
  useEffect(() => {
    setRequest(null);
    const open = (event: Event) => {
      const { scope, automatic } = (event as CustomEvent<{ scope: PageAgent; automatic: boolean }>)
        .detail;
      if (!viewer || scope.projectId !== project) return;
      setRequest((previous) =>
        automatic &&
        previous?.user === viewer &&
        previous.scope.projectId === project &&
        previous.scope.agentId === scope.agentId &&
        previous.scope.machineId === scope.machineId
          ? previous
          : { scope, user: viewer, automatic },
      );
    };
    window.addEventListener(GUIDE_START, open);
    return () => window.removeEventListener(GUIDE_START, open);
  }, [viewer, project]);
  const published = usePageAgent();
  const old =
    pathname === "/apps"
      ? new URLSearchParams(search)
          .get("app")
          ?.match(/^(([^:/]+):)?([^/:]+)\/first-workbench-guide$/)
      : null;
  const linkedAgent = old?.[3],
    linkedMachine = old?.[2] ?? null;
  const oldGuide = useFirstWorkbench(
    linkedAgent && project
      ? { projectId: project, agentId: linkedAgent, machineId: linkedMachine }
      : null,
  );
  useEffect(() => {
    if (oldGuide && project && linkedAgent)
      void navigate("/chat/new", {
        replace: true,
        state: {
          agentId: linkedAgent,
          ...(linkedMachine && { workspace: "", machineId: linkedMachine }),
          firstWorkbench: { projectId: project, agentId: linkedAgent, machineId: linkedMachine },
        },
      });
  }, [oldGuide, project, linkedAgent, linkedMachine, navigate]);
  const linked = (state as { firstWorkbench?: PageAgent } | null)?.firstWorkbench;
  useEffect(() => {
    if (!linked || !viewer || linked.projectId !== project) return;
    setRequest({ scope: linked, user: viewer, automatic: false });
    // A bookmark requests the guide once. Reloading the resulting chat honors dismissal.
    void navigate(pathname + search, {
      replace: true,
      state: { ...state, firstWorkbench: undefined },
    });
  }, [linked, viewer, project, navigate, pathname, search, state]);
  const scope =
    sessionVia !== "token" && request?.user === viewer && request?.scope.projectId === project
      ? (request?.scope ?? null)
      : null;
  const onChat = pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/");
  const otherChat =
    onChat &&
    published?.live &&
    (scope?.agentId !== published.agent.agentId || scope.machineId !== published.agent.machineId);
  const available = useFirstWorkbench(otherChat ? null : scope);
  return scope && viewer && available ? (
    <Tour
      key={JSON.stringify([viewer, scope])}
      user={viewer}
      scope={scope}
      canConfigure={currentProject?.role === "owner"}
      automatic={request?.automatic === true}
      close={() => {
        closeGuide(
          guideStorage(
            viewer,
            guideLocation(scope.projectId, scope.agentId, scope.machineId).pathname,
          ),
        );
        setRequest(null);
      }}
    />
  ) : null;
}

function Tour({
  user,
  scope,
  close,
  canConfigure,
  automatic,
}: {
  user: string;
  scope: PageAgent;
  close: () => void;
  canConfigure: boolean;
  automatic: boolean;
}) {
  const w = S.firstWorkbench;
  const { locale } = useLocale();
  const navigate = useNavigate(),
    location = useLocation();
  const { projectId, agentId, machineId } = scope;
  const loc = useMemo(
    () => guideLocation(projectId, agentId, machineId),
    [projectId, agentId, machineId],
  );
  const storage = guideStorage(user, loc.pathname);
  const [saved, setSaved] = useState<GuideProgress>(() => loadGuideProgress(storage));
  const [reload, setReload] = useState(0);
  const [modelError, setModelError] = useState("");
  const [models, setModels] = useState<Awaited<ReturnType<typeof getModels>> | null>(null);
  useEffect(() => {
    let live = true;
    let revision = 0;
    const read = async () => {
      const request = ++revision;
      try {
        const result = await getModels(projectId, machineId);
        if (live && request === revision) {
          setModels(result);
          setModelError("");
        }
      } catch (error) {
        if (live && request === revision)
          setModelError(error instanceof Error ? error.message : String(error));
      }
    };
    void read();
    const off = onModelsChanged((changed) => {
      if (changed === projectId) void read();
    });
    const picked = (event: Event) => {
      const detail = (
        event as CustomEvent<PageAgent & { model: NonNullable<GuideProgress["model"]> }>
      ).detail;
      if (
        detail.projectId === projectId &&
        detail.agentId === agentId &&
        detail.machineId === machineId
      )
        setSaved((previous) => ({ ...previous, model: detail.model }));
    };
    window.addEventListener("focus", read);
    window.addEventListener(GUIDE_MODEL_SELECTED, picked);
    return () => {
      live = false;
      off();
      window.removeEventListener("focus", read);
      window.removeEventListener(GUIDE_MODEL_SELECTED, picked);
    };
  }, [projectId, agentId, machineId, reload]);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [missingSession, setMissingSession] = useState(false);
  const [canGenerate, setCanGenerate] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [discussion, setDiscussion] =
    useState<Awaited<ReturnType<typeof conversationForGuide>>>(null);
  const session = /^\/chat\/([^/]+)$/.exec(location.pathname)?.[1];
  const currentSession =
    session && session !== "new" && machineForSession(session) === machineId ? session : null;
  const active = useSessionsIfAny()?.sessions.find(
    (s) =>
      s.sessionId === currentSession &&
      s.projectId === projectId &&
      s.agentId === agentId &&
      s.source === "user",
  );
  useEffect(() => {
    persistGuideProgress(storage, saved);
  }, [storage, saved]);
  useEffect(() => {
    setDiscussion(null);
  }, [currentSession]);
  const refresh = useCallback(() => readGuide(loc, saved.key), [loc, saved.key]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    setMissingSession(false);
    void Promise.all([refresh(), supportsConversation(loc)])
      .then(([g, supported]) => {
        if (live) {
          setGuide(g);
          setCanGenerate(supported);
        }
      })
      .catch((err: Error) => {
        if (live) {
          setError(err.message);
          setMissingSession(err instanceof ApiError && err.status === 404);
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [refresh, reload, loc]);
  useEffect(() => {
    if (guide?.phase !== "chatting" && guide?.phase !== "generating") return;
    let live = true;
    const timer = window.setTimeout(() => {
      void refresh()
        .then((g) => {
          if (live) setGuide(g);
        })
        .catch((err: Error) => {
          if (live) {
            setError(err.message);
            setMissingSession(err instanceof ApiError && err.status === 404);
          }
        });
    }, 1400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [guide, refresh]);
  const save = (fields: Partial<GuideProgress>) => setSaved((prev) => ({ ...prev, ...fields }));
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const waiting = guide?.phase === "chatting" || guide?.phase === "generating";
  const design = guide?.design;
  const inChat = location.pathname === "/" || location.pathname.startsWith("/chat");
  const usable = models !== null && usableChatModel(models.models);
  const configured = models?.models.filter(hasConfiguredKey) ?? [];
  const chosen =
    defaultChatModel(configured, saved.model) ?? defaultChatModel(configured, models?.defaultModel);
  const step = saved.verified
    ? 6
    : design
      ? saved.installed
        ? 6
        : 5
      : discussion || guide
        ? 4
        : usable
          ? chosen || active
            ? 3
            : 2
          : 1;
  const onModels = location.pathname === "/models";
  const onBoard =
    !!guide &&
    saved.installed &&
    location.pathname === "/apps" &&
    new URLSearchParams(location.search).get("app") ===
      locatedAppKey(agentId, guide.boardId, machineId);
  const anchor =
    onModels && step === 1
      ? '[data-guide-anchor="connect-provider"]'
      : inChat && step === 1
        ? '[data-slot="composer"] [data-slot="banner"]'
        : inChat && step === 2
          ? '[data-slot="composer"] button[aria-label="' + CSS.escape(S.chat.chooseModel) + '"]'
          : inChat
            ? '[data-slot="composer"] textarea'
            : onBoard
              ? 'iframe[src*="/workbenches/' + encodeURIComponent(guide!.boardId) + '/ui/"]'
              : null;
  const setupHint = !canConfigure
    ? w.askOwner
    : machineId
      ? w.remoteModels(machineId)
      : onModels
        ? w.connect
        : w.models;
  const chat = () => {
    if (saved.tourSession) void navigate("/chat/" + encodeURIComponent(saved.tourSession));
    else if (!inChat)
      void navigate("/chat/new", {
        state: { agentId, ...(machineId && { workspace: "", machineId }) },
      });
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea')?.focus(),
    );
  };
  const readConversation = () =>
    run(async () => {
      if (!currentSession) return;
      const next = await conversationForGuide(projectId, agentId, currentSession, machineId);
      if (!next) throw Error(w.waitReply);
      setDiscussion(next);
      save({ tourSession: currentSession });
    });
  const generate = () =>
    run(async () => {
      const body = guide
        ? { action: "generate", feedback: saved.feedback }
        : {
            action: "generate-from-chat",
            ...discussion,
            lang: locale,
            feedback: saved.feedback,
          };
      setGuide(await readGuide(loc, saved.key, body));
    });
  const ask = discussion?.request ?? guide?.request ?? saved.request;
  const answer = discussion?.answer ?? guide?.answer;
  if (!canConfigure && automatic && !usable && !guide) return null;
  return (
    <GuideCallout
      anchorSelector={anchor}
      title={w.title}
      laterLabel={w.later}
      onLater={close}
      step={{ current: step, total: 6 }}
    >
      {(error || modelError) && (
        <p role="alert" className="mb-2 text-tone-danger-fg">
          {error || modelError}{" "}
          <Button size="sm" onClick={() => setReload((n) => n + 1)}>
            {w.refresh}
          </Button>
          {missingSession && (
            <Button
              size="sm"
              onClick={() => {
                setGuide(null);
                setDiscussion(null);
                setSaved((previous) => ({
                  key: freshGuideKey(),
                  ...(previous.model && { model: previous.model }),
                }));
              }}
            >
              {w.newChecklist}
            </Button>
          )}
        </p>
      )}
      {(busy || (!models && !modelError)) && <p role="status">{w.loading}</p>}
      {waiting && <p role="status">{guide.phase === "generating" ? w.generating : w.waitReply}</p>}
      {models && !busy && !waiting && !design && (
        <>
          {!answer && <p>{step === 1 ? setupHint : step === 2 ? w.choose : w.chat}</p>}
          {ask && <p className="mt-2 whitespace-pre-wrap break-words">{ask}</p>}
          {saved.model && !guide && <p>{saved.model.modelId}</p>}
          {answer && (
            <details>
              <summary>{w.reply}</summary>
              <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{answer}</p>
            </details>
          )}
          {(guide?.phase === "design-error" || guide?.phase === "chat-error") && (
            <p role="alert">{guide.error}</p>
          )}
          {answer && (
            <label className="mt-2 block">
              {w.feedback}
              <textarea
                rows={2}
                maxLength={2000}
                className="block w-full rounded-control border border-line bg-control p-1"
                value={saved.feedback ?? ""}
                onChange={(e) => save({ feedback: e.target.value })}
              />
            </label>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {!guide && !discussion && (
              <>
                {step === 1 && canConfigure && !onModels && !machineId && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      void navigate("/models");
                    }}
                  >
                    {w.modelSettings}
                  </Button>
                )}
                {step === 1 && (machineId || !canConfigure) && (
                  <Button size="sm" onClick={() => setReload((n) => n + 1)}>
                    {w.refresh}
                  </Button>
                )}
                {!inChat && step > 1 && (
                  <Button size="sm" variant="primary" onClick={chat}>
                    {w.toChat}
                  </Button>
                )}
              </>
            )}
            {(!guide || guide.phase === "chat-error") &&
              !discussion &&
              active?.status === "idle" &&
              active.hasTrace && (
                <Button size="sm" variant="primary" onClick={() => void readConversation()}>
                  {w.useReply}
                </Button>
              )}
            {guide?.phase === "chat-error" && saved.model && saved.request && (
              <Button
                size="sm"
                onClick={() =>
                  void run(async () => {
                    setGuide(
                      await readGuide(loc, saved.key, {
                        action: "chat",
                        request: saved.request,
                        model: saved.model,
                        lang: locale,
                      }),
                    );
                  })
                }
              >
                {w.retryChat}
              </Button>
            )}
            {answer && (guide || canGenerate) && (
              <Button size="sm" variant="primary" onClick={() => void generate()}>
                {w.generate}
              </Button>
            )}
          </div>
        </>
      )}
      {design && guide && (
        <>
          <strong>{design.title}</strong>
          {!saved.installed && (
            <ul className="my-2 list-disc ps-5">
              {design.items.map((i, n) => (
                <li key={n}>
                  <strong>{i.group}</strong>
                  <div>{i.task}</div>
                  <div className="text-fg-muted">{i.doneWhen}</div>
                </li>
              ))}
            </ul>
          )}
          {saved.verified && <p role="status">{w.verified}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {!saved.installed ? (
              <Button
                disabled={busy}
                size="sm"
                variant="primary"
                onClick={() =>
                  void run(async () => {
                    await installGuideBoard(loc, saved.key, guide);
                    save({ installed: true });
                  })
                }
              >
                {w.install}
              </Button>
            ) : (
              <>
                {!onBoard && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      void navigate(appWindowPath(locatedAppKey(agentId, guide.boardId, machineId)))
                    }
                  >
                    {w.open}
                  </Button>
                )}
                {onBoard && !saved.verified && (
                  <Button
                    size="sm"
                    disabled={busy}
                    variant="primary"
                    onClick={() =>
                      void run(async () => {
                        await verifyGuideBoard(loc, guide, w.testItem);
                        save({ verified: true });
                      })
                    }
                  >
                    {w.test}
                  </Button>
                )}
              </>
            )}
            <a
              className="text-link underline"
              download
              href={loc.pathname.replace(
                /\/ui\/index\.html$/,
                "/api/guides/" + saved.key + "/plugin.zip",
              )}
            >
              {w.download}
            </a>
          </div>
        </>
      )}
      {!guide && !busy && !canGenerate && !error && (
        <div className="mt-2">
          <p>{w.updateNeeded}</p>
          <Button size="sm" onClick={() => setConfirmUpdate(true)}>
            {w.update}
          </Button>
        </div>
      )}
      <ConfirmModal
        open={confirmUpdate}
        title={w.update}
        cancelLabel={S.common.cancel}
        confirmLabel={w.update}
        onClose={() => setConfirmUpdate(false)}
        onConfirm={() => {
          setConfirmUpdate(false);
          void run(async () => {
            await installWithModules(scope, ["first-workbench-guide"]);
            const supported = await supportsConversation(loc);
            if (!supported) throw Error(w.updateUnavailable);
            setCanGenerate(true);
          });
        }}
      >
        <p>{w.updateWarning}</p>
      </ConfirmModal>
    </GuideCallout>
  );
}
