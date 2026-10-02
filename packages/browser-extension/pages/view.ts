/** What the options page and the popup both show of a server's connection. */
import type { ConnectionStatus, ServerStatus } from "../src/storage.js";
import { strings } from "../src/strings.js";

export function statusText(status: ConnectionStatus | undefined): string {
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
export function statusDot(state: ServerStatus | undefined): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.dataset.tone = statusTone(state?.status);
  dot.title = statusText(state?.status);
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
