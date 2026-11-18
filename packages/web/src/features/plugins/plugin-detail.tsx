/**
 * A plugin's detail — every plugin's, opened from its card (the model library's card-detail
 * pattern): a product page in a large layer over the market, not a page of its own. One
 * scroller holds all of it, the close cross stays at the layer's top-right corner, and the
 * caller's secondary actions stay in a footer bar under the scroller.
 *
 * - **The hero** (the UI package's `ProductHero`): the cover at its full rendition (the
 *   curation's picture, else the generated one — plugin-cover.tsx), the icon tile, "Selected"
 *   over the name when the curation selects it, the name (the package's display name, else the
 *   plugin's name) with the package beneath a display name, the one line, the tags the card
 *   shows (category, "built in", where it runs, its hook points), the caller's main actions
 *   (`actions`) and a facts line: version, the caller's status mark, used by.
 * - **Screenshots**, when the curation has any: one row that scrolls sideways; a shot opens in
 *   the lightbox.
 * - Beside a column of the package's facts (version, category, author, licence, package name
 *   with a copy button, homepage and repository — only what the package carries), in order:
 *   **About** (the full description, then the package's README.md where it ships one, in the
 *   Markdown reader with its outline and find in the section's title row; read from the package
 *   on this server, never from npm, so a package this server does not have says so instead);
 *   whatever section the caller adds of its own (`afterAbout`: an Agent's settings say what of
 *   the plugin is on that Agent); **What it installs** (one row per Skill, hook point, MCP server
 *   and workbench — a workbench installed on an Agent of this server opens in the App Center);
 *   **Quick start** (the prompt in the UI language, the Skills it pre-selects, and its button);
 *   the **MCP servers** (plugin-mcp.tsx), for a plugin that carries any.
 * - **Files**, full width under the columns, for a plugin of Skills, hooks or workbenches: the
 *   shared read-only file browser over everything an install writes (GET
 *   /api/plugins/:plugin/files, one request), a preview beside the tree.
 *
 * The README and the files are read from the server the caller names (`machineId`): an Agent on
 * a machine reads its plugin from that machine's library. The status mark is the caller's (the
 * Plugins page's status, or an Agent's own): the detail only places it.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  CloseButton,
  CopyButton,
  FileBrowser,
  GlyphAction,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Lightbox,
  MarkdownReader,
  MetaLine,
  Modal,
  Notice,
  ProductColumns,
  ProductFacts,
  ProductGallery,
  ProductHero,
  ProductParts,
  ProductPrompt,
  ProductSection,
  ReaderFindBar,
  ReaderTools,
  Skeleton,
  useMarkdownReader,
  type FileBrowserPreview,
  type FileTreeRow,
  type MarkdownReaderState,
  type ProductPart,
  type ProductShot,
  type TreeToggle,
} from "@prismshadow/penguin-ui";
import type { PluginArt, PluginItem, QuickStartItem } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { linkSegments } from "../../lib/link-segments";
import { apiErrorText } from "../../lib/api-error";
import { baseName } from "../../lib/workspace-tree";
import { useReaderFind } from "../../lib/reader-find";
import { BOOK_ICON, localizedText } from "../../lib/skill-use";
import { useLocale } from "../../state/locale";
import { getLibraryPluginReadme, getPluginFiles, getPluginReadme } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { SkillTile } from "../skills";
import { PluginCover } from "./plugin-cover";
import { PluginMcpSection } from "./plugin-mcp";
import type { ModulePart, PluginRow } from "./plugin-groups";
import {
  pluginTags,
  rowDetails,
  rowDescription,
  rowHasDescription,
  rowLinked,
  rowNote,
  rowShortDescription,
  rowTitle,
  rowVersion,
} from "./plugin-marks";
import { marketIcon, rowPackage } from "./plugin-market";

/** One collapsible group of installable files. */
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
 * the plugin's skill order), then hooks and workbenches. SKILL.md leads a Skill group;
 * a workbench's package.json leads its source files.
 */
