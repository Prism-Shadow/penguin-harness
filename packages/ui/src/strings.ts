/**
 * The package's own words: the accessibility fallbacks a primitive needs when its caller passes
 * none, and nothing else.
 *
 * Copy is the caller's. A title, a status label, an empty state's sentence or a tooltip that
 * names something in the app arrives as a prop, because only the app knows its concepts and its
 * dictionaries. What is left is the handful of strings a primitive announces on its own — the
 * close cross's name, the "Copied" confirmation a live region reads out, a busy fallback — and a
 * component that forgot them would be silent to a screen reader. Those live here, English by
 * default; the app injects its own per interface language through {@link UiStringsProvider},
 * once, around its tree.
 *
 * A key joins the interface when a component that moves into the package needs one; the app's
 * mapping from its dictionaries must then cover it in every language it ships.
 *
 * Two groups are chrome rather than accessibility fallbacks. `a2ui` holds the words around the
 * components a model writes into its reply (a choice's fill button, a callout's tone name, a
 * widget's labels and units). Those blocks render from inside Markdown, where no caller stands
 * between the reply and the block to pass copy down as props, so their few words come from here
 * like the rest. `reader` holds the Markdown reader's controls (its outline and its find), which
 * the file browser and the preview pane draw for their callers, who pass no copy for them.
 */
