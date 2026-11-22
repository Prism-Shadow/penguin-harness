/**
 * One settings group on its plugin's page, drawn as a status page (the card's form, switches and
 * Save stay plugin-config-card.tsx's; this is only how they are laid out there):
 *
 * 1. the status strip — the version element of the program the plugin runs beside itself, the
 *    summary pill, and the plugin's primary actions (every action the report does not place);
 * 2. the checks — every precondition in one ruled list, the one "check again" at its heading's
 *    other end (when the report has checks; otherwise it is one of the primary actions), a row's
 *    own action on its row and, where it names another page of the dialog (a sandbox backend's
 *    plugin page), a link to it, details folded under it;
 * 3. the group's notices, as the card draws them, for a plugin that has not moved to the report;
 * 4. the options: the switches and fields, those the group marks `security` under their own
 *    heading with a shield, the `advanced` ones in their fold; then what the card puts last
 *    (nested groups, Reset and Save).
 *
 * While the group's switch is off (as drafted) the page draws the switch alone: the status, the
 * checks and the notices concern the group in use. Every word a plugin sends comes in both
 * languages and is shown in the interface's; an action's description is its button's hint. A
 * state this page has no word for (a newer plugin's, read through an older server) shows the
 * plugin's own value and draws as not known. Whether an action asks before it runs is the
 * settings page's decision (plugins-section.tsx), not this layout's.
 */
