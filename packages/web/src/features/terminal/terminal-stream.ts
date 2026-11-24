import type { AttachedSocket, SocketHandlers } from "./terminal-connection";

type OpenStream = (url: string, handlers: SocketHandlers) => AttachedSocket;

/** Hosts can supply an in-memory stream, as the public component gallery does. */
let openStream: OpenStream = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => handlers.onOpen();
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) handlers.onMessage(event.data);
  };
  ws.onclose = () => handlers.onClose();
  return {
    send: (bytes) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
    },
    close: () => ws.close(),
  };
};

export function setTerminalStreamOpener(open: OpenStream): void {
  openStream = open;
}

export const openTerminalStream: OpenStream = (url, handlers) => openStream(url, handlers);
