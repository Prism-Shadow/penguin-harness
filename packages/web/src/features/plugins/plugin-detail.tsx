/**
 * A plugin's detail dialog — every plugin's, opened by clicking its card (the model library's
 * card-detail pattern); there is no detail page. The header names what the card names (icon,
 * version, category, status, "built in", the package specifier of a server module). Below it,
 * in ruled sections:
 *
 * - **About**: the full description, and the package's own README.md where it ships one (every
 *   server module does). The README is read from the package on this server, never fetched from
 *   npm: a package this server does not have says so instead.
 * - **Files**, for a plugin of Skills and/or a hook package: the shared read-only file browser
 *   over everything an install writes — one directory per skill and one for the hook package,
 *   any number open at once, a preview on the right (the first SKILL.md opens on arrival). The
 *   files arrive in one request (GET /api/plugins/:plugin/files), so nothing is fetched per
 *   directory.
 *
 * A plugin that is both shows About, then Files. The footer holds the card's own actions.
 */
import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  Badge,
  CopyButton,
  FileBrowser,
  ICONS,
  Modal,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
  RuledSection,
  Skeleton,
} from "@prismshadow/penguin-ui";
import type { FileBrowserPreview, FileTreeRow, TreeToggle } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { baseName } from "../../lib/workspace-tree";
import { useLocale } from "../../state/locale";
import { getLibraryPluginReadme, getPluginFiles, getPluginReadme } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { SkillTile } from "../skills/skill-icon-view";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import type { ModulePart, PluginRow } from "./plugin-groups";
import type { PluginStatus } from "./plugin-status";
import {
  PluginTag,
  StatusMark,
  rowBuiltin,
  rowInstalledOnServer,
  rowDescription,
  rowIcon,
  rowVersion,
} from "./plugin-marks";

/** One collapsible group of the tree: a skill's directory, or the hook package's scripts. */
interface FileGroup {
  id: string;
  label: string;
  /** Paths (the response's keys), SKILL.md first, the rest in name order. */
  paths: string[];
}

/** The preview of one file, whose text the files response already carries. */
function filePreview(path: string, text: string): FileBrowserPreview {
  return {
    path,
    name: baseName(path),
    // Everything a plugin ships is text here — the response is a path-to-content map — so the
    // only question is whether it reads as a document or as source.
    kind: path.endsWith(".md") ? "md" : "text",
    content: text,
  };
}

/**
 * The tree's groups, from the response's keys: `skills/<name>/…` files under their skill (in
 * the plugin's skill order), `hooks/…` scripts in one group at the end. SKILL.md leads its
 * group; every other file follows in path order.
 */
export function groupPluginFiles(
  paths: readonly string[],
  skillOrder: readonly string[],
  hooksLabel: string,
): FileGroup[] {
  const bySkill = new Map<string, string[]>();
  const hooks: string[] = [];
  for (const path of [...paths].sort()) {
    const skill = /^skills\/([^/]+)\//.exec(path)?.[1];
    if (skill !== undefined) {
      const list = bySkill.get(skill) ?? [];
      list.push(path);
      bySkill.set(skill, list);
    } else if (path.startsWith("hooks/")) {
      hooks.push(path);
    }
  }
  const leadWithSkillMd = (skill: string, list: string[]): string[] => {
    const lead = `skills/${skill}/SKILL.md`;
    return list.includes(lead) ? [lead, ...list.filter((p) => p !== lead)] : list;
  };
  const skills = [...skillOrder, ...[...bySkill.keys()].filter((s) => !skillOrder.includes(s))];
  const groups: FileGroup[] = [];
  for (const skill of skills) {
    const list = bySkill.get(skill);
    if (list)
      groups.push({ id: `skills/${skill}`, label: skill, paths: leadWithSkillMd(skill, list) });
  }
  if (hooks.length > 0) groups.push({ id: "hooks", label: hooksLabel, paths: hooks });
  return groups;
}

/** A directory of the tree while it is being built: the files directly in it, and what nests under it. */
interface TreeNode {
  path: string;
  name: string;
  kind: "dir" | "file";
  children: TreeNode[];
}

/**
 * The tree's rows for `groups`: each group is a directory row holding its own files, and a
 * file's remaining path segments nest under it — a skill's `reference/` is a directory of its
 * own rather than a slash inside a name. Order is the group's (SKILL.md leads, the rest by
 * path), with a directory appearing where its first file does. A collapsed directory
 * contributes its row and no children.
 */