export function groupPluginFiles(
  paths: readonly string[],
  skillOrder: readonly string[],
  hooksLabel: string,
): FileGroup[] {
  const bySkill = new Map<string, string[]>();
  const byWorkbench = new Map<string, string[]>();
  const hooks: string[] = [];
  for (const path of [...paths].sort()) {
    const skill = /^skills\/([^/]+)\//.exec(path)?.[1];
    if (skill !== undefined) {
      const list = bySkill.get(skill) ?? [];
      list.push(path);
      bySkill.set(skill, list);
    } else if (path.startsWith("hooks/")) {
      hooks.push(path);
    } else {
      const workbench = /^workbenches\/([^/]+)\//.exec(path)?.[1];
      if (workbench !== undefined) {
        const list = byWorkbench.get(workbench) ?? [];
        list.push(path);
        byWorkbench.set(workbench, list);
      }
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
  for (const [name, paths] of byWorkbench) {
    const id = `workbenches/${name}`;
    const manifest = `${id}/package.json`;
    groups.push({
      id,
      label: id,
      paths: paths.includes(manifest) ? [manifest, ...paths.filter((p) => p !== manifest)] : paths,
    });
  }
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
    part.shipped ||
    part.state === "active" ||
    part.state === "pending" ||
    part.state === "failed" ||
    part.state === "disabled"
  );
}

/** Whether a row installs files into an Agent: Skills, or a hook package. */
export function rowHasFiles(row: PluginRow): boolean {
  return (
    (row.library?.skills.length ?? 0) > 0 ||
    (row.library?.hooks.length ?? 0) > 0 ||
    (row.library?.workbenches?.length ?? 0) > 0
  );
}

/** What the header says beside the icon, besides what the dialog's title already names. */
export interface PluginDetailHead {
  /** The status mark, drawn by the caller (PluginStatusMark on the market, the Agent's own on its settings page). */
  status: ReactNode;
  categoryTitle: string;
  /** How many Agents use its Skills and hooks; null for a server module alone. */
  usedBy: number | null;
}

/** The detail's quick start: the demo, and its button's press. */
export interface PluginDetailQuickStart {
  item: QuickStartItem;
  onStart: () => void;
  /** There is no current Agent to open the draft on. */
  disabled: boolean;
}

/** What the detail shows besides the row: the market's art and what the caller lets it do. */
export interface PluginDetailExtras {
  /** The curation's art for the plugin's package: its cover and screenshots. */
  art?: PluginArt | null;
  /** The curation selects the plugin. */
  selected?: boolean;
  /** The plugin's main actions, primary first: the hero's buttons. */
  actions?: ReactNode;
  /** The quick start section's demo; absent, no section. */
  quickStart?: PluginDetailQuickStart | null;
  /** The workbenches that open here (installed on an Agent of this server), by name. */
  openWorkbench?: ReadonlyMap<string, () => void>;
}

/**
 * The detail's content: the hero, the screenshots, the columns of sections beside the facts,
 * and Files — `files`, the browser — for a plugin that installs any. Rendered without the
 * Modal, so it reads the same wherever it is drawn.
 */
export function PluginDetailSections({
  row,
  head,
  readme,
  files,
  locale,
  afterAbout,
  art,
  selected = false,
  actions,
  quickStart,
  openWorkbench,
}: {
  row: PluginRow;
  head: PluginDetailHead;
  readme: ReadmeState;
  files: ReactNode;
  locale: "zh" | "en";
  /** A section of the caller's own, between About and what the package ships. */
  afterAbout?: ReactNode;
} & PluginDetailExtras) {
  const version = rowVersion(row);
  const title = rowTitle(row, locale);
  // The README's reader: its outline and find buttons sit in the section's title row.
  const readmeReader = useMarkdownReader(useReaderFind());
  const [shotOpen, setShotOpen] = useState<number | null>(null);
  const packageName = rowPackage(row);
  const shots: ProductShot[] = (art?.screenshots ?? []).map((shot) => {
    const caption = localizedText(locale, shot.caption ?? "", shot.captionZh);
    return {
      src: shot.url,
      ...(shot.thumbUrl !== undefined ? { thumb: shot.thumbUrl } : {}),
      alt: caption || title,
      ...(caption !== "" ? { caption } : {}),
    };
  });
  const open = shotOpen === null ? undefined : shots[shotOpen];
  const tags = [
    ...pluginTags(row, { categoryTitle: head.categoryTitle }),
    // The hook points the package answers at: bare point names (`stop`, `user_prompt`) — identifiers, not copy.
    ...(row.library?.hooks ?? []).map((event) => (
      <Badge key={`hook:${event}`} variant="outline">
        {event}
      </Badge>
    )),
  ];
  const parts = includedParts(row, locale, openWorkbench);
  const demo = quickStart ?? null;
  const note = rowNote(row);
  return (
    <>
      <ProductHero
        level={2}
        cover={<PluginCover row={row} art={art ?? null} rendition="full" eager />}
        lead={
          <SkillTile
            icon={marketIcon(row, art ?? null)}
            name={row.name}
            fallback={ICONS.puzzle}
            size={44}
            glyph={24}
          />
        }
        {...(selected ? { eyebrow: S.plugins.selected } : {})}
        title={title}
        {...(packageName !== undefined && title !== row.name ? { subtitleCode: packageName } : {})}
        tagline={rowShortDescription(row, locale)}
        tags={tags}
        {...(actions !== undefined ? { actions } : {})}
        facts={
          <MetaLine>
            {version !== undefined && <span className="shrink-0 font-mono">v{version}</span>}
            {head.status}
            {head.usedBy !== null && (
              <span className="min-w-0 truncate">{S.plugins.usedByAgents(head.usedBy)}</span>
            )}
          </MetaLine>
        }
      />

      {/* What this build cannot run of a server module: the row card's note, said once here. */}
      {note !== undefined && (
        <Notice tone="attention" className="mt-6">
          {note}
        </Notice>
      )}

      {shots.length > 0 && (
        <ProductSection title={S.plugins.detailScreenshots}>
          <ProductGallery
            shots={shots}
            label={S.plugins.detailScreenshots}
            onOpen={(index) => setShotOpen(index)}
          />
        </ProductSection>
      )}
      {open !== undefined && (
        <Lightbox open src={open.src} alt={open.alt} onClose={() => setShotOpen(null)} />
      )}

      <div className="mt-8">
        <ProductColumns aside={<PackageFacts row={row} head={head} />}>
          <ProductSection
            title={S.plugins.detailDescription}
            actions={
              readme.kind === "text" ? (
                <>
                  <ReaderFindBar reader={readmeReader} className="w-56 max-w-[50vw]" />
                  <ReaderTools reader={readmeReader} />
                </>
              ) : undefined
            }
          >
            <p
              className={`text-sm leading-relaxed ${rowHasDescription(row, locale) ? "" : "text-fg-muted"}`}
            >
              <LinkedText text={rowDescription(row, locale)} />
            </p>
            {readme.kind === "loading" && <Skeleton className="mt-4 h-24 w-full" />}
            {readme.kind === "text" && <ReadmeReader text={readme.text} reader={readmeReader} />}
            {readme.kind === "after-install" && (
              <p className="mt-2 text-xs text-fg-muted">{S.plugins.readmeAfterInstall}</p>
            )}
          </ProductSection>

          {afterAbout}

          {parts.length > 0 && (
            <ProductSection title={S.plugins.detailIncludes}>
              <ProductParts parts={parts} />
            </ProductSection>
          )}

          {demo !== null && (
            <ProductSection title={S.plugins.detailQuickStart}>
              <ProductPrompt
                prompt={localizedText(locale, demo.item.prompt, demo.item.promptZh)}
                {...(demo.item.skills !== undefined && demo.item.skills.length > 0
                  ? {
                      note: S.plugins.quickStartSkills(demo.item.skills.join(S.todo.listSeparator)),
                    }
                  : {})}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={demo.disabled}
                    onClick={demo.onStart}
                  >
                    <GlyphIcon d={ICONS.paperPlane} />
                    {S.skills.quickInvoke}
                  </Button>
                }
              />
            </ProductSection>
          )}

          {row.library !== undefined && row.library.mcpServers.length > 0 && (
            <PluginMcpSection servers={row.library.mcpServers} />
          )}
        </ProductColumns>
      </div>

      {files !== null && <ProductSection title={S.plugins.detailFiles}>{files}</ProductSection>}
    </>
  );
}

