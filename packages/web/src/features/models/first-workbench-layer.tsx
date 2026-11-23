import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@prismshadow/penguin-ui";
import type { PageAgent } from "../../lib/page-agent";
import { GUIDE_START, useFirstWorkbench } from "../../lib/first-workbench-entry";
import {
  conversationForGuide,
  freshGuideKey,
  guideLocation,
  guideStorage,
  installGuideBoard,
  readGuide,
  verifyGuideBoard,
  type Guide,
  type GuideProgress,
} from "../../lib/first-workbench-tour";
import { machineForSession } from "../../lib/session-machines";
import { appWindowPath, locatedAppKey } from "../../lib/app-center-path";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { useLocale } from "../../state/locale";

export function FirstWorkbenchLayer() {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const { state, pathname, search } = useLocation();
  const navigate = useNavigate();
  const [request, setRequest] = useState<{ scope: PageAgent; user: string } | null>(null);
  const project = currentProject?.projectId,
    viewer = user?.userId;
  useEffect(() => {
    setRequest(null);
    const handle = (scope: PageAgent) => {
      if (viewer && scope.projectId === project) setRequest({ scope, user: viewer });
    };
    const open = (e: Event) => handle((e as CustomEvent<PageAgent>).detail);
    window.addEventListener(GUIDE_START, open);
    return () => window.removeEventListener(GUIDE_START, open);
  }, [viewer, project]);
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
          firstWorkbench: { projectId: project, agentId: linkedAgent, machineId: linkedMachine },
        },
      });
  }, [oldGuide, project, linkedAgent, linkedMachine, navigate]);
  const linked = (state as { firstWorkbench?: PageAgent } | null)?.firstWorkbench;
  useEffect(() => {
    if (linked && viewer && linked.projectId === project)
      setRequest({ scope: linked, user: viewer });
  }, [linked, viewer, project]);
  const scope =
    request?.user === viewer && request?.scope.projectId === project
      ? (request?.scope ?? null)
      : null;
  const available = useFirstWorkbench(scope);
  return scope && viewer && available ? (
    <Tour
      key={JSON.stringify([viewer, scope])}
      user={viewer}
      scope={scope}
      close={() => setRequest(null)}
    />
  ) : null;
}

function Tour({ user, scope, close }: { user: string; scope: PageAgent; close: () => void }) {
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
  const [saved, setSaved] = useState<GuideProgress>(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem(storage) ?? "null");
      if (typeof data?.key === "string" && /^[0-9a-f]{32}$/.test(data.key)) return data;
    } catch {
      /* A storage-restricted browser can still complete the tour in this window. */
    }
    return { key: freshGuideKey() };
  });
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [discussion, setDiscussion] =
    useState<Awaited<ReturnType<typeof conversationForGuide>>>(null);
  const session = /^\/chat\/([^/]+)$/.exec(location.pathname)?.[1];
  const currentSession =
    session && session !== "new" && machineForSession(session) === machineId ? session : null;
  useEffect(() => {
    try {
      sessionStorage.setItem(storage, JSON.stringify(saved));
    } catch {
      /* Keep the in-memory progress. */
    }
  }, [storage, saved]);
  useEffect(() => {
    setDiscussion(null);
  }, [currentSession]);
  const refresh = useCallback(() => readGuide(loc, saved.key), [loc, saved.key]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    void refresh()
      .then((g) => {
        if (live) setGuide(g);
      })
      .catch((err: Error) => {
        if (live) setError(err.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [refresh, reload]);
  useEffect(() => {
    if (guide?.phase !== "chatting" && guide?.phase !== "generating") return;
    let live = true;
    const timer = window.setTimeout(() => {
      void refresh()
        .then((g) => {
          if (live) setGuide(g);
        })
        .catch((err: Error) => {
          if (live) setError(err.message);
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
  const chat = () => {
    save({ tourChat: true });
    if (saved.tourSession) void navigate("/chat/" + encodeURIComponent(saved.tourSession));
    else if (!inChat) void navigate("/chat/new", { state: { agentId, machineId } });
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
      save({ tourSession: currentSession, tourChat: true });
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
  return (
    <aside
      role="region"
      aria-label={w.title}
      className="fixed end-3 top-[calc(var(--window-band-height,0px)+3rem)] z-dock w-[min(21rem,calc(100vw-1.5rem))] max-h-[48dvh] overflow-y-auto rounded-panel border border-line bg-surface p-3 text-sm text-fg shadow-panel"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <strong>{w.title}</strong>
        <Button variant="ghost" size="sm" onClick={close}>
          {w.later}
        </Button>
      </header>
      {error && (
        <p role="alert" className="mb-2 text-tone-danger-fg">
          {error}{" "}
          <Button size="sm" onClick={() => setReload((n) => n + 1)}>
            {w.refresh}
          </Button>
        </p>
      )}
      {busy && <p role="status">{w.loading}</p>}
      {waiting && <p role="status">{guide.phase === "generating" ? w.generating : w.waitReply}</p>}
      {!busy && !waiting && !design && (
        <>
          {!saved.tourChat && !guide && !discussion && <p>{w.models}</p>}
          {(saved.tourChat || guide?.phase === "chat-error") && !answer && <p>{w.chat}</p>}
          {ask && <p className="mt-2 whitespace-pre-wrap break-words">{ask}</p>}
          {saved.model && !guide && <p>{saved.model.modelId}</p>}
          {answer && (
            <details open>
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
                <Button
                  size="sm"
                  onClick={() => {
                    save({ visitedSettings: true });
                    void navigate("/models");
                  }}
                >
                  {w.modelSettings}
                </Button>
                <Button size="sm" onClick={chat}>
                  {w.toChat}
                </Button>
              </>
            )}
            {(!guide || guide.phase === "chat-error") && !discussion && currentSession && (
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
            {answer && (
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
          <ul className="my-2 list-disc ps-5">
            {design.items.map((i, n) => (
              <li key={n}>
                <strong>{i.group}</strong> · {i.task}
                <div className="text-fg-muted">{i.doneWhen}</div>
              </li>
            ))}
          </ul>
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
                <Button
                  size="sm"
                  onClick={() =>
                    void navigate(appWindowPath(locatedAppKey(agentId, guide.boardId, machineId)))
                  }
                >
                  {w.open}
                </Button>
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
    </aside>
  );
}
