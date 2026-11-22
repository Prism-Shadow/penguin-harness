/**
 * The Storage page's two breakdowns (Settings › Storage):
 *
 * - By Project: one row per Project — its name, a thin usage bar by category and its size —
 *   largest first, each opening onto its Agents in rows of the same shape. Every bar in the
 *   section is drawn on one scale, the largest Project's, so the rows compare at a glance. An
 *   admin also gets one muted row for the Projects of other users: how many and their size,
 *   never their names, and nothing to open.
 * - By folder: the data root for an admin, each Project's folder for a member — the path in the
 *   data face on one line (cut off when long, whole on hover), a copy button, the size, and in
 *   the desktop shell's own window a button that shows the folder in the file manager. An admin
 *   also gets a fold over the data root's top-level entries that are not Projects, largest first.
 */
import { useState } from "react";
import {
  Chevron,
  CopyButton,
  Fold,
  GlyphAction,
  ICONS,
  ICON_SIZE,
  SettingsGroup,
  UsageBar,
} from "@prismshadow/penguin-ui";
import type { StorageRevealRequest, StorageServerEntry, StorageUsage } from "../types";
import { categorySegments, formatSize } from "./storage-format";
import { S } from "./strings";

/** A breakdown row's columns: the name gives way first, the bar next, the size keeps its width. */
const ROW = "grid grid-cols-[minmax(0,1fr)_minmax(3rem,10rem)_4.5rem] items-center gap-3 py-2";

/** Largest first, then by name, so rows of one size keep their place across reads. */
const bySize = <T extends { bytes: number; name: string }>(a: T, b: T) =>
  b.bytes - a.bytes || a.name.localeCompare(b.name);

export function ProjectBreakdown({ usage }: { usage: StorageUsage }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const projects = [...usage.projects].sort(bySize);
  const others = usage.server?.otherProjects;
  const scale = Math.max(0, ...projects.map((p) => p.bytes));
  const toggle = (projectId: string) => {
    const next = new Set(open);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    setOpen(next);
  };
  return (
    <SettingsGroup title={S.storage.byProject}>
      {projects.length === 0 && (others?.count ?? 0) === 0 && (
        <p className="py-2 text-sm text-fg-muted">{S.storage.noProjects}</p>
      )}
      {projects.map((project) => {
        const expandable = project.agents.length > 0;
        const shown = expandable && open.has(project.projectId);
        const cells = (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              {expandable ? (
                <Chevron open={shown} size={ICON_SIZE.chevron} className="text-fg-subtle" />
              ) : (
                <span aria-hidden className="w-3.5 shrink-0" />
              )}
              <span className="min-w-0 truncate">{project.name}</span>
            </span>
            <UsageBar
              segments={categorySegments(project.categories)}
              size="sm"
              max={scale}
              label={project.name}
            />
            <span className="text-right tabular-nums">{formatSize(project.bytes)}</span>
          </>
        );
        return (
          <div key={project.projectId} className="text-sm">
            {expandable ? (
              <button
                type="button"
                aria-expanded={shown}
                onClick={() => toggle(project.projectId)}
                className={`${ROW} w-full text-left`}
              >
                {cells}
              </button>
            ) : (
              <div className={ROW}>{cells}</div>
            )}
            {expandable && (
              <Fold open={shown}>
                <ul className="pb-1">
                  {[...project.agents].sort(bySize).map((agent) => (
                    <li key={agent.agentId} className={ROW}>
                      <span className="min-w-0 truncate pl-5 text-fg-muted">{agent.name}</span>
                      <UsageBar
                        segments={categorySegments(agent.categories)}
                        size="sm"
                        max={scale}
                        label={agent.name}
                      />
                      <span className="text-right tabular-nums text-fg-muted">
                        {formatSize(agent.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}
          </div>
        );
      })}
      {others !== undefined && others.count > 0 && (
        <div className={`${ROW} text-sm text-fg-muted`}>
          <span className="min-w-0 truncate pl-5">{S.storage.otherProjects(others.count)}</span>
          <span aria-hidden />
          <span className="text-right tabular-nums">{formatSize(others.bytes)}</span>
        </div>
      )}
    </SettingsGroup>
  );
}

export function FolderBreakdown({
  usage,
  canReveal,
  onReveal,
}: {
  usage: StorageUsage;
  /** The page is in the desktop shell's own window, whose file manager can show a folder. */
  canReveal: boolean;
  onReveal: (body: StorageRevealRequest) => void;
}) {
  const server = usage.server;
  const folders: { key: string; path: string; bytes: number; reveal: StorageRevealRequest }[] =
    server !== undefined
      ? [{ key: "root", path: server.root, bytes: server.bytes, reveal: {} }]
      : [...usage.projects].sort(bySize).map((project) => ({
          key: project.projectId,
          path: project.path,
          bytes: project.bytes,
          reveal: { projectId: project.projectId },
        }));
  return (
    <SettingsGroup title={S.storage.byFolder}>
      {folders.map((folder) => (
        <div key={folder.key} className="flex min-w-0 items-center gap-2 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{folder.path}</span>
          <CopyButton
            text={folder.path}
            label={S.storage.copyPath}
            size="sm"
            className="shrink-0"
          />
          <span className="w-[4.5rem] shrink-0 text-right text-sm tabular-nums">
            {formatSize(folder.bytes)}
          </span>
          {canReveal && (
            <GlyphAction
              glyph={ICONS.folderOpen}
              label={S.storage.reveal}
              onClick={() => onReveal(folder.reveal)}
            />
          )}
        </div>
      ))}
      {server !== undefined && server.entries.length > 0 && (
        <ServerFiles entries={server.entries} />
      )}
    </SettingsGroup>
  );
}

/** An admin's fold over the data root's top-level entries that are not Projects. */
function ServerFiles({ entries }: { entries: readonly StorageServerEntry[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...entries].sort(bySize);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 py-2 text-left text-sm"
      >
        <Chevron open={open} size={ICON_SIZE.chevron} className="text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate">{S.storage.serverFiles}</span>
        <span className="shrink-0 text-xs tabular-nums text-fg-muted">
          {S.storage.count(sorted.length)}
        </span>
      </button>
      <Fold open={open}>
        <ul className="pb-1">
          {sorted.map((entry) => (
            <li key={entry.name} className="flex min-w-0 items-center gap-2 py-1 pl-5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
              <span className="w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-fg-muted">
                {formatSize(entry.bytes)}
              </span>
            </li>
          ))}
        </ul>
      </Fold>
    </div>
  );
}
