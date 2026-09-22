/**
 * The live connections a user's sessions are holding open, so revoking a session can end
 * them.
 *
 * An SSE stream is authorised once, when it connects, and nothing on the request path ever
 * looks at it again — so deleting a user's `auth_sessions` rows leaves every stream they
 * opened still writing, and the window on the other end keeps rendering a conversation it
 * is no longer signed in for. This registry is the missing handle: a stream adds itself for
 * exactly as long as it is open, and whatever drops the rows ends the streams in the same
 * step (AdminService.signOutEverywhere).
 *
 * It is a best-effort index, not the source of truth. The streams themselves re-check their
 * own session on the heartbeat (http/sse.ts), which is what covers a caller that drops rows
 * without telling this registry.
 *
 * Nothing is persisted: a connection belongs to the process holding it, and a restart ends
 * every one of them anyway. A hot push builds a new registry along with the App, so streams
 * opened by the previous generation are no longer listed here — their own heartbeat is what
 * ends them, on the same schedule as any other.
 */
import { Component, Interface } from "@prismshadow/penguin-core/kernel";

/** LiveStreams: the mechanism LiveStreamRegistry implements. */
export abstract class LiveStreams extends Interface<{
  /**
   * Track a live stream for `userId`. The returned call removes it again and must run on
   * every exit path of the connection — an entry left behind names a stream nobody can
   * close, and its `end` would be called on a connection that is already gone.
   */
  add(userId: string, end: () => void): () => void;
  /** End every stream this user is holding open; returns how many were ended. */
  endForUser(userId: string): number;
  /** How many streams this user is holding open. */
  countFor(userId: string): number;
}>() {}

/** One tracked stream. An object rather than the bare callback, so two streams sharing a callback identity stay two entries. */
interface TrackedStream {
  end: () => void;
}

@Component()
export class LiveStreamRegistry implements LiveStreams {
  private readonly byUser = new Map<string, Set<TrackedStream>>();

  add(userId: string, end: () => void): () => void {
    const tracked: TrackedStream = { end };
    let streams = this.byUser.get(userId);
    if (streams === undefined) {
      streams = new Set<TrackedStream>();
      this.byUser.set(userId, streams);
    }
    const held = streams;
    held.add(tracked);
    let released = false;
    return () => {
      // Idempotent: a stream that ends itself while the registry is ending it would
      // otherwise release twice, and the second release could drop a set a later
      // connection is already using.
      if (released) return;
      released = true;
      held.delete(tracked);
      if (held.size === 0 && this.byUser.get(userId) === held) this.byUser.delete(userId);
    };
  }

  endForUser(userId: string): number {
    const streams = this.byUser.get(userId);
    if (streams === undefined) return 0;
    // Over a snapshot: ending a stream runs its own release, which mutates this very set.
    const ending = [...streams];
    for (const stream of ending) stream.end();
    return ending.length;
  }

  countFor(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }
}
