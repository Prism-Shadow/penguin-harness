/**
 * App Center page (/apps): the apps registered from this Project's conversations
 * (`<project>/apps/<id>.toml`, written by `penguin app register` from the Session that built
 * the app, or by the manual form here), each with its probed status and the two actions that
 * reach its owning Session — restart and stop compose an `[app_center]` user input the server
 * sends there as a new Task (or steers into the running one), so the work happens in the
 * conversation that knows how the app runs. The list re-probes on the refresh button and every
 * 20s while mounted; rows filter by a search box and a status segment. "Create with AI" opens
 * the shared kit's dialog on the Project's default agent with the app-building tail; "Set up
 * manually" registers an existing app against one of the Project's recent Sessions.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { AppAction, AppItem, AppsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MESSAGING_ICON } from "../../components/ui/icons";
import { Input } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import {
  ELLIPSIS_ICON,
  PENCIL_ICON,
  TRASH_ICON,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { Skeleton } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { AiCreateButton, AiCreateModal, CreateMenuButton } from "../ai-create";
import { AppFormModal } from "./app-form-modal";
import {
  APP_KIND_ICONS,
  APP_STATUS_BADGE,
  APP_STATUS_FILTERS,
  appHost,
  filterApps,
  relativeAge,
} from "./apps-model";
import type { AppStatusFilter } from "./apps-model";

/** Refresh button icon (rotate-cw, 24×24 line path). */
const REFRESH_ICON = "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10";

/** Skills the AI-created app should build with; the composer drops any the agent lacks. */
const APP_SKILLS = ["software-engineering", "web-design", "app-center"];

/** Re-probe period while the page is open; the server's own status cache is shorter, so each tick is a fresh probe. */
const REFRESH_MS = 20_000;

