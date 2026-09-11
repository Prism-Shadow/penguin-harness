/**
 * Plugin detail Modal — opened by clicking a library card (the model library's card-detail
 * pattern): the plugin's icon, full description, metadata line and hook points, then a file
 * browser over everything it ships — the shared `FileTree` on the left (one directory per
 * skill and one for the hook package, any number open at once) and a preview on the right.
 * The header and the tree never leave: opening a file fills the preview pane instead of
 * replacing the view, so the summary and the other files stay in sight while reading. The
 * files arrive in one request (GET /api/plugins/:plugin/files) when the Modal opens; a
 * markdown file renders through the chat markdown component with its frontmatter stripped,
 * anything else as a code block.
 */
import { useEffect, useState } from "react";
import { Modal } from "../../components/ui/modal";
import { Badge } from "../../components/ui/badge";
import { FileTree } from "../../components/ui/file-tree";
import type { TreeToggle } from "../../components/ui/file-tree";
import type { FileTreeRow } from "../../lib/file-tree";
import { PLUGIN_ICON } from "../../components/ui/icons";
import { SkeletonList } from "../../components/ui/skeleton";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useLocale } from "../../state/locale";
import { getPluginFiles } from "../../api/endpoints";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { CodeBlock } from "../chat/code-block";
import { Md } from "../chat/md";
import { SkillTile } from "../skills/skill-icon-view";
import { localizedText } from "../chat/skill-use";

/** One collapsible group of the tree: a skill's directory, or the hook package's scripts. */
interface FileGroup {
  id: string;
  label: string;
  /** Paths (the response's keys), SKILL.md first, the rest in name order. */
  paths: string[];
}

/** SKILL.md carries its frontmatter; the reader shows the body only. */
function stripFrontmatter(content: string): string {
  return content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/** Highlighter language for a non-markdown file, by extension; plain text for the rest. */
function languageFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      sh: "shellscript",
      py: "python",
      html: "html",
      css: "css",
      svg: "xml",
      xml: "xml",
    }[ext] ?? "text"
  );
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

export function PluginDetailModal({
  plugin,
  meta,
  onClose,
}: {
  plugin: PluginItem;
  /** The card's metadata line (version · updated · used by N agents), repeated under the title. */
  meta: string;
  onClose: () => void;
}) {
  const { locale } = useLocale();
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
    <Modal open title={plugin.name} onClose={onClose} widthClass="sm:max-w-4xl">
      {/* Header: icon tile + full description + the card's metadata line + hook points. */}
      <div className="flex items-start gap-3">
        <SkillTile
          icon={plugin.icon}
          name={plugin.name}
          fallback={PLUGIN_ICON}
          size={40}
          glyph={22}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {localizedText(locale, plugin.description, plugin.descriptionZh)}
          </p>
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">{meta}</p>
          {/* The hook points the package answers at: bare point names (`stop`, `user_prompt`) — identifiers, not copy. */}
          {plugin.hooks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plugin.hooks.map((event) => (
                <Badge key={event}>{event}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The browser: tree left, preview right (stacked on narrow screens). Both panes scroll on
          their own inside fixed heights, so the header above stays put. */}
      <div className="mt-4 grid grid-cols-1 overflow-hidden rounded-md border border-gray-200 md:grid-cols-[220px_minmax(0,1fr)] dark:border-gray-800">
        <aside className="border-b border-gray-200 bg-gray-50/60 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-950/30">
          <div className="max-h-40 overflow-y-auto md:max-h-[50vh]">
            {error && <p className="px-3 py-2 text-xs text-red-500">{error}</p>}
            {files === null && !error && <SkeletonList rows={3} />}
            <FileTree
              rows={rows}
              label={S.files.treeLabel}
              selectedPath={current}
              toggled={toggled}
              onToggleDir={toggleDir}
              onOpenFile={setSelected}
            />
          </div>
        </aside>

        <section className="min-w-0">
          <div className="flex min-h-9 items-center border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
            <p className="truncate font-mono text-xs text-gray-500">{current ?? plugin.name}</p>
          </div>
          <div className="max-h-[50vh] min-h-[50vh] overflow-auto p-3">
            {files === null && !error ? (
              <SkeletonList rows={8} />
            ) : current === null || text === undefined ? (
              <p className="text-sm text-gray-400">{error ?? S.common.none}</p>
            ) : current.endsWith(".md") ? (
              <div className="md-body text-sm text-gray-800 dark:text-gray-100">
                <Md text={stripFrontmatter(text)} />
              </div>
            ) : (
              <CodeBlock language={languageFor(current)} code={text} />
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
