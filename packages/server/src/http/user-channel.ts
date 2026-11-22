/**
 * The user channel's key in ChannelHub: where a user's server events are published, and what the
 * event stream (http/routes/events.ts) subscribes to. Its own module so code plugins reach it
 * through `@prismshadow/penguin-server/plugin` without the event routes coming along.
 */
export function userChannelKey(userId: string): string {
  return `user:${userId}`;
}
