// A stand-in for the PenguinHarness server's extension routes, built from the extension's own
// wire module (src/wire.ts, loaded through Node's type stripping): the pairing route with CORS
// for extension origins only, and the WebSocket link with the token in Sec-WebSocket-Protocol.
// It speaks the server's side of design § 3.1/3.5: hello on connect, then `tabs`, pings, close
// codes. Once the real server lands, the e2e runs against it instead.
import { randomBytes } from "node:crypto";
import http from "node:http";
import { WebSocketServer } from "ws";
import {
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  EXTENSION_PAIR_PATH,
  EXTENSION_WS_PATH,
  SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
  parseEventMessage,
  parseReplyMessage,
} from "../src/wire.ts";

export async function startStubServer({ pingMs = 20_000 } = {}) {
  const codes = new Set();
  const tokens = new Set();
  const state = {
    /** Every upgrade attempt: what the extension sent, and what the stub answered. */
    upgrades: [],
    pairRequests: [],
    events: [],
    closes: [],
    hello: null,
    pongs: 0,
  };
  let socket = null;
  let seq = 0;
  const pending = new Map();
  const waiters = new Set();
  let pinger = null;

  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (req.url !== EXTENSION_PAIR_PATH) return json(res, 404, { error: { code: "not_found" } });
    // CORS on this one route, for extension origins only (no cookie is ever involved).
    if (typeof origin === "string" && origin.startsWith("chrome-extension://")) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "POST");
      res.setHeader("access-control-allow-headers", "content-type");
      if (req.headers["access-control-request-private-network"] === "true") {
        res.setHeader("access-control-allow-private-network", "true");
      }
      res.statusCode = 204;
      return res.end();
    }
    if (req.method !== "POST") return json(res, 405, { error: { code: "method_not_allowed" } });
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(res, 400, { error: { code: "bad_request", message: "Not JSON." } });
      }
      state.pairRequests.push({ ...body, origin, cookie: req.headers.cookie ?? null });
      if (!codes.delete(body.code)) {
        return json(res, 400, {
          error: { code: "invalid_code", message: "The pairing code is unknown or already used." },
        });
      }
      const token = randomBytes(32).toString("base64url");
      tokens.add(token);
      json(res, 200, {
        extensionId: `bext_${randomBytes(4).toString("hex")}`,
        token,
        installId: `inst_${randomBytes(4).toString("hex")}`,
        user: { userId: "u_e2e", displayName: "E2E" },
        serverVersion: "0.2.13",
      });
    });
  });

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  server.on("upgrade", (req, sock, head) => {
    const offered = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const attempt = { url: req.url, origin: req.headers.origin, protocols: offered, status: 101 };
    state.upgrades.push(attempt);
    const refuse = (status) => {
      attempt.status = status;
      sock.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\n\r\n`);
    };
    if (req.url !== EXTENSION_WS_PATH) return refuse(404);
    if (!String(req.headers.origin ?? "").startsWith("chrome-extension://")) return refuse(403);
    const token = offered
      .find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX))
      ?.slice(TOKEN_PROTOCOL_PREFIX.length);
    if (token === undefined || !tokens.has(token)) return refuse(401);
    wss.handleUpgrade(req, sock, head, attach);
  });

  function attach(ws) {
    if (socket !== null) socket.close(CLOSE_REPLACED, "replaced");
    socket = ws;
    ws.on("message", (data) => {
      let frame;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return;
      }
      const reply = parseReplyMessage(frame);
      if (reply !== null) {
        const waiting = pending.get(reply.id);
        pending.delete(reply.id);
        if (waiting === undefined) return;
        clearTimeout(waiting.timer);
        if (reply.ok) waiting.resolve(reply.result);
        else waiting.reject(new Error(reply.error ?? "refused"));
        return;
      }
      const event = parseEventMessage(frame);
      if (event === null) return;
      state.events.push(event);
      for (const waiter of [...waiters]) {
        if (waiter.match(event)) {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(event);
        }
      }
    });
    ws.on("close", (code, reason) => {
      state.closes.push({ code, reason: String(reason) });
      if (socket !== ws) return;
      socket = null;
      clearInterval(pinger);
      for (const [id, waiting] of pending) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("closed"));
        pending.delete(id);
      }
    });
    // The server's side of the handshake: hello, then the tab list.
    void request({ op: "hello" })
      .then((hello) => {
        state.hello = hello;
        return request({ op: "tabs" });
      })
      .catch(() => {});
    clearInterval(pinger);
    pinger = setInterval(() => {
      void request({ op: "ping" }, pingMs)
        .then(() => (state.pongs += 1))
        .catch(() => {});
    }, pingMs);
  }

  /** Sends one command over the link; resolves with its result, rejects with its error. */
  function request(command, timeoutMs = 15_000) {
    if (socket === null) return Promise.reject(new Error("not connected"));
    const id = `stub-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no answer to '${command.op}' within ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: "desktop-browser-command", id, command }));
    });
  }

  /** Resolves with the first event (already received or still to come) that matches. */
  function waitForEvent(match, timeoutMs = 15_000) {
    const seen = state.events.find(match);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error("the event did not arrive"));
      }, timeoutMs);
      waiters.add(waiter);
    });
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    state,
    request,
    waitForEvent,
    get connected() {
      return socket !== null && state.hello !== null;
    },
    /** A one-time pairing code, as the Web App's "Connect your Chrome" would show. */
    mintCode() {
      const code = randomBytes(32).toString("base64url");
      codes.add(code);
      return code;
    },
    /** Revoked in the Web App: the token is gone and the socket closes 4003. */
    revoke() {
      tokens.clear();
      socket?.close(CLOSE_REVOKED, "revoked");
    },
    close() {
      clearInterval(pinger);
      socket?.terminate();
      wss.close();
      server.close();
    },
  };
}
