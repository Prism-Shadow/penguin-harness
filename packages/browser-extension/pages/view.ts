/**
 * What the options page and the popup both show: a server's connection, and the language and
 * theme switches in the header.
 */
import {
  parseLanguagePref,
  parseThemePref,
  readPagePrefs,
  setLanguagePref,
  setThemePref,
  type ConnectionStatus,
  type ServerStatus,
  type ThemePref,
} from "../src/storage.js";
import {
  LANGUAGE_NAMES,
  LANGUAGE_TAGS,
  UI_LANGUAGES,
  resolveLanguage,
  stringsFor,
  type LanguagePref,
  type Strings,
} from "../src/strings.js";

export function statusText(status: ConnectionStatus | undefined, strings: Strings): string {
  switch (status) {
    case "connected":
      return strings.statusConnected;
    case "connecting":
      return strings.statusConnecting;
    case "waiting":
      return strings.statusWaiting;
    case "replaced":
      return strings.statusReplaced;
    case "revoked":
      return strings.statusRevoked;
    case "protocol_mismatch":
      return strings.statusProtocolMismatch;
    case "disabled":
      return strings.statusDisabled;
    default:
      return strings.statusStopped;
  }
}

export function statusTone(status: ConnectionStatus | undefined): "ok" | "wait" | "danger" | "off" {
  switch (status) {
    case "connected":
      return "ok";
    case "connecting":
    case "waiting":
    case "disabled":
      return "wait";
    case "replaced":
    case "revoked":
    case "protocol_mismatch":
      return "danger";
    default:
      return "off";
  }
}

/** A status dot whose meaning is in its tooltip and label, not its colour alone. */
export function statusDot(state: ServerStatus | undefined, strings: Strings): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.dataset.tone = statusTone(state?.status);
  dot.title = statusText(state?.status, strings);
  dot.setAttribute("aria-label", dot.title);
  return dot;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: (Node | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className !== undefined) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

export function setText(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node !== null) node.textContent = text;
}

/**
 * Applies the user's language and theme, and calls `render` with the copy, now and again whenever
 * the language changes: a pick in one page reaches every open page of the extension. With no pick
 * the language is Chrome's, and the theme follows the device's light or dark setting live (the
 * stylesheet's media query does that; `data-theme` is set only for a picked theme).
 */
export function followPreferences(render: (strings: Strings) => void): void {
  let language: LanguagePref = "system";
  let theme: ThemePref = "system";
  const show = (languageChanged: boolean) => {
    const resolved = resolveLanguage(language);
    const strings = stringsFor(resolved);
    const root = document.documentElement;
    root.lang = LANGUAGE_TAGS[resolved];
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    renderLanguageSwitch(language, strings);
    renderThemeSwitch(theme, strings);
    if (languageChanged) render(strings);
  };

  const select = document.getElementById("language") as HTMLSelectElement | null;
  if (select !== null) {
    select.addEventListener("change", () => void setLanguagePref(parseLanguagePref(select.value)));
    markKeyboardFocus(select);
  }
  document
    .getElementById("theme")
    ?.addEventListener("click", () => void setThemePref(NEXT_THEME[theme]));

  void readPagePrefs().then((prefs) => {
    ({ language, theme } = prefs);
    show(true);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const languageChanged = "uiLanguage" in changes;
    const themeChanged = "uiTheme" in changes;
    if (languageChanged) language = parseLanguagePref(changes.uiLanguage?.newValue);
    if (themeChanged) theme = parseThemePref(changes.uiTheme?.newValue);
    if (languageChanged || themeChanged) show(languageChanged);
  });
}

/** True for a storage change that only the preference switches care about. */
export function isPreferenceChange(changes: Record<string, unknown>, area: string): boolean {
  return (
    area === "local" &&
    Object.keys(changes).every((key) => key === "uiLanguage" || key === "uiTheme")
  );
}

/**
 * Chrome counts a mouse click on a <select> as :focus-visible, so its focus ring would stay after
 * every pick made with the mouse. The language switch marks keyboard focus itself, the way
 * :focus-visible treats a button: a ring for focus that arrives or carries on by key, none after a
 * click.
 */
function markKeyboardFocus(select: HTMLSelectElement): void {
  let pointer = false;
  const mark = (keyboard: boolean) => {
    if (keyboard) select.dataset.focus = "keyboard";
    else delete select.dataset.focus;
  };
  select.addEventListener("pointerdown", () => {
    pointer = true;
    mark(false);
  });
  select.addEventListener("focus", () => mark(!pointer));
  select.addEventListener("keydown", () => mark(true));
  select.addEventListener("blur", () => {
    pointer = false;
    mark(false);
  });
}

/** The theme switch steps through the three the way the product site's does. */
const NEXT_THEME: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" };

/**
 * Fills the `#language` select (each language named in its own language, then "System") and the
 * label beside its globe; a pick is stored, and followPreferences does the rest.
 */
function renderLanguageSwitch(current: LanguagePref, strings: Strings): void {
  const select = document.getElementById("language") as HTMLSelectElement | null;
  if (select === null) return;
  const name = (pref: LanguagePref) =>
    pref === "system" ? strings.languageSystem : LANGUAGE_NAMES[pref];
  const options = [...UI_LANGUAGES, "system" as const].map((pref) => {
    const option = element("option", { text: name(pref) });
    option.value = pref;
    option.dataset.language = pref;
    if (pref !== "system") option.lang = LANGUAGE_TAGS[pref];
    return option;
  });
  select.replaceChildren(...options);
  select.value = current;
  select.setAttribute("aria-label", strings.languageLabel);
  select.title = strings.choice(strings.languageLabel, name(current));
  setText("language-current", name(current));
}

/** Labels the `#theme` button with the theme it is on; its icon follows `data-mode` in CSS. */
function renderThemeSwitch(current: ThemePref, strings: Strings): void {
  const button = document.getElementById("theme");
  if (button === null) return;
  const names: Record<ThemePref, string> = {
    light: strings.themeLight,
    dark: strings.themeDark,
    system: strings.themeSystem,
  };
  const label = strings.choice(strings.themeLabel, names[current]);
  button.dataset.mode = current;
  button.title = label;
  button.setAttribute("aria-label", label);
}
