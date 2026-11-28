/**
 * The one heartbeat every stream this harness serves beats at: a named `ping` event on the
 * SSE endpoints (http/sse.ts) and the same interval on the API socket's liveness writes
 * (socket/serve.ts). One constant, so a stream's consumer can tell a quiet stream from a dead
 * one by the same clock whichever transport it reads.
 */
export const HEARTBEAT_MS = 20_000;
