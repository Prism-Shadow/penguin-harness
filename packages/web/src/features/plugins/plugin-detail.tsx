/**
 * Plugin detail Modal — opened by clicking a library card (the model library's card-detail
 * pattern): the plugin's icon, full description, metadata line and hook points, then a file
 * browser over everything it ships, in the benchmark case browser's shape — a tree on the left
 * (one collapsible group per skill and one for the hook package, any number open at once) and
 * a preview on the right. The header and the tree never leave: opening a file fills the
 * preview pane instead of replacing the view, so the summary and the other files stay in sight
 * while reading. The files arrive in one request (GET /api/plugins/:plugin/files) when the
 * Modal opens; a markdown file renders through the chat markdown component with its
 * frontmatter stripped, anything else as a code block.
 */
import { useEffect, useState } from "react";
import { Modal } from "../../components/ui/modal";
import { Badge } from "../../components/ui/badge";
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
  /** Collapsed groups: every group starts open, so the whole plugin is in view at once. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

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
  // The first file of the first group opens on arrival (the benchmark browser's readme
  // auto-preview), so the pane is never empty while there is something to read.
  const current = selected ?? groups[0]?.paths[0] ?? null;
  const text = current !== null && files !== null ? files[current] : undefined;

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
            {groups.map((group) => {
              const open = !collapsed.has(group.id);
              return (
                <div
                  key={group.id}
                  className="border-b border-gray-200 last:border-b-0 dark:border-gray-800"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800/60"
                  >
                    <span className="text-xs text-gray-400">{open ? "▾" : "▸"}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">
                      {group.label}
                    </span>
                  </button>
                  {open &&
                    group.paths.map((path) => {
                      const active = path === current;
                      return (
                        <button
                          key={path}
                          type="button"
                          aria-current={active ? "true" : undefined}
                          onClick={() => setSelected(path)}
                          className={`flex w-full items-center gap-2 border-t border-gray-100 px-6 py-1.5 text-left text-xs hover:bg-gray-100 dark:border-gray-800/70 dark:hover:bg-gray-800/60 ${
                            active
                              ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800/60 dark:text-gray-100"
                              : "text-gray-600 dark:text-gray-400"
                          }`}
                        >
                          <span className="text-gray-400">·</span>
                          {/* The path inside its group: SKILL.md, reference/x.md, stop.mjs. */}
                          <span className="min-w-0 flex-1 truncate">
                            {path.slice(group.id.length + 1)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
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