/**
 * What a row installs, one part each: its Skills (with their own descriptions), the hook points
 * its hook package answers at, its MCP servers (with their transport) and its workbenches — a
 * workbench that opens here with its Open button.
 */
function includedParts(
  row: PluginRow,
  locale: "zh" | "en",
  openWorkbench: ReadonlyMap<string, () => void> | undefined,
): ProductPart[] {
  const plugin = row.library;
  if (plugin === undefined) return [];
  const mark = (glyph: string) => <GlyphIcon d={glyph} size={ICON_SIZE.sectionMark} />;
  const parts: ProductPart[] = [];
  for (const skill of plugin.skills) {
    const description =
      locale === "zh"
        ? skill.shortDescriptionZh || skill.shortDescription || skill.description
        : skill.shortDescription || skill.description;
    parts.push({
      key: `skill:${skill.name}`,
      mark: mark(BOOK_ICON),
      name: skill.name,
      kind: S.plugins.partKind.skill,
      ...(description !== "" ? { description } : {}),
    });
  }
  for (const event of plugin.hooks) {
    parts.push({
      key: `hook:${event}`,
      mark: mark(ICONS.fishHook),
      name: event,
      kind: S.plugins.partKind.hook,
    });
  }
  for (const server of plugin.mcpServers) {
    parts.push({
      key: `mcp:${server.name}`,
      mark: mark(ICONS.plug),
      name: server.name,
      kind: S.plugins.partKind.mcp,
      description: server.transport,
    });
  }
  for (const workbench of plugin.workbenches ?? []) {
    const openIt = openWorkbench?.get(workbench.name);
    parts.push({
      key: `workbench:${workbench.name}`,
      mark: mark(ICONS.anvil),
      name: workbench.name,
      kind: S.plugins.partKind.workbench,
      ...(openIt !== undefined
        ? {
            action: (
              <Button
                size="sm"
                variant="secondary"
                title={S.plugins.openAppHint}
                data-tooltip-extra
                onClick={openIt}
              >
                <GlyphIcon d={ICONS.appWindow} />
                {S.plugins.openApp}
              </Button>
            ),
          }
        : {}),
    });
  }
  return parts;
}

