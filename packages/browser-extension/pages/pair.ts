/**
 * The options page: the paired servers with their connection status (Remove, Reconnect), and
 * "Add a server" — the server address and the pairing code from the Web App.
 */
import {
  currentPlatform,
  deviceName,
  isUpdateAvailable,
  pair,
  type PairError,
} from "../src/pairing.js";
import { readServers, readStatus, removeServer, type PairedServer } from "../src/storage.js";
import { strings } from "../src/strings.js";
import { element, setText, statusDot, statusText } from "./view.js";

const extensionVersion = chrome.runtime.getManifest().version;

function fillCopy(): void {
  document.documentElement.lang = navigator.language;
  setText("heading", strings.pairHeading);
  setText("intro", strings.pairIntro);
  setText("paired-title", strings.pairedTitle);
  setText("servers-empty", strings.pairedNone);
  setText("remove-hint", strings.removeHint);
  setText("add-title", strings.addTitle);
  setText("server-url-label", strings.serverUrlLabel);
  setText("code-label", strings.codeLabel);
  setText("connect", strings.connect);
  setText("steps-title", strings.stepsTitle);
  setText("step1", strings.step1);
  setText("step2", strings.step2);
  setText("step3", strings.step3);
  const docs = document.getElementById("docs-link") as HTMLAnchorElement;
  docs.textContent = strings.docsLink;
  docs.href = strings.docsUrl;
  (document.getElementById("server-url") as HTMLInputElement).placeholder =
    strings.serverUrlPlaceholder;
  (document.getElementById("code") as HTMLInputElement).placeholder = strings.codePlaceholder;
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
    statusDot(state),
    element(
      "div",
      { className: "grow" },
      element("div", { className: "name", text: server.label }),
      element("div", {
        className: "small muted",
        text: `${statusText(state?.status)} · ${details}`,
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

function errorText(error: PairError): string {
  switch (error.code) {
    case "url_empty":
      return strings.errorUrlEmpty;
    case "url_invalid":
      return strings.errorUrlInvalid;
    case "url_scheme":
      return strings.errorUrlScheme;
    case "code_invalid":
      return strings.errorCode;
    case "unreachable":
      return strings.errorUnreachable(error.origin);
    case "refused":
      return strings.errorRefused(error.message);
    case "bad_response":
      return strings.errorBadResponse;
  }
}

function showMessage(text: string, tone: "ok" | "danger"): void {
  const message = document.getElementById("pair-message") as HTMLElement;
  message.textContent = text;
  message.dataset.tone = tone;
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
    showMessage("", "ok");
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
          showMessage(strings.paired(outcome.server.label), "ok");
        } else {
          showMessage(errorText(outcome.error), "danger");
        }
      })
      .finally(() => {
        button.disabled = false;
        button.textContent = strings.connect;
      });
  });
}

fillCopy();
wireForm();
void renderServers();
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && "servers" in changes) || (area === "session" && "status" in changes)) {
    void renderServers();
  }
});
