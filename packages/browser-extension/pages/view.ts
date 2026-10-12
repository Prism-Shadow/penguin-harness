/**
 * What the options page and the popup both show: a server's connection, and the EN / 中文 switch.
 */
import {
  parseUiLanguage,
  readUiLanguage,
  setUiLanguage,
  type ConnectionStatus,
  type ServerStatus,
} from "../src/storage.js";
import {
  LANGUAGE_NAMES,
  LANGUAGE_TAGS,
  UI_LANGUAGES,
  stringsFor,
  type Strings,
  type UiLanguage,
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
 * Calls `render` with the language the user picked, now and again whenever it changes: a pick in
 * one page re-renders every open page of the extension.
 */
export function followLanguage(render: (language: UiLanguage, strings: Strings) => void): void {
  const apply = (language: UiLanguage) => {
    document.documentElement.lang = LANGUAGE_TAGS[language];
    render(language, stringsFor(language));
  };
  void readUiLanguage().then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "uiLanguage" in changes) {
      apply(parseUiLanguage(changes.uiLanguage?.newValue));
    }
  });
}

/** Fills `#language` with the EN / 中文 switch; a pick is stored, and followLanguage does the rest. */
export function renderLanguageSwitch(current: UiLanguage, strings: Strings): void {
  const group = document.getElementById("language");
  if (group === null) return;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", strings.languageLabel);
  const buttons = UI_LANGUAGES.map((language) => {
    const button = element("button", { text: LANGUAGE_NAMES[language] });
    button.type = "button";
    button.lang = LANGUAGE_TAGS[language];
    button.dataset.language = language;
    button.setAttribute("aria-pressed", String(language === current));
    button.addEventListener("click", () => {
      if (language !== current) void setUiLanguage(language);
    });
    return button;
  });
  group.replaceChildren(
    ...buttons.flatMap((button, i) => (i === 0 ? [button] : [divider(), button])),
  );
}

function divider(): HTMLElement {
  const node = element("span", { className: "divider", text: "/" });
  node.setAttribute("aria-hidden", "true");
  return node;
}