import type { ReactNode } from "react";
import type {
  PluginConfigEntry,
  PluginConfigField,
  PluginStatusReport,
  PluginStatusSummary,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Checklist,
  ChecklistRow,
  GlyphIcon,
  ICON_GAP,
  ICON_SIZE,
  ICONS,
  InstalledVersion,
  Pill,
  RuledSection,
  StatusStrip,
  type ToneName,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { localizedText } from "../../lib/skill-use";
import type { Locale } from "../../state/locale";
import { AdvancedFold } from "./advanced-fold";
import { ConfigNotices } from "./plugin-config-heading";
import { useSettingsNavigation } from "./settings-navigation";

/**
 * The summary pill's tone: what the state means. Work under way is the app's busy tone (the
 * spinner's beside it), which resolves to the same ink as ready on purpose; the words part them.
 */
const SUMMARY_TONE: Readonly<Record<PluginStatusSummary["state"], ToneName>> = {
  ready: "success",
  attention: "attention",
  progress: "success",
  off: "neutral",
  unknown: "neutral",
};

/** A state's word from `words`, else the state as sent (a value this build has no word for). */
const wordFor = (words: Readonly<Record<string, string>>, state: string): string =>
  Object.hasOwn(words, state) ? words[state]! : state;

/**
 * The actions a report places on its own elements; the rest are the page's primary actions. The
 * "check again" is placed only where it is drawn: at the checks' heading, so with no checks it
 * stays a primary action.
 */
export function placedActions(report: PluginStatusReport | undefined): Set<string> {
  const placed = new Set<string>();
  if (report === undefined) return placed;
  const checks = report.checks ?? [];
  if (report.version?.action !== undefined) placed.add(report.version.action);
  if (report.recheck !== undefined && checks.length > 0) placed.add(report.recheck);
  for (const check of checks) if (check.action !== undefined) placed.add(check.action);
  return placed;
}

export function PluginGroupPage({
  entry,
  live,
  titled,
  drawn,
  control,
  disabled,
  onAction,
  locale,
  after,
}: {
  entry: PluginConfigEntry;
  /** The group is in use: its switch, as drafted, is on (or it has none). */
  live: boolean;
  /** The page holds more than one group: this one is headed by its own title. */
  titled: boolean;
  /** The fields drawn now, in declaration order (the switch alone while it is off). */
  drawn: ReadonlyArray<[string, PluginConfigField]>;
  /** One field's control, as the card draws it. */
  control: (name: string, field: PluginConfigField) => ReactNode;
  disabled: boolean;
  onAction: (action: string) => void;
  locale: Locale;
  /** What follows the options: nested groups, then Reset and Save. */
  after: ReactNode;
}) {
  const localized = (en: string | undefined, zh: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zh);
  const say = (en: string, zh: string | undefined) => localizedText(locale, en, zh);
  const title = localized(entry.configuration.title, entry.configuration.titleZh) ?? entry.name;
  const description = localized(entry.configuration.description, entry.configuration.descriptionZh);
  const report = live ? entry.report : undefined;
  const actions = live ? (entry.actions ?? []) : [];
  const placed = placedActions(report);
  const words = S.settings.pluginPage;
  const navigation = useSettingsNavigation();

  const button = (id: string | undefined): ReactNode => {
    const action = actions.find((a) => a.id === id);
    if (action === undefined) return undefined;
    const hint = localized(action.description, action.descriptionZh);
    return (
      <Button
        key={action.id}
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => onAction(action.id)}
        {...(hint !== undefined ? { "data-tooltip": hint, "data-tooltip-extra": true } : {})}
      >
        {say(action.title, action.titleZh)}
      </Button>
    );
  };

  /** A check row's end: its action, then a link to the page it names when this viewer has it. */
  const rowEnd = (action: string | undefined, page: string | undefined): ReactNode => {
    const run = button(action);
    const link =
      page !== undefined && navigation?.has(page) === true ? (
        <Button key="page" size="sm" variant="link" onClick={() => navigation.open(page)}>
          {words.openPage}
        </Button>
      ) : undefined;
    if (run === undefined) return link;
    if (link === undefined) return run;
    return (
      <>
        {run}
        {link}
      </>
    );
  };

  const version = report?.version;
  const summary = report?.summary;
  const primary = actions.filter((a) => !placed.has(a.id));
  const checks = report?.checks ?? [];
  const basic = drawn.filter(([, f]) => f.advanced !== true && f.security !== true);
  const security = drawn.filter(([, f]) => f.advanced !== true && f.security === true);
  const advanced = drawn.filter(([, f]) => f.advanced === true);

  return (
    <div data-plugin-config={entry.name} className="space-y-6">
      {titled && <p className="text-sm font-semibold">{title}</p>}
      {(version !== undefined || summary !== undefined || primary.length > 0) && (
        <StatusStrip
          status={
            version !== undefined ? (
              <InstalledVersion
                name={version.name}
                state={version.state}
                stateLabel={wordFor(words.versionState, version.state)}
                {...(version.version !== undefined ? { version: version.version } : {})}
                {...(version.platform !== undefined ? { platform: version.platform } : {})}
                {...(version.progress !== undefined ? { progress: version.progress } : {})}
                {...(version.text !== undefined ? { text: say(version.text, version.textZh) } : {})}
                {...(version.details !== undefined
                  ? {
                      details: say(version.details, version.detailsZh),
                      detailsLabel: words.details,
                    }
                  : {})}
                action={button(version.action)}
              />
            ) : undefined
          }
          summary={
            summary !== undefined ? (
              <Pill
                tone={SUMMARY_TONE[summary.state] ?? "neutral"}
                {...(summary.hint !== undefined
                  ? { tooltip: say(summary.hint, summary.hintZh) }
                  : {})}
              >
                {say(summary.text, summary.textZh)}
              </Pill>
            ) : undefined
          }
          actions={primary.length > 0 ? primary.map((a) => button(a.id)) : undefined}
        />
      )}
      {checks.length > 0 && (
        <RuledSection title={words.checks} level={3} actions={button(report?.recheck)}>
          <Checklist label={words.checks}>
            {checks.map((check) => (
              <ChecklistRow
                key={check.id}
                id={check.id}
                label={say(check.label, check.labelZh)}
                state={check.state}
                stateLabel={wordFor(words.checkState, check.state)}
                {...(check.text !== undefined ? { text: say(check.text, check.textZh) } : {})}
                {...(check.details !== undefined
                  ? {
                      details: say(check.details, check.detailsZh),
                      detailsLabel: words.details,
                      detailsName: words.detailsAbout(say(check.label, check.labelZh)),
                    }
                  : {})}
                action={rowEnd(check.action, check.page)}
              />
            ))}
          </Checklist>
        </RuledSection>
      )}
      {live && (entry.notices ?? []).length > 0 && (
        <div className="space-y-1.5">
          <ConfigNotices entry={entry} title={title} locale={locale} />
        </div>
      )}
      {basic.length > 0 && (
        <RuledSection title={words.options} info={description} level={3}>
          <div className="space-y-3">{basic.map(([name, field]) => control(name, field))}</div>
        </RuledSection>
      )}
      {security.length > 0 && (
        <RuledSection
          title={
            <span className={`inline-flex items-center ${ICON_GAP.row}`}>
              <GlyphIcon d={ICONS.shieldCheck} size={ICON_SIZE.inlineGlyph} />
              {words.security}
            </span>
          }
          level={3}
        >
          <div className="space-y-3">{security.map(([name, field]) => control(name, field))}</div>
        </RuledSection>
      )}
      {advanced.length > 0 && (
        <AdvancedFold>{advanced.map(([name, field]) => control(name, field))}</AdvancedFold>
      )}
      {after}
    </div>
  );
}
