/**
 * Server-sent events, read the way an `EventSource` reads them, for a body `fetch` returned (an
 * `EventSource` cannot send an `Authorization` header or a POST body).
 */

/**
 * The data of each event in an SSE body, in order: the event's `data:` lines joined with `\n`.
 *
 * Lines may end in LF, CRLF or a lone CR, and a chunk may split a line, a line ending or a UTF-8
 * character anywhere. An event is dispatched at the blank line that closes it; one the body ends
 * in the middle of is dropped, since its data may be cut short. Comment lines (`: keep-alive`)
 * and every field but `data` are skipped. The body is read to its end, or cancelled — the
 * connection closed — when the caller stops iterating early.
 *
 * `[DONE]` is AMSP's end-of-stream marker; it is yielded like any other data, so a caller stops
 * there.
 */
export function readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  return sseData(body);
}

/**
 * {@link readSse}, cancellable: once `signal` aborts, the body is cancelled and the read rejects
 * with the signal's reason, whether or not the `fetch` that produced the body honours the signal
 * itself.
 */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const onAbort = () => {
    reader.cancel(signal!.reason).catch(() => {});
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  // One instance per body: the search position lives on the regex, and this generator yields
  // between searches while another body's reader may run.
  const terminator = /\r\n|\r|\n/g;
  // Text after the last complete line; terminators are searched for from `from` on.
  let pending = "";
  let from = 0;
  // The current event's data lines; null until the event has one.
  let data: string[] | null = null;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw signal?.aborted ? signal.reason : err;
      }
      if (signal?.aborted) throw signal.reason;
      const done = chunk.done;
      pending += done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });

      const lines: string[] = [];
      let start = 0;
      let waitForLf = false;
      terminator.lastIndex = from;
      for (let match = terminator.exec(pending); match; match = terminator.exec(pending)) {
        // A CR that ends what has arrived may be the first half of a CRLF.
        if (!done && match[0] === "\r" && match.index === pending.length - 1) {
          waitForLf = true;
          break;
        }
        lines.push(pending.slice(start, match.index));
        start = match.index + match[0].length;
      }
      pending = pending.slice(start);
      from = waitForLf ? pending.length - 1 : pending.length;

      for (const line of lines) {
        if (line === "") {
          if (data !== null) {
            const event = data.join("\n");
            data = null;
            yield event;
          }
          continue;
        }
        // A comment has an empty field name, so it falls out with every other non-data field.
        const colon = line.indexOf(":");
        if ((colon === -1 ? line : line.slice(0, colon)) !== "data") continue;
        const value = colon === -1 ? "" : line.slice(colon + 1);
        (data ??= []).push(value.startsWith(" ") ? value.slice(1) : value);
      }
      if (done) return;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Closes the connection when the caller stopped early or the read failed; a no-op at the end.
    await reader.cancel().catch(() => {});
  }
}
