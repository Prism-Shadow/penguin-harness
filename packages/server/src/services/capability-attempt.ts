import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";

// MMSP validates credentials and request content before it reaches the HTTP transport.
// The scope carries only a boolean, never the URL, credentials or the request body.
const current = new AsyncLocalStorage<{ sent: boolean }>();
const transport = channel("undici:request:create");
let readers = 0;
function observe() {
  const attempt = current.getStore();
  if (attempt) attempt.sent = true;
}

export async function observeProviderAttempt<T>(attempt: { sent: boolean }, fn: () => Promise<T>) {
  if (++readers === 1) transport.subscribe(observe);
  try {
    return await current.run(attempt, fn);
  } finally {
    if (--readers === 0) transport.unsubscribe(observe);
  }
}
