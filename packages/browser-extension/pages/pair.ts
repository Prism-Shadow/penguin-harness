/**
 * The options page: the paired servers with their connection status (Remove, Reconnect), and
 * "Add a server" — the server address and the pairing code from the Web App. Its copy follows the
 * EN / 中文 switch in its header, live.
 */
import {
  currentPlatform,
  deviceName,
  isUpdateAvailable,
  pair,
  type PairError,
} from "../src/pairing.js";
import { readServers, readStatus, removeServer, type PairedServer } from "../src/storage.js";
import { stringsFor, type Strings } from "../src/strings.js";
import {
  element,
  followLanguage,
  renderLanguageSwitch,
  setText,
  statusDot,
  statusText,
} from "./view.js";

const extensionVersion = chrome.runtime.getManifest().version;

let strings: Strings = stringsFor("en");
/** The outcome of the last Connect, kept as copy so it follows a language switch too. */
let message: { text: (copy: Strings) => string; tone: "ok" | "danger" } | null = null;

function fillCopy(): void {
  setText("heading", strings.pairHeading);
  setText("intro", strings.pairIntro);
  setText("paired-title", strings.pairedTitle);
  setText("servers-empty", strings.pairedNone);
  setText("remove-hint", strings.removeHint);
  setText("add-title", strings.addTitle);
  setText("server-url-label", strings.serverUrlLabel);
  setText("code-label", strings.codeLabel);
  setText("steps-title", strings.stepsTitle);
  setText("step1", strings.step1);
  setText("step2", strings.step2);
  setText("step3", strings.step3);
  const button = document.getElementById("connect") as HTMLButtonElement;
  button.textContent = button.disabled ? strings.connecting : strings.connect;
  const docs = document.getElementById("docs-link") as HTMLAnchorElement;
  docs.textContent = strings.docsLink;
  docs.href = strings.docsUrl;
  (document.getElementById("server-url") as HTMLInputElement).placeholder =
    strings.serverUrlPlaceholder;
  (document.getElementById("code") as HTMLInputElement).placeholder = strings.codePlaceholder;
  showMessage();
}

async function renderServers(): Promise<void> {
  const [servers, status] = await Promise.all([readServers(), readStatus()]);
  const list = document.getElementById("servers") as HTMLUListElement;
  list.replaceChildren(...servers.map((server) => serverRow(server, status[server.origin])));
  (document.getElementById("servers-empty") as HTMLElement).hidden = servers.length > 0;
  (document.getElementById("remove-hint") as HTMLElement).hidden = servers.length === 0;
}

function serverRow(
  server: PairedServer,
  state: Awaited<ReturnType<typeof readStatus>>[string] | undefined,
): HTMLLIElement {
  const details = [
    server.origin,
    strings.pairedBy(server.user.displayName ?? server.user.userId),
  ].join(" · ");
  const update = isUpdateAvailable(extensionVersion, server.serverVersion)
    ? element("div", {
        className: "small muted",
        text: strings.updateAvailable(server.serverVersion),
      })
    : null;
  const remove = element("button", { className: "flat", text: strings.remove });
  remove.type = "button";
  remove.addEventListener("click", () => void removeServer(server.origin));
  const reconnect =
    state?.status === "replaced" || state?.status === "protocol_mismatch"
      ? element("button", { text: strings.reconnect })
      : null;
  reconnect?.addEventListener(
    "click",
    () => void chrome.runtime.sendMessage({ type: "reconnect", origin: server.origin }),
  );
  const row = element(
    "li",
    { className: "row" },
    statusDot(state, strings),
    element(
      "div",
      { className: "grow" },
      element("div", { className: "name", text: server.label }),
      element("div", {
        className: "small muted",
        text: `${statusText(state?.status, strings)} · ${details}`,
      }),
      update,
    ),
    reconnect,
    remove,
  );
  row.dataset.origin = server.origin;
  row.dataset.status = state?.status ?? "stopped";
  return row;
}

function errorText(error: PairError, copy: Strings): string {
  switch (error.code) {
    case "url_empty":
      return copy.errorUrlEmpty;
    case "url_invalid":
      return copy.errorUrlInvalid;
    case "url_scheme":
      return copy.errorUrlScheme;
    case "code_invalid":
      return copy.errorCode;
    case "unreachable":
      return copy.errorUnreachable(error.origin);
    case "refused":
      return copy.errorRefused(error.message);
    case "bad_response":
      return copy.errorBadResponse;
  }
}

function showMessage(): void {
  const node = document.getElementById("pair-message") as HTMLElement;
  node.textContent = message === null ? "" : message.text(strings);
  node.dataset.tone = message?.tone ?? "ok";
}

function wireForm(): void {
  const form = document.getElementById("pair-form") as HTMLFormElement;
  const button = document.getElementById("connect") as HTMLButtonElement;
  const url = document.getElementById("server-url") as HTMLInputElement;
  const code = document.getElementById("code") as HTMLInputElement;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = strings.connecting;
    message = null;
    showMessage();
    void pair({
      serverUrl: url.value,
      code: code.value,
      extensionVersion,
      name: deviceName(navigator.userAgent, currentPlatform()),
    })
      .then((outcome) => {
        if (outcome.ok) {
          code.value = "";
          url.value = "";
          const { label } = outcome.server;
          message = { text: (copy) => copy.paired(label), tone: "ok" };
        } else {
          const { error } = outcome;
          message = { text: (copy) => errorText(error, copy), tone: "danger" };
        }
        showMessage();
      })
      .finally(() => {
        button.disabled = false;
        button.textContent = strings.connect;
      });
  });
}

wireForm();
followLanguage((language, next) => {
  strings = next;
  renderLanguageSwitch(language, strings);
  fillCopy();
  void renderServers();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && "servers" in changes) || (area === "session" && "status" in changes)) {
    void renderServers();
  }
});