export function AppsPage() {
  useDocumentTitle(S.apps.title);
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { currentProject, agents, setCurrentAgentId } = useProject();
  const { sessions } = useSessions();
  const projectId = currentProject?.projectId ?? null;
  // Registering, editing and unregistering are owner-only server-side (like schedules), so a
  // member is offered neither entry point; reading and the restart / stop actions are theirs.
  const isOwner = currentProject?.role === "owner";

  const [data, setData] = useState<AppsResponse | null>(null);
  /** First-load failure, shown in place of the list; a later poll failure leaves the list standing. */
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AppStatusFilter>("all");
  /** Ids with a restart / stop request in flight (their buttons are disabled meanwhile). */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [aiOpen, setAiOpen] = useState(false);
  const [form, setForm] = useState<{ app: AppItem | null } | null>(null);
  const [unregisterTarget, setUnregisterTarget] = useState<AppItem | null>(null);
  const [unregistering, setUnregistering] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!projectId) return;
      try {
        setData(await api.listApps(projectId, refresh));
        setError(null);
      } catch (err) {
        // Recorded, not toasted: the 20s re-probe would otherwise stack one toast per tick for
        // as long as the server is unreachable.
        setError(apiErrorText(err));
      }
    },
    [projectId],
  );

  useEffect(() => {
    setData(null);
    setError(null);
    void load(false);
    const timer = setInterval(() => void load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (app: AppItem, action: AppAction) => {
    if (!projectId) return;
    setBusy((prev) => new Set(prev).add(app.id));
    try {
      await api.appAction(projectId, app.id, action);
      toastSuccess(S.apps.actionSent);
    } catch (err) {
      toastError(
        err instanceof ApiError && err.code === "app_session_missing"
          ? S.apps.sessionMissing
          : apiErrorText(err),
      );
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(app.id);
        return next;
      });
    }
  };

  const unregister = async () => {
    if (!projectId || !unregisterTarget) return;
    setUnregistering(true);
    try {
      await api.deleteApp(projectId, unregisterTarget.id);
      toastSuccess(S.apps.unregistered);
      setUnregisterTarget(null);
      void load(false);
    } catch (err) {
      toastError(apiErrorText(err));
    } finally {
      setUnregistering(false);
    }
  };

  const goToSession = (app: AppItem) => {
    setCurrentAgentId(app.agentId);
    navigate(`/chat/${app.sessionId}`);
  };

  const sessionLabel = (app: AppItem) =>
    app.sessionExists
      ? S.apps.fromSession(app.sessionTitle ?? S.chat.defaultSessionTitle)
      : S.apps.fromDeletedSession;

  const visible = data ? filterApps(data.apps, query, filter) : [];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{S.apps.title}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{S.apps.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="icon"
              title={S.apps.refresh}
              aria-label={S.apps.refresh}
              onClick={() => void load(true)}
            >
              <GlyphIcon d={REFRESH_ICON} size={ICON_SIZE.iconButton} />
            </Button>
            {isOwner && (
              <CreateMenuButton
                label={S.apps.create}
                onAi={() => setAiOpen(true)}
                onManual={() => setForm({ app: null })}
              />
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            className="w-full sm:w-64"
            placeholder={S.apps.searchPlaceholder}
            aria-label={S.apps.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Segmented
            options={APP_STATUS_FILTERS.map((value) => ({
              value,
              label: value === "all" ? S.apps.filterAll : S.apps.statusNames[value]!,
            }))}
            value={filter}
            onChange={setFilter}
            cols={4}
          />
        </div>

        {data === null ? (
          error !== null ? (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )
        ) : data.apps.length === 0 ? (
          <EmptyState
            title={S.apps.emptyTitle}
            description={S.apps.emptyDesc}
            {...(isOwner
              ? { action: <AiCreateButton variant="primary" onClick={() => setAiOpen(true)} /> }
              : {})}
          />
        ) : visible.length === 0 ? (
          <EmptyState title={S.apps.noMatch} />
        ) : (
          <ul className="mt-4 divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {visible.map((app) => {
              const inFlight = busy.has(app.id);
              const meta = [
                S.apps.registeredAgo(relativeAge(app.registeredAt, locale)),
                ...(app.url !== undefined ? [appHost(app.url)] : []),
                sessionLabel(app),
              ].join(" · ");
              return (
                <li key={app.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span
                    title={S.apps.kindNames[app.kind]}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    <GlyphIcon d={APP_KIND_ICONS[app.kind]} size={ICON_SIZE.sectionMark} />
                  </span>
                  {/* A basis keeps the text column from collapsing to nothing when the
                      actions do not fit beside it: they wrap under it instead. */}
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {app.name}
                      </span>
                      {app.description !== undefined && (
                        <span className="hidden truncate text-xs text-gray-500 sm:inline dark:text-gray-400">
                          {app.description}
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-500"
                      title={meta}
                    >
                      {meta}
                    </p>
                  </div>
                  <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                    <span className="mr-1">
                      <Badge tone={APP_STATUS_BADGE[app.status]}>
                        {S.apps.statusNames[app.status]}
                      </Badge>
                    </span>
                    {app.url !== undefined && (
                      <Button
                        size="sm"
                        onClick={() => window.open(app.url, "_blank", "noopener,noreferrer")}
                      >
                        {S.apps.open}
                      </Button>
                    )}
                    <Button size="sm" disabled={inFlight} onClick={() => void act(app, "restart")}>
                      {S.apps.restart}
                    </Button>
                    <Button size="sm" disabled={inFlight} onClick={() => void act(app, "stop")}>
                      {S.apps.stop}
                    </Button>
                    <AppRowMenu
                      app={app}
                      canWrite={isOwner}
                      onGoToSession={() => goToSession(app)}
                      onEdit={() => setForm({ app })}
                      onUnregister={() => setUnregisterTarget(app)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {data !== null && data.invalidFiles.length > 0 && (
          <div className="mt-4 rounded-md border border-dashed border-gray-300 px-4 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-500">
            <p className="font-medium">{S.apps.invalidFiles}</p>
            <ul className="mt-1 space-y-0.5">
              {data.invalidFiles.map((f) => (
                <li key={f.id} className="truncate">
                  <span className="font-mono">{f.id}.toml</span> — {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <AiCreateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={S.apps.aiTitle}
        description={S.apps.aiDesc}
        placeholder={S.apps.aiPlaceholder}
        examples={[...S.apps.aiExamples]}
        tail={S.apps.aiCreateTail}
        agents={agents}
        skills={APP_SKILLS}
      />
      {projectId !== null && (
        <AppFormModal
          open={form !== null}
          projectId={projectId}
          app={form?.app ?? null}
          sessions={sessions}
          onClose={() => setForm(null)}
          onSaved={() => void load(false)}
        />
      )}
      <ConfirmModal
        open={unregisterTarget !== null}
        title={S.apps.unregisterTitle}
        onClose={() => setUnregisterTarget(null)}
        onConfirm={() => void unregister()}
        confirmLabel={S.apps.unregister}
        busy={unregistering}
      >
        {unregisterTarget !== null && S.apps.unregisterConfirm(unregisterTarget.name)}
      </ConfirmModal>
    </div>
  );
}

/**
 * The row's ellipsis menu: jump to the owning Session, and — for the Project owner, who is the
 * only one the API lets write — edit the registration or unregister it.
 */
function AppRowMenu({
  app,
  canWrite,
  onGoToSession,
  onEdit,
  onUnregister,
}: {
  app: AppItem;
  canWrite: boolean;
  onGoToSession: () => void;
  onEdit: () => void;
  onUnregister: () => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="inline-block"
      portal={{ direction: "down", align: "right" }}
      menuClass="w-44"
      button={
        <Button
          size="icon"
          variant="ghost"
          aria-haspopup="menu"
          aria-expanded={open}
          title={S.apps.menuLabel}
          aria-label={S.apps.menuLabel}
          onClick={() => setOpen((v) => !v)}
        >
          <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.iconButton} />
        </Button>
      }
    >
      <div role="menu" className="py-1">
        <button
          type="button"
          role="menuitem"
          className={overflowMenuRowClass}
          disabled={!app.sessionExists}
          onClick={() => run(onGoToSession)}
        >
          {overflowMenuGlyph(MESSAGING_ICON)}
          {S.apps.goToSession}
        </button>
        {canWrite && (
          <>
            <button
              type="button"
              role="menuitem"
              className={overflowMenuRowClass}
              onClick={() => run(onEdit)}
            >
              {overflowMenuGlyph(PENCIL_ICON)}
              {S.apps.edit}
            </button>
            <button
              type="button"
              role="menuitem"
              className={overflowMenuDangerClass}
              onClick={() => run(onUnregister)}
            >
              {overflowMenuGlyph(TRASH_ICON)}
              {S.apps.unregister}
            </button>
          </>
        )}
      </div>
    </Dropdown>
  );
}