/**
 * The column of facts beside the sections: what the package says of itself — only what it
 * carries. The package name copies; the homepage and repository are flat glyph links opening
 * in a new tab that keeps no handle on this one.
 */
function PackageFacts({ row, head }: { row: PluginRow; head: PluginDetailHead }) {
  const version = rowVersion(row);
  const { author, license, homepage, repository } = rowDetails(row);
  const packageName = rowPackage(row);
  const linked = rowLinked(row);
  const facts: { label: string; value: ReactNode }[] = [];
  if (version !== undefined) {
    facts.push({
      label: S.plugins.fact.version,
      value: <span className="font-mono">{version}</span>,
    });
  }
  facts.push({ label: S.plugins.fact.category, value: head.categoryTitle });
  if (author !== undefined) facts.push({ label: S.plugins.fact.author, value: author });
  if (license !== undefined) facts.push({ label: S.plugins.fact.license, value: license });
  if (packageName !== undefined) {
    facts.push({
      label: S.plugins.fact.package,
      value: (
        <span className="inline-flex min-w-0 items-center justify-end gap-1">
          {/* A long name breaks after its scope (a browser sees no break after a slash), and
              inside a word only when nothing else fits. */}
          <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
            {packageName.split("/").map((part, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <>
                    /<wbr />
                  </>
                )}
                {part}
              </Fragment>
            ))}
          </span>
          <CopyButton
            text={packageName}
            label={S.pluginRegistry.copySpecifier}
            size="sm"
            className="shrink-0"
          />
        </span>
      ),
    });
  }
  if (linked !== null) {
    facts.push({
      label: S.plugins.linkedDirectory,
      value: <span className="break-all font-mono text-xs">{linked.linkPath}</span>,
    });
  }
  if (homepage !== undefined || repository !== undefined) {
    facts.push({
      label: S.plugins.fact.links,
      value: (
        <span className="inline-flex items-center gap-1">
          {homepage !== undefined && (
            <GlyphAction href={homepage} glyph={ICONS.globe} label={S.plugins.detailHomepage} />
          )}
          {repository !== undefined && (
            <GlyphAction
              href={repository}
              glyph={ICONS.gitBranch}
              label={S.plugins.detailRepository}
            />
          )}
        </span>
      ),
    });
  }
  return <ProductFacts facts={facts} />;
}