import { createContext, createElement, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { A2uiChartKind, A2uiWeatherCondition } from "@prismshadow/penguin-core/a2ui";

/** The words around the A2UI blocks a reply may hold (components/content/a2ui). */
export interface A2uiStrings {
  /**
   * The interface language these words are in. A widget formats its numbers, dates and weekdays
   * in it, so a reply read anywhere (a trace, a subagent panel) matches the words around it.
   */
  lang: "zh" | "en";
  /** The button that puts a multi-select choice's picks, or a form's answers, in the composer. */
  fill: string;
  /** A choice's own-answer control: it empties the composer for the reader's own answer. */
  other: string;
  /** The mark on the option the model recommends. */
  recommended: string;
  /** The tone names: a tone note's mark tooltip, read out before the note's text. */
  note: string;
  tip: string;
  caution: string;
  warning: string;
  /** The quiet placeholder that stands in for a block while the reply is still streaming. */
  composing: string;
  /** The one-line notice over a block that cannot be drawn, its source shown below. */
  cannotShow: (reason: string) => string;
  /** A rendered diagram's accessible name, and its placeholder while the renderer loads. */
  diagram: string;
  /** The toggle that shows a rendered diagram's source under it. */
  showSource: string;
  /** A form's number stepper: the buttons that add and subtract one step. */
  stepUp: string;
  stepDown: string;
  /** A form field's error line when the model gave no hint and the rule has no symbols. */
  invalid: string;
  /** A form's dropdown: its empty first row, when the model wrote no placeholder. */
  choose: string;
  /** The weather conditions a weather widget names, by the catalog's condition key. */
  conditions: Readonly<Record<A2uiWeatherCondition, string>>;
  /** A snapshot widget's head: when its data was read ("As of 14:05"). */
  asOf: (time: string) => string;
  /** A weather widget's foot: where its data came from. */
  source: (name: string) => string;
  /** A weather widget's detail labels. */
  feelsLike: string;
  humidity: string;
  wind: string;
  precipitation: string;
  high: string;
  low: string;
  /** The weather widget's two forecast sections: the next hours and the coming days. */
  hourly: string;
  daily: string;
  /** The first forecast day when it is the reader's today. */
  today: string;
  /** The widgets' accessible names when the model gave no title. */
  weather: string;
  clock: string;
  countdown: string;
  metrics: string;
  /** A clock zone the model named only as the reader's own. */
  localTime: string;
  /** What a countdown shows once its moment has passed, unless the model named it. */
  countdownDone: string;
  /** The units under a countdown's figures. */
  unitDays: string;
  unitHours: string;
  unitMinutes: string;
  unitSeconds: string;
  /** A finished progress reading, before its detail. */
  done: string;
  /** Which way a reading moved, read out before its change. */
  deltaUp: string;
  deltaDown: string;
  /**
   * A chart's kind ("Bar chart"): its accessible name when the model gave no title, and the lead
   * of the summary a screen reader hears instead of the picture.
   */
  chartKind: Readonly<Record<A2uiChartKind, string>>;
  /** A chart summary's counts: the categories (slices, bins) and the series. */
  categories: (n: number) => string;
  seriesCount: (n: number) => string;
  /** The system-resource board's accessible name when the model named no host. */
  resources: string;
  /** The board's readings and sections. */
  cpu: string;
  memory: string;
  swap: string;
  disk: string;
  network: string;
  load: string;
  uptime: string;
  /** The network chart's two series. */
  received: string;
  sent: string;
  /** The network chart's caption: its readings carry no times, only their count and order. */
  lastReadings: (n: number) => string;
}

/** The Markdown reader's controls (components/content/markdown-reader). */
export interface ReaderStrings {
  /** The outline: its rail's title and accessible name, and the name of the button that opens it. */
  outline: string;
  /** The find button's name and tooltip. */
  find: string;
  /** The find box's placeholder and accessible name. */
  findPlaceholder: string;
  /** The find bar's steps and its close. */
  previousMatch: string;
  nextMatch: string;
  closeFind: string;
  /** The counter while the query matches nothing. */
  noResults: string;
}

export interface UiStrings {
  /** The close cross's accessible name (`CloseButton`). */
  close: string;
  /** What a live region announces once something has been copied to the clipboard. */
  copied: string;
  /** A busy fallback a primitive may announce while its caller has named nothing. */
  loading: string;
  /** The name of a password field's reveal toggle while the value is masked (`PasswordInput`). */
  showPassword: string;
  /** The same toggle's name while the value is shown. */
  hidePassword: string;
  /** The name of a search box's clear button (`SearchInput`). */
  clearSearch: string;
  /** The "?" disclosure's name when it names no subject, and a help fold's row text. */
  moreInfo: string;
  /** The same name with the subject folded in ("More info: Vault"): InfoPopover, HelpFold. */
  moreInfoAbout: (subject: string) => string;
  /** The toast stack's name as a live region and landmark (`Toaster`). */
  notifications: string;
  /** What pressing a toast does, read after its text: it dismisses it (`Toaster`). */
  dismiss: string;
  /** The name and tooltip of a code block's copy button (`CodeBlock`). */
  copyCode: string;
  /** A collapsed group header's name: pressing it expands the group (`GroupHeader`). */
  expand: string;
  /** An expanded group header's name: pressing it collapses the group (`GroupHeader`). */
  collapse: string;
  /** A "more" row's text and name when its caller counts nothing (`MoreRow`, `FolderSection`). */
  more: string;
  /** The row that folds a revealed list back to its first page (`FolderSection`). */
  fewer: string;
  /** A pager's step back, as its name and tooltip (`Pager`). */
  previous: string;
  /** A pager's step forward, as its name and tooltip (`Pager`). */
  next: string;
  /** What a pager's "2/5" readout says aloud: the page, then how many there are (`Pager`). */
  pagePosition: (page: number, pageCount: number) => string;
  /** The A2UI blocks' words. */
  a2ui: A2uiStrings;
  /** The Markdown reader's words. */
  reader: ReaderStrings;
}

/** The English fallbacks, used wherever no provider is mounted (a test, a stand-alone page). */
export const DEFAULT_UI_STRINGS: UiStrings = {
  close: "Close",
  copied: "Copied",
  loading: "Loading…",
  showPassword: "Show password",
  hidePassword: "Hide password",
  clearSearch: "Clear search",
  moreInfo: "More info",
  moreInfoAbout: (subject) => `More info: ${subject}`,
  notifications: "Notifications",
  dismiss: "Dismiss",
  copyCode: "Copy code",
  expand: "Expand",
  collapse: "Collapse",
  more: "More",
  fewer: "Show less",
  previous: "Previous page",
  next: "Next page",
  pagePosition: (page, pageCount) => `Page ${page} of ${pageCount}`,
  a2ui: {
    lang: "en",
    fill: "Fill in",
    other: "Other…",
    recommended: "Recommended",
    note: "Note",
    tip: "Tip",
    caution: "Caution",
    warning: "Warning",
    composing: "Composing…",
    cannotShow: (reason) => `This component can't be shown: ${reason}`,
    diagram: "Diagram",
    showSource: "Show source",
    stepUp: "Increase",
    stepDown: "Decrease",
    invalid: "Not a valid value",
    choose: "Choose…",
    conditions: {
      clear: "Clear",
      "partly-cloudy": "Partly cloudy",
      cloudy: "Overcast",
      fog: "Fog",
      drizzle: "Drizzle",
      rain: "Rain",
      "heavy-rain": "Heavy rain",
      thunder: "Thunderstorm",
      snow: "Snow",
      sleet: "Sleet",
      wind: "Windy",
    },
    asOf: (time) => `As of ${time}`,
    source: (name) => `Source: ${name}`,
    feelsLike: "Feels like",
    humidity: "Humidity",
    wind: "Wind",
    precipitation: "Precipitation",
    high: "High",
    low: "Low",
    hourly: "Next hours",
    daily: "Coming days",
    today: "Today",
    weather: "Weather",
    clock: "Clock",
    countdown: "Countdown",
    metrics: "Metrics",
    localTime: "Local time",
    countdownDone: "Time's up",
    unitDays: "days",
    unitHours: "hours",
    unitMinutes: "min",
    unitSeconds: "sec",
    done: "Done",
    deltaUp: "up",
    deltaDown: "down",
    chartKind: {
      line: "Line chart",
      area: "Area chart",
      bar: "Bar chart",
      pie: "Pie chart",
      scatter: "Scatter plot",
      histogram: "Histogram",
      gauge: "Gauge",
    },
    categories: (n) => `${n} ${n === 1 ? "category" : "categories"}`,
    seriesCount: (n) => `${n} series`,
    resources: "System resources",
    cpu: "CPU",
    memory: "Memory",
    swap: "Swap",
    disk: "Disks",
    network: "Network",
    load: "Load",
    uptime: "Uptime",
    received: "Received",
    sent: "Sent",
    lastReadings: (n) => `Last ${n} readings`,
  },
  reader: {
    outline: "Outline",
    find: "Find in document",
    findPlaceholder: "Find in document…",
    previousMatch: "Previous match",
    nextMatch: "Next match",
    closeFind: "Close find",
    noResults: "No results",
  },
};

const UiStringsContext = createContext<UiStrings>(DEFAULT_UI_STRINGS);

/** Supplies the app's words for the whole tree below it; mount it once, per interface language. */
export function UiStringsProvider({
  strings,
  children,
}: {
  strings: UiStrings;
  children?: ReactNode;
}): ReactElement {
  return createElement(UiStringsContext.Provider, { value: strings }, children);
}

/** The words in effect: the nearest provider's, or the English defaults when none is mounted. */
export function useUiStrings(): UiStrings {
  return useContext(UiStringsContext);
}
