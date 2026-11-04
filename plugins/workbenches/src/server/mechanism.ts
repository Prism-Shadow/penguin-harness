
/** How the Web App draws a contributed tab: a page of the workbench, or a renderer it carries. */
/**
 * One tab beside Chat, as the workbench contributed it (`WebModule.sessionTabs`). In a
 * manifest `renderer.iframe.src` is a path inside the workbench folder, under `ui/`; in a
 * `WorkbenchInfo` it is the URL that file is served from.
 */
  id: string;
  /** Unique within the workbench; the tab's stable name (it appears in the full-page URL). */
  key: string;
  title: string;
  titleZh?: string;
  renderer: WorkbenchTabRenderer;
}
  id: string;
  name: string;
  version: string | null;
  /** git's tree id (12 hex) of the folder's source: what history records. */
  revision: string;
  /** Content revision of `ui/`: the cache key of the workbench's pages. Null when it has no `ui/`. */
  uiRev: string | null;
  /** The tabs of the instance that is SERVING — the previous one's while `error` is set. */
  tabs: WorkbenchTab[];
  loadedAt: string;
  /** The boot error when the current files do not load (the previous instance, if any, keeps serving). */
  error: string | null;
  /**
   * What loaded but is probably not what its author meant, each with the edit that settles it
   * — pages under `ui/` that no tab shows, say. Never a failure: `error` is that.
   */
  hints: string[];
}
/**
 * What the HTML of a compiled page is served with: the page runtime's import map and its
 * stylesheet, each a file of the runtime (`…/workbenches/:id/sdk/ui/<file>`).
 */
  /** Bare specifier → the runtime file it loads. */
  stylesheet: string;
}
/** A file of a workbench's pages, as `uiFile` finds it. */
  /** Absolute path: a file under `ui/`, or the `.js` a TSX page compiled to under `.build/`. */
  path: string;
  /**
   * Set on an HTML page of a workbench whose pages are compiled: the runtime its import map
   * names. Null on every file served exactly as it is on disk.
   */
  compiled: WorkbenchUiRuntime | null;
}
/** A file of this server's page runtime, with a strong validator of its bytes. */
  body: Uint8Array;
  etag: string;
}
/** A version of a workbench: a commit of the Agent State repository that changed its folder. */
  /** The folder's revision at that commit (`WorkbenchInfo.revision` when it was loaded). */
  revision: string;
  /** The commit (12 hex) in `<agentDir>/agent_state.git`. */
  commit: string;
  savedAt: string;
}
||||||| parent of d6be2d5885 (workbench DTOs live in api types; mechanism imports them from api)
/** How the Web App draws a contributed tab: a page of the workbench, or a renderer it carries. */
/**
 * One tab beside Chat, as the workbench contributed it (`WebModule.sessionTabs`). In a
 * manifest `renderer.iframe.src` is a path inside the workbench folder, under `ui/`; in a
 * `WorkbenchInfo` it is the URL that file is served from.
 */
  id: string;
  /** Unique within the workbench; the tab's stable name (it appears in the full-page URL). */
  key: string;
  title: string;
  titleZh?: string;
  renderer: WorkbenchTabRenderer;
}
  id: string;
  name: string;
  version: string | null;
  /** Content revision of the whole folder (what history records). */
  revision: string;
  /** Content revision of `ui/`: the cache key of the workbench's pages. Null when it has no `ui/`. */
  uiRev: string | null;
  /** The tabs of the instance that is SERVING — the previous one's while `error` is set. */
  tabs: WorkbenchTab[];
  loadedAt: string;
  /** The boot error when the current files do not load (the previous instance, if any, keeps serving). */
  error: string | null;
  /**
   * What loaded but is probably not what its author meant, each with the edit that settles it
   * — pages under `ui/` that no tab shows, say. Never a failure: `error` is that.
   */
  hints: string[];
}
  revision: string;
  savedAt: string;
  name: string;
  version: string | null;
  uiRev: string | null;
  /** The files of that version (relative paths), for display. */
  files: string[];
}
@Interface()
export abstract class Workbenches {
  abstract list(projectId: string, agentId: string): Promise<WorkbenchInfo[]>;
  abstract reload(projectId: string, agentId: string, workbenchId: string): Promise<WorkbenchInfo>;
  abstract dispatch(
    projectId: string,
    agentId: string,
    workbenchId: string,
    request: WorkbenchRequest,
  ): Promise<WorkbenchResponse>;
  /**
   * A file of the workbench's `ui/`: the one on disk, else — for a `.js` a TSX page compiles
   * to — what the serving instance emitted. Null when absent or unsafe.
   */
  abstract uiFile(
    projectId: string,
    agentId: string,
    workbenchId: string,
    rel: string,
  ): Promise<WorkbenchUiFile | null>;
  /**
   * A file of the page runtime this server serves compiled pages with (React and the shared
   * components), under a workbench that exists; null otherwise.
   */
  abstract uiRuntimeFile(
    projectId: string,
    agentId: string,
    workbenchId: string,
    rel: string,
  ): Promise<WorkbenchUiRuntimeFile | null>;
  abstract history(
    projectId: string,
    agentId: string,
    workbenchId: string,
  ): Promise<WorkbenchVersion[]>;
  abstract rollback(
    projectId: string,
    agentId: string,
    workbenchId: string,
    revision: string,
  ): Promise<WorkbenchInfo>;
  /**
   * Deletes the folder, state included, and records the removal; its earlier versions are no
   * longer listed. The instance goes with it.
   */
  abstract remove(projectId: string, agentId: string, workbenchId: string): Promise<void>;
  /**
   * Lets go of everything held for one Agent before its folder is deleted or its State is
   * replaced: the folder watcher, pending reloads, loads in flight and the loaded instances. A
   * later listing takes them up again, so an Agent whose deletion is then refused loses nothing.
   */
  abstract releaseAgent(projectId: string, agentId: string): Promise<void>;
  /**
   * Runs `work` (an Agent State import) with the Agent's workbenches released as by
   * `releaseAgent` and kept so until it settles: a request for them meanwhile waits for the end
   * instead of watching or loading the directory being replaced.
   */
  abstract whileReleased<T>(projectId: string, agentId: string, work: () => Promise<T>): Promise<T>;
}