/**
 * The README in the Markdown reader: its own scroll box, capped so the sections under it stay in
 * reach. Its outline and find (on the user's `find.open` binding) are drawn by the section's
 * title row from the same `reader`.
 */
function ReadmeReader({ text, reader }: { text: string; reader: MarkdownReaderState }) {
  return (
    <MarkdownReader
      reader={reader}
      text={text}
      className="mt-4 max-h-[60vh] overflow-hidden rounded-md border border-line"
    />
  );
}

/**
 * A description as the package wrote it, with each web address in it a link that opens in a new
 * tab — an algorithm toolkit names its paper that way. The rest stays plain text: a description
 * is not Markdown.
 */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkSegments(text).map((segment, i) =>
        segment.kind === "text" ? (
          <Fragment key={i}>{segment.text}</Fragment>
        ) : (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-link underline-offset-2 transition-colors duration-150 hover:text-link-hover hover:underline"
          >
            {segment.href}
          </a>
        ),
      )}
    </>
  );
}

/**
 * The README the About section shows: a server module's from the registry route (read from the
 * package on this server, so one not here says so without asking), a library plugin's from the
 * library route of the server `machineId` names (null: this one), where a 404 means it ships none.
 */
function usePluginReadme(row: PluginRow, machineId: string | null): ReadmeState {
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
        ? getPluginReadme(specifier, machineId).then((res) => res.readme)
        : name !== undefined
          ? getLibraryPluginReadme(name, machineId).then(
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
  }, [here, specifier, name, machineId]);
  return state;
}

export function PluginDetailModal({
  row,
  head,
  footer,
  onClose,
  machineId = null,
  afterAbout,
  ...extras
}: {
  row: PluginRow;
  head: PluginDetailHead;
  /** The secondary actions (export, delete), in the footer bar; null leaves the layer without one. */
  footer: ReactNode;
  onClose: () => void;
  /** The server whose library the README and the files are read from; null (default) for this server. */
  machineId?: string | null;
  /** A section of the caller's own, between About and what the package ships. */
  afterAbout?: ReactNode;
} & PluginDetailExtras) {
  const { locale } = useLocale();
  const readme = usePluginReadme(row, machineId);
  return (
    <Modal
      open
      title={rowTitle(row, locale)}
      onClose={onClose}
      bare
      headerless
      fullScreenOnPhone
      widthClass="sm:max-w-5xl sm:h-[min(54rem,calc(100dvh-4rem))]"
      {...(footer !== null ? { footer } : {})}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* At the layer's corner, over the scroller, on its own fill so it reads over a cover;
            first in the layer, so opening it hands focus here rather than to an action. */}
        <CloseButton onClose={onClose} className="absolute right-2 top-2 z-raised bg-surface" />
        {/* On a phone the cover leads, so the scroller starts below the cross. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-12 sm:px-8 sm:pt-8">
          <PluginDetailSections
            row={row}
            head={head}
            readme={readme}
            files={
              row.library !== undefined && rowHasFiles(row) ? (
                <PluginFiles plugin={row.library} machineId={machineId} />
              ) : null
            }
            locale={locale}
            afterAbout={afterAbout}
            {...extras}
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * The browser over what a library plugin installs, read from the library of the server
 * `machineId` names: tree left, preview right (stacked on narrow screens) — the same one the
 * Benchmark case dialog draws. SKILL.md shows its body, with the frontmatter the header already
 * states dropped.
 */
function PluginFiles({ plugin, machineId }: { plugin: PluginItem; machineId: string | null }) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Collapsed directories: every one starts open, so the whole plugin is in view at once. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  /** The directory whose subtree the tree should animate — the one just clicked. */
  const [toggled, setToggled] = useState<TreeToggle | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPluginFiles(plugin.name, machineId)
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
  }, [plugin.name, machineId]);

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

  const readerFind = useReaderFind();

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
      isFindKey={readerFind.isFindKey}
      findShortcut={readerFind.findShortcut}
      onToggleDir={toggleDir}
      onOpenFile={setSelected}
    />
  );
}
