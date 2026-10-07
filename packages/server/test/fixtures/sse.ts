/**
 * Reads an SSE response body the way an AMSP client does: one string per `data:` block (a
 * block's `data:` lines joined with "\n"), comment lines and other fields ignored, `[DONE]`
 * included so a suite can check the stream's end.
 *
 * A stand-in with the contract of the client package's `readSse` (packages/amsp), which lands
 * on its own branch; once it is merged this file goes and the suites import that one.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line === "") {
          if (data.length > 0) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
    }
    if (data.length > 0) yield data.join("\n");
  } finally {
    reader.releaseLock();
  }
}
