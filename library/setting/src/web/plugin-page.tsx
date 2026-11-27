/**
 * A plugin's page in the Settings dialog's Plugins group (lib/plugin-pages.ts says which pages
 * exist): its pane heading — the plugin's icon, name and version — and its body, the personal
 * part (pages its web half contributes for every viewer) and, for an admin, the server part: its
 * settings groups drawn as status pages by the plugin settings page in its plugin scope
 * (plugins-section.tsx, which keeps the machine picker, the action confirm and the re-reads), then
 * its admin-only contributed pages.
 *
 * Both parts present, each is a ruled section headed by the rail's Personal and Server group names;
 * one part alone draws no heading. The settings groups are drawn whenever this server declares one
 * for the plugin or the Project has a connected machine: the machine picker is how an admin reaches
 * a group another machine declares for it, so a page that exists only through its web half (the
 * browser's) still offers it, and a page that exists only because a machine has the plugin opens
 * on that machine. Inside a part, a contributed page is titled by its own name only when the part holds
 * more than one thing; a lone page's explanation then rides on the part's heading. A request that
 * named a part of the page (an old key of a contributed page, a settings group) scrolls it into
 * view once, when it is there.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { SettingsSectionCode } from "@prismshadow/penguin-web-plugin";
import { GlyphIcon, ICON_GAP, ICON_SIZE, ICONS, Pill, RuledSection } from "@prismshadow/penguin-ui";
import { S, glyphOf, useSessionsIfAny, SkillIcon } from "@prismshadow/penguin-web/internal";
import type { PluginPage, PluginSectionRef } from "./lib/plugin-pages";
import { PluginsSection } from "./plugins-section";
import { useSettingsNavigation } from "./settings-navigation";

type Page = PluginPage<SettingsSectionCode>;

/**
 * The page's mark: the library's icon, else the one its settings group carries (a plugin the
 * library does not list), else its first contributed page's glyph, else the puzzle.
 */
export function PluginPageIcon({ page, size }: { page: Page; size: number }) {
  const icon = page.library?.icon ?? page.icon;
  const glyph = glyphOf(page.glyph);
  if (icon === undefined && glyph !== "") return <GlyphIcon d={glyph} size={size} />;
  return <SkillIcon icon={icon} fallback={ICONS.puzzle} size={size} />;
}

/** The pane heading: the icon before the name, the plugin's version after it. */
export function PluginPageHeading({ page }: { page: Page }) {
  const version = page.library?.version ?? page.version;
  return (
    <span className={`flex min-w-0 items-center ${ICON_GAP.menu}`}>
      <span className="inline-flex shrink-0 text-fg-muted">
        <PluginPageIcon page={page} size={ICON_SIZE.groupHeaderAvatar} />
      </span>
      <span className="min-w-0 truncate">{page.title}</span>
      {version !== undefined && version !== "" && (
        <span className="shrink-0 text-sm font-normal">
          <Pill>{`v${version}`}</Pill>
        </span>
      )}
    </span>
  );
}

/** Scrolls the part a request named into view, once it is on the page. */
function useAnchor(anchor: string | undefined) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (anchor === undefined || done.current) return;
    const find = () =>
      root.current?.querySelector(
        `[data-settings-anchor="${CSS.escape(anchor)}"], [data-plugin-config="${CSS.escape(anchor)}"]`,
      );
    const scroll = () => {
      const target = find();
      if (target === null || target === undefined) return false;
      target.scrollIntoView({ block: "start" });
      done.current = true;
      return true;
    };
    if (scroll()) return;
    // A settings group arrives with its machine's answer: watch for it.
    const observer = new MutationObserver(() => {
      if (scroll()) observer.disconnect();
    });
    if (root.current !== null) observer.observe(root.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [anchor]);
  return root;
}

/** One contributed page inside a part, titled only when the part holds more than one thing. */
function ContributedPart({
  section,
  titled,
}: {
  section: PluginSectionRef<SettingsSectionCode>;
  titled: boolean;
}) {
  const { Body } = section.code;
  // Its links to other pages go the dialog's way, through the leave guard.
  const navigation = useSettingsNavigation();
  const openPage = (key: string) => navigation?.open(key);
  return (
    <div data-settings-anchor={section.data.key}>
      {titled ? (
        <RuledSection title={section.code.label()} info={section.code.info?.()} level={3}>
          <Body openPage={openPage} />
        </RuledSection>
      ) : (
        <Body openPage={openPage} />
      )}
    </div>
  );
}

/** A part of the page: under its heading when the page has both, bare when it has one. */
function Part({
  title,
  info,
  headed,
  children,
}: {
  title: string;
  info: ReactNode | undefined;
  headed: boolean;
  children: ReactNode;
}) {
  if (!headed) return <div className="space-y-6">{children}</div>;
  return (
    <RuledSection title={title} info={info} level={3}>
      <div className="space-y-6">{children}</div>
    </RuledSection>
  );
}

export function PluginPageBody({
  page,
  isAdmin,
  anchor,
}: {
  page: Page;
  isAdmin: boolean;
  /** A part of the page to scroll to: a contributed page's key, or a settings group's name. */
  anchor?: string;
}) {
  const root = useAnchor(anchor);
  const machines = (useSessionsIfAny()?.machineIds.length ?? 0) > 0;
  const groups = isAdmin && (page.groups.length > 0 || machines);
  const server = isAdmin ? page.server : [];
  const hasServer = groups || server.length > 0;
  const hasPersonal = page.personal.length > 0;
  const headed = hasServer && hasPersonal;
  const personalTitled = page.personal.length > 1;
  const serverTitled = (groups ? 1 : 0) + server.length > 1;
  const loneInfo = (
    sections: ReadonlyArray<PluginSectionRef<SettingsSectionCode>>,
    titled: boolean,
  ) => (!titled && sections.length === 1 ? sections[0]!.code.info?.() : undefined);
  return (
    <div ref={root} className="space-y-6">
      {hasPersonal && (
        <Part
          title={S.settings.groupPersonal}
          info={loneInfo(page.personal, personalTitled)}
          headed={headed}
        >
          {page.personal.map((section) => (
            <ContributedPart key={section.data.key} section={section} titled={personalTitled} />
          ))}
        </Part>
      )}
      {hasServer && (
        <Part
          title={S.settings.groupServer}
          info={groups ? undefined : loneInfo(server, serverTitled)}
          headed={headed}
        >
          {groups && <PluginsSection plugin={page.package} machine={page.machine ?? null} />}
          {server.map((section) => (
            <ContributedPart key={section.data.key} section={section} titled={serverTitled} />
          ))}
        </Part>
      )}
    </div>
  );
}