export function pluginTreeRows(
  groups: readonly FileGroup[],
  collapsed: ReadonlySet<string>,
): FileTreeRow[] {
  const roots: TreeNode[] = [];
  for (const group of groups) {
    const root: TreeNode = { path: group.id, name: group.label, kind: "dir", children: [] };
    roots.push(root);
    for (const path of group.paths) {
      const segments = path.slice(group.id.length + 1).split("/");
      let node = root;
      for (const [index, segment] of segments.entries()) {
        const childPath = `${node.path}/${segment}`;
        const leaf = index === segments.length - 1;
        let child = node.children.find((c) => c.path === childPath);
        if (child === undefined) {
          child = { path: childPath, name: segment, kind: leaf ? "file" : "dir", children: [] };
          node.children.push(child);
        }
        node = child;
      }
    }
  }

  const rows: FileTreeRow[] = [];
  const walk = (nodes: readonly TreeNode[], depth: number): void => {
    for (const [index, node] of nodes.entries()) {
      const expanded = node.kind === "dir" && !collapsed.has(node.path);
      rows.push({
        path: node.path,
        name: node.name,
        kind: node.kind,
        depth,
        posInSet: index + 1,
        setSize: nodes.length,
        expanded,
        // Nothing here is fetched per directory: the whole listing arrived in one response.
        loaded: true,
        empty: node.kind === "dir" && node.children.length === 0,
      });
      if (expanded) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

/** What the About section shows under the description. */
export type ReadmeState =
  | { kind: "loading" }
  | { kind: "text"; text: string }
  /** The package is not on this server, so there is no README here to read. */
  | { kind: "after-install" }
  | { kind: "none" };

/**
 * Whether a server module's package is on this server, where its README can be read: shipped
 * with the build, or listed here and loaded — or tried and failed, which still means installed.
 */
export function moduleOnThisServer(part: ModulePart): boolean {
  return (
    part.shipped || part.state === "active" || part.state === "pending" || part.state === "failed"
  );
}

/** Whether a row installs files into an Agent: Skills, or a hook package. */
export function rowHasFiles(row: PluginRow): boolean {
  return (row.library?.skills.length ?? 0) > 0 || (row.library?.hooks.length ?? 0) > 0;
}

/** What the header says beside the icon, besides what the dialog's title already names. */
export interface PluginDetailHead {
  status: PluginStatus;
  /** The status's hover sentence. */
  statusHint: string;
  categoryTitle: string;
  /** How many Agents use its Skills and hooks; null for a server module alone. */
  usedBy: number | null;
}

/**
 * The dialog's content under its title: the header, About (the description and the README,
 * or why there is none here), and Files — `files`, the browser — for a plugin that installs
 * any. Rendered without the Modal, so it reads the same wherever it is drawn.
 */
export function PluginDetailSections({
  row,
  head,
  readme,
  files,
  locale,
}: {
  row: PluginRow;
  head: PluginDetailHead;
  readme: ReadmeState;
  files: ReactNode;
  locale: "zh" | "en";
}) {
  const version = rowVersion(row);
  return (
    <>
      <div className="flex items-start gap-3">
        <SkillTile
          icon={rowIcon(row)}
          name={row.name}
          fallback={ICONS.puzzle}
          size={40}
          glyph={22}
        />
        <div className="min-w-0 flex-1">
          <MetaLine>
            {version !== undefined && <span className="shrink-0 font-mono">v{version}</span>}
            <StatusMark status={head.status} hint={head.statusHint} />
            {head.usedBy !== null && (
              <span className="min-w-0 truncate">{S.plugins.usedByAgents(head.usedBy)}</span>
            )}
          </MetaLine>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PluginTag>{head.categoryTitle}</PluginTag>
            {rowBuiltin(row) && (
              <PluginTag
                title={
                  row.library !== undefined ? S.plugins.libraryBuiltinHint : S.plugins.builtinHint
                }
              >
                {S.plugins.builtin}
              </PluginTag>
            )}
            {rowInstalledOnServer(row) && (
              <PluginTag title={S.plugins.installedOnServerHint}>
                {S.plugins.installedOnServer}
              </PluginTag>
            )}
            {/* The hook points the package answers at: bare point names (`stop`, `user_prompt`) — identifiers, not copy. */}
            {(row.library?.hooks ?? []).map((event) => (
              <Badge key={event} variant="outline">
                {event}
              </Badge>
            ))}
          </div>
          {row.module !== undefined && (
            <div className="mt-2 flex min-w-0 items-center gap-1 text-xs text-fg-muted">
              <span
                className="min-w-0 truncate font-mono"
                data-tooltip={S.pluginRegistry.specifierHint}
                data-tooltip-content="text"
              >
                {row.module.specifier}
              </span>
              <CopyButton
                text={row.module.specifier}
                label={S.pluginRegistry.copySpecifier}
                size="sm"
              />
            </div>
          )}
        </div>
      </div>

      <RuledSection title={S.plugins.detailDescription} level={3} className="mt-5">
        <p className="text-sm leading-relaxed">{rowDescription(row, locale)}</p>
        {readme.kind === "loading" && <Skeleton className="mt-4 h-24 w-full" />}
        {readme.kind === "text" && (
          <div className="md-body mt-4 text-sm">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
              {readme.text}
            </ReactMarkdown>
          </div>
        )}
        {readme.kind === "after-install" && (
          <p className="mt-2 text-xs text-fg-muted">{S.plugins.readmeAfterInstall}</p>
        )}
      </RuledSection>

      {files !== null && (
        <RuledSection title={S.plugins.detailFiles} level={3} className="mt-6">
          {files}
        </RuledSection>
      )}
    </>
  );
}

/**
 * Items of a metadata line, a middle dot between each, held on one line: a wrapped line would
 * strand a dot at its edge. The items are the line's flex children, so an item that may run long
 * (the agent count) brings its own `min-w-0 truncate`, and the rest keep `shrink-0`.
 */
export function MetaLine({ children }: { children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(
    (child) => child !== null && child !== undefined && child !== false,
  );
  return (
    <div className="flex min-w-0 items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-xs text-fg-muted">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span aria-hidden className="shrink-0">
              ·
            </span>
          )}
          {item}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The README the About section shows: a server module's from the registry route (read from the
 * package on this server, so one not here says so without asking), a library plugin's from the
 * library route, where a 404 means it ships none.
 */
function usePluginReadme(row: PluginRow): ReadmeState {
  const part = row.module;
  const here = part === undefined || moduleOnThisServer(part);
  const [state, setState] = useState<ReadmeState>(
    here ? { kind: "loading" } : { kind: "after-install" },
  );
  const specifier = part?.specifier;
  const name = row.library?.name;
  useEffect(() => {
    // Installing or removing from the dialog's own footer moves the package on or off this
    // server while the dialog is open.
    if (!here) {
      setState({ kind: "after-install" });
      return;
    }
    setState({ kind: "loading" });
    let cancelled = false;
    const read =
      specifier !== undefined
        ? getPluginReadme(specifier).then((res) => res.readme)
        : name !== undefined
          ? getLibraryPluginReadme(name).then(
              (res) => res.readme,
              (e: unknown) => {
                if (e instanceof ApiError && e.status === 404) return null;
                throw e;
              },
            )
          : Promise.resolve(null);
    read.then(
      (text) => {
        if (!cancelled) setState(text === null ? { kind: "none" } : { kind: "text", text });
      },
      () => {
        // A readme that cannot be read is not the dialog's failure: the description stands.
        if (!cancelled) setState({ kind: "none" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [here, specifier, name]);
  return state;
}

export function PluginDetailModal({
  row,
  head,
  footer,
  onClose,
}: {
  row: PluginRow;
  head: PluginDetailHead;
  /** The card's own actions, as footer buttons; null leaves the dialog without a footer. */
  footer: ReactNode;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const readme = usePluginReadme(row);
  return (
    <Modal
      open
      title={row.name}
      onClose={onClose}
      widthClass="sm:max-w-4xl"
      {...(footer !== null ? { footer } : {})}
    >
      <PluginDetailSections
        row={row}
        head={head}
        readme={readme}
        files={
          row.library !== undefined && rowHasFiles(row) ? (
            <PluginFiles plugin={row.library} />
          ) : null
        }
        locale={locale}
      />
    </Modal>
  );
}

/**
 * The browser over what a library plugin installs: tree left, preview right (stacked on narrow
 * screens) — the same one the Benchmark case dialog draws. SKILL.md shows its body, with the
 * frontmatter the header already states dropped.
 */
function PluginFiles({ plugin }: { plugin: PluginItem }) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Collapsed directories: every one starts open, so the whole plugin is in view at once. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  /** The directory whose subtree the tree should animate — the one just clicked. */
  const [toggled, setToggled] = useState<TreeToggle | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPluginFiles(plugin.name)
      .then((res) => {
        if (cancelled) return;
        setFiles(res.files);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [plugin.name]);

  const groups =
    files === null
      ? []
      : groupPluginFiles(
          Object.keys(files),
          plugin.skills.map((s) => s.name),
          S.plugins.detailHooks,
        );
  const rows = pluginTreeRows(groups, collapsed);
  // The first file of the first group opens on arrival (the benchmark browser's readme
  // auto-preview), so the pane is never empty while there is something to read.
  const current = selected ?? groups[0]?.paths[0] ?? null;
  const text = current !== null && files !== null ? files[current] : undefined;
  const preview = current !== null && text !== undefined ? filePreview(current, text) : null;

  const toggleDir = (dir: string): void => {
    const open = collapsed.has(dir);
    // The serial makes toggling the same directory again a new event for the tree to animate.
    setToggled((last) => ({ dir, open, serial: (last?.serial ?? 0) + 1 }));
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  return (
    <FileBrowser
      rows={rows}
      treeLabel={S.files.treeLabel}
      selectedPath={current}
      toggled={toggled}
      treeLoading={files === null}
      treeError={error}
      headerFallback={plugin.name}
      preview={preview}
      emptyPreview={error ?? S.common.none}
      emptyDirLabel={S.files.empty}
      truncatedLabel={S.files.previewTruncated}
      unsupportedLabel={S.files.previewUnsupported}
      downloadLabel={S.files.download}
      stripFrontmatter
      onToggleDir={toggleDir}
      onOpenFile={setSelected}
    />
  );
}
