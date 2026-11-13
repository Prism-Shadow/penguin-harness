/**
 * The page's API socket, watched and steered from a spec. Every API call rides it
 * (`packages/web/src/api/socket.ts`), so `page.route` and `waitForResponse`, which see plain
 * HTTP only, see none of them.
 */

/** One frame of the API socket, or null for anything that is not JSON. */
function socketFrame(message) {
  try {
    return JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Watches — and steers — the page's API socket, the transport every call now rides
 * (`packages/web/src/api/socket.ts`): a call is one `{ id, call: { method, path, body } }`
 * frame out, and its answer one `{ id, status, body }` frame back (`stream` frames follow for
 * an event stream). `page.route` and `waitForResponse` see plain HTTP only, so a test that
 * keeps waiting on them would wait for nothing: the frames below are what these tests hold
 * back, slow down and judge.
 *
 * Installed before `goto`. Returns the frames seen, and the handles used below:
 * - `onCall(fn)` / `onAnswer(fn)` — called with each call frame, or each answer frame and its
 *   call, after registration;
 * - `hold(path, ms)` — hold the first call whose `path` is exactly `path` here for `ms`, then
 *   forward its frame to the server;
 * - `slowDown(fn)` — let every call reach the server `fn()` ms late: each call frame waits
 *   `fn()` ms here before it is forwarded;
 * - `nextCall(test)` — a promise for the next call frame `test(call)` accepts;
 * - `nextAnswer(test)` — a promise for the next answer frame whose call `test(call)` accepts;
 * - `answer(method, path, { status, body })` — answer every later call to exactly that method
 *   and path here, the way the server would, without forwarding it. Faked answers are not
 *   recorded in `answers`.
 */
export async function watchSocket(page) {
  const calls = [];
  const answers = [];
  const callHooks = [];
  const answerHooks = [];
  const callWaiters = [];
  const answerWaiters = [];
  const holds = [];
  const fakes = [];
  let slowdown = null;
  const callOf = new Map();

  await page.routeWebSocket(
    (url) => url.pathname === "/api/socket",
    (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        const frame = socketFrame(message);
        // A cancel (`{ id, cancel: true }`) names no endpoint and is not a call.
        if (frame === null || frame.call === undefined) {
          server.send(message);
          return;
        }
        const call = {
          id: frame.id,
          method: frame.call.method,
          path: frame.call.path,
          body: frame.call.body,
        };
        callOf.set(call.id, call);
        calls.push(call);
        for (const hook of callHooks) hook(call);
        const fake = fakes.find((f) => f.method === call.method && f.path === call.path);
        if (fake !== undefined) {
          for (let i = callWaiters.length - 1; i >= 0; i -= 1) {
            if (callWaiters[i].test(call)) callWaiters.splice(i, 1)[0].resolve(call);
          }
          ws.send(
            JSON.stringify({
              id: call.id,
              status: fake.status,
              headers: { "content-type": "application/json" },
              body: fake.body,
            }),
          );
          return;
        }
        let delay = slowdown === null ? 0 : slowdown();
        const held = holds.findIndex((hold) => hold.path === call.path);
        if (held !== -1) delay += holds.splice(held, 1)[0].ms;
        for (let i = callWaiters.length - 1; i >= 0; i -= 1) {
          if (callWaiters[i].test(call)) callWaiters.splice(i, 1)[0].resolve(call);
        }
        if (delay > 0) setTimeout(() => server.send(message), delay);
        else server.send(message);
      });
      server.onMessage((message) => {
        const frame = socketFrame(message);
        if (frame !== null && typeof frame.id === "number") {
          answers.push(frame);
          const call = callOf.get(frame.id);
          if (call !== undefined) for (const hook of answerHooks) hook(frame, call);
          for (let i = answerWaiters.length - 1; i >= 0; i -= 1) {
            const waiter = answerWaiters[i];
            if (call !== undefined && waiter.test(call)) {
              answerWaiters.splice(i, 1)[0].resolve(frame);
            }
          }
        }
        ws.send(message);
      });
    },
  );

  return {
    calls,
    answers,
    onCall: (fn) => callHooks.push(fn),
    onAnswer: (fn) => answerHooks.push(fn),
    hold: (path, ms) => holds.push({ path, ms }),
    slowDown: (fn) => {
      slowdown = fn;
    },
    nextCall: (test) => new Promise((resolve) => callWaiters.push({ test, resolve })),
    nextAnswer: (test) => new Promise((resolve) => answerWaiters.push({ test, resolve })),
    answer: (method, path, { status, body }) => fakes.push({ method, path, status, body }),
  };
}
