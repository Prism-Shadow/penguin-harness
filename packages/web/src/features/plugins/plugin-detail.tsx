/**
 * Plugin detail Modal — opened by clicking a library card (the model library's card-detail
 * pattern): the plugin's icon, full description, metadata line and hook points, then the
 * shared read-only file browser over everything the plugin ships — one directory per skill
 * and one for the hook package, any number open at once, and a preview on the right. The
 * header and the tree never leave: opening a file fills the preview pane instead of replacing
 * the view, so the summary and the other files stay in sight while reading. The files arrive
 * in one request (GET /api/plugins/:plugin/files) when the Modal opens, so the whole tree is
 * on hand at once and nothing here is fetched per directory.
 */
import { useEffect, useState } from "react";
import { ICONS } from "@prismshadow/penguin-ui";
import { Modal } from "../../components/ui/modal";
import { Badge } from "../../components/ui/badge";
import { FileBrowser } from "../../components/ui/file-browser";
import type { FileBrowserPreview } from "../../components/ui/file-browser";
import type { TreeToggle } from "../../components/ui/file-tree";
import type { FileTreeRow } from "../../lib/file-tree";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { baseName } from "../../lib/workspace-tree";
import { useLocale } from "../../state/locale";
import { getPluginFiles } from "../../api/endpoints";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { SkillTile } from "../skills/skill-icon-view";
import { localizedText } from "../chat/skill-use";

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
    <Modal open title={plugin.name} onClose={onClose} widthClass="sm:max-w-4xl">
      {/* Header: icon tile + full description + the card's metadata line + hook points. */}
      <div className="flex items-start gap-3">
        <SkillTile
          icon={plugin.icon}
          name={plugin.name}
          fallback={ICONS.puzzle}
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

      {/* The browser: tree left, preview right (stacked on narrow screens) — the same one the
          Benchmark case dialog draws. SKILL.md shows its body, with the frontmatter the card
          above already states dropped. */}
      <FileBrowser
        className="mt-4"
        rows={rows}
        treeLabel={S.files.treeLabel}
        selectedPath={current}
        toggled={toggled}
        treeLoading={files === null}
        treeError={error}
        headerFallback={plugin.name}
        preview={preview}
        emptyPreview={error ?? S.common.none}
        stripFrontmatter
        onToggleDir={toggleDir}
        onOpenFile={setSelected}
      />
    </Modal>
  );
}
